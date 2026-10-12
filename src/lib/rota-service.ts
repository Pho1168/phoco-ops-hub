import { store } from "@/lib/data";
import { buildEveningNotices, buildImportNotices, EVENING_REMINDER_AT, parseExport, parseStaffTab, parseWeekTable, planSync } from "@/lib/domain/rota";
import { addDays, afterQuietHours, londonDate, londonHM, QUIET_START } from "@/lib/domain/time";
import type { RotaResult, Store } from "@/lib/data/store";
import type { SiteId } from "@/lib/domain/types";
import { pushToPerson } from "@/lib/push";
import { certReminderMessages, CERT_REMINDER_FROM, CERT_REMINDER_UNTIL } from "@/lib/domain/certificates";
import { serviceReminderMessages } from "@/lib/domain/equipment";
import { canManage } from "@/lib/domain/access";
import { weeklyDigest, type SiteWeekReport } from "@/lib/domain/report";
import { weekStartOf } from "@/lib/domain/rota";
import { loadSiteReport } from "@/lib/report-service";
import { normalizeStaffCode } from "@/lib/domain/staff";
import { dueReminders, reminderKey, shiftReminderMessage, startingLaterToday, waitingFrom, type Waiting } from "@/lib/domain/reminders";

export interface RotaUpload { export: string[][]; weeks: string[][]; staff: string[][] }

/** Brings one site's stored shifts in line with its rota sheet and queues the messages that causes. */
export async function importRota(siteId: SiteId, upload: RotaUpload, now = Date.now()): Promise<RotaResult> {
  const db = store();
  const site = await db.site(siteId);
  if (!site) throw new Error("Unknown site");
  const staff = parseStaffTab(upload.staff);
  const weeks = parseWeekTable(upload.weeks);
  const { shifts, issues } = parseExport(siteId, upload.export, staff);

  // Staff IDs in the sheet must exist in the Hub (Owner → Staff accounts) to get shifts.
  const people = await db.people();
  const byCode = new Map(people.filter((p) => p.status !== "left").map((p) => [normalizeStaffCode(p.staffCode) ?? p.staffCode, p.id]));
  const missing = new Map<string, string>();
  for (const st of staff) if (!byCode.has(st.staffCode)) missing.set(st.staffCode, st.name);
  const known = shifts.filter((s) => byCode.has(s.staffCode));
  const messages = issues.map((i) => i.message);
  for (const [code, name] of Array.from(missing.entries())) {
    if (shifts.some((s) => s.staffCode === code)) messages.push(`${name} (${code}) has shifts but isn't set up in the Ops Hub yet. Add them under Owner → Staff accounts`);
  }

  const weekSet = new Set([...Array.from(weeks.keys()), ...known.map((s) => s.week)]);
  const before = await db.weekStatuses(siteId);
  const plan = planSync(await db.siteShifts(siteId), known, weekSet);
  await db.applyShiftSync(siteId, plan, byCode);
  await db.setWeekStatuses(siteId, weeks);

  const notices = buildImportNotices({ siteName: site.name, today: londonDate(now), plan, imported: known, before, after: weeks });
  const sendAfter = afterQuietHours(now);
  let queued = 0;
  for (const n of notices) {
    const personId = byCode.get(n.staffCode);
    if (personId && (await db.queueNotice({ personId, kind: n.kind, title: n.title, body: n.body, sendAfter }))) queued++;
  }

  const result: RotaResult = {
    at: now, rows: upload.export.length, shifts: known.length,
    added: plan.added.length, changed: plan.changed.length, cancelled: plan.cancelled.length, notices: queued,
    published: Array.from(weeks.entries()).filter(([w, st]) => st === "published" && before.get(w) !== "published").map(([w]) => w),
    issues: messages.slice(0, 50),
  };
  await db.recordRotaImport(siteId, result);
  await db.audit({ siteId, action: "rota.import", detail: `Rota imported: ${known.length} shifts · ${plan.added.length} new · ${plan.changed.length} changed · ${plan.cancelled.length} cancelled · ${queued} messages${messages.length ? ` · ${messages.length} issues` : ""}` });
  await deliverDue(now);
  return result;
}

/**
 * Runs every 10 minutes (Supabase schedule). Queues shift reminders as they fall due, the evening-before shift list
 * and, in the morning, certificate, service and report messages; then sends anything due.
 */
export async function tick(now = Date.now()): Promise<{ queued: number; sent: number }> {
  const db = store();
  let queued = 0;
  const hm = londonHM(now);
  if (hm >= EVENING_REMINDER_AT && hm < QUIET_START) {
    const tomorrow = addDays(londonDate(now), 1);
    const shifts = await db.shiftsOnDate(tomorrow);
    const personByCode = new Map(shifts.map((s) => [s.staffCode, s.personId]));
    for (const n of buildEveningNotices(tomorrow, shifts)) {
      const personId = personByCode.get(n.staffCode)!;
      if (await db.queueNotice({ personId, kind: "evening", title: n.title, body: n.body, dedupeKey: `evening|${personId}|${tomorrow}`, sendAfter: now })) queued++;
    }
  }
  // Shift reminders: every run, whatever the hour (each goes 2 hours before its shift).
  try { queued += (await queueShiftReminders(now, db)).length; } catch (e) { console.error("tick: shift reminders failed", e); }
  if (hm >= CERT_REMINDER_FROM && hm < CERT_REMINDER_UNTIL) {
    // Each morning job on its own: one failing mustn't stop the others or the sending below.
    for (const job of [queueCertReminders, queueServiceReminders, queueWeeklyReport]) {
      try { queued += await job(now); } catch (e) { console.error(`tick: ${job.name} failed`, e); }
    }
  }
  return { queued, sent: await deliverDue(now) };
}

/** Certificates running out (30 and 7 days before) or just run out. Each message has a key, so it's only queued once. */
export async function queueCertReminders(now = Date.now(), db: Store = store()): Promise<number> {
  const [people, certs] = await Promise.all([db.people(), db.certificates()]);
  let queued = 0;
  for (const m of certReminderMessages(people, certs, londonDate(now))) {
    if (await db.queueNotice({ personId: m.personId, kind: "cert", title: m.title, body: m.body, dedupeKey: m.dedupeKey, sendAfter: afterQuietHours(now), url: m.url })) queued++;
  }
  return queued;
}

/**
 * Sends queued messages as push notifications. They stay visible under My shifts either way. An action passes the
 * people it just messaged, so it only sends theirs; the scheduler sends everything due.
 */
export async function deliverDue(now = Date.now(), personIds?: string[]): Promise<number> {
  const db = store();
  let sent = 0;
  for (const n of await db.dueNotices(now, personIds ? 50 : 200, personIds)) {
    sent += await pushToPerson(n.personId, { title: n.title, body: n.body, url: n.url ?? "/me", tag: `${n.kind}-${n.id}` }, n.kind === "shift" || n.kind === "reply" ? "high" : "normal");
  }
  return sent;
}

/** Equipment services due within two weeks, or overdue: managers of the site are told once per due date. */
export async function queueServiceReminders(now = Date.now(), db: Store = store()): Promise<number> {
  const sites = (await db.sites()).filter((s) => s.status === "open");
  const people = await db.people();
  let queued = 0;
  for (const site of sites) {
    const [kit, events] = await Promise.all([db.equipment(site.id), db.equipmentEvents({ siteId: site.id })]);
    for (const m of serviceReminderMessages(kit, events, people, { [site.id]: site.name }, londonDate(now))) {
      if (await db.queueNotice({ personId: m.personId, kind: "service", title: m.title, body: m.body, dedupeKey: m.dedupeKey, sendAfter: afterQuietHours(now), url: m.url })) queued++;
    }
  }
  return queued;
}

/** Mondays: last week's report in a few lines for each owner and manager, about the open sites they run. */
export async function queueWeeklyReport(now = Date.now(), db: Store = store()): Promise<number> {
  const today = londonDate(now);
  if (weekStartOf(today) !== today) return 0;
  const week = addDays(today, -7);
  const sites = (await db.sites()).filter((s) => s.status === "open");
  const reports = new Map<SiteId, SiteWeekReport>();
  let queued = 0;
  for (const p of (await db.people()).filter((x) => x.status === "active")) {
    const mine = sites.filter((s) => canManage(p, s.id));
    if (!mine.length) continue;
    for (const s of mine) if (!reports.has(s.id)) reports.set(s.id, (await loadSiteReport(s, week, now, db)).week);
    const d = weeklyDigest(week, mine.map((s) => ({ name: s.name, r: reports.get(s.id)! })));
    if (await db.queueNotice({ personId: p.id, kind: "report", title: d.title, body: d.body, dedupeKey: `report|${week}|${p.id}`, sendAfter: afterQuietHours(now), url: `/manage/report?week=${week}` })) queued++;
  }
  return queued;
}

/** What's waiting at a site, for its shift reminders: open handover notes that need action, and prep still to do. */
export async function waitingAt(siteId: SiteId, db: Store = store()): Promise<Waiting> {
  const [notes, prepOn] = await Promise.all([db.handover(siteId), db.prepEnabledSites().then((s) => s.includes(siteId))]);
  const prep = prepOn ? await db.prepOutstanding(siteId) : [];
  const names = new Map(prep.length ? (await db.prepItems()).map((i) => [i.id, i.name]) : []);
  return waitingFrom(notes, prep.map((e) => ({ name: names.get(e.itemId) ?? "Prep item", urgent: e.urgent })));
}

/**
 * Queues shift reminders and returns who was messaged. "due": the scheduler, for shifts whose reminder time has come
 * (2 hours before). "now": the owner's button, for everyone starting later today. Either way a person gets one
 * reminder per shift, and it goes whatever the hour.
 */
export async function queueShiftReminders(now = Date.now(), db: Store = store(), mode: "due" | "now" = "due"): Promise<string[]> {
  const today = londonDate(now);
  const candidates = mode === "now"
    ? startingLaterToday(await db.shiftsOnDate(today), today, now)
    : dueReminders([...(await db.shiftsOnDate(today)), ...(await db.shiftsOnDate(addDays(today, 1)))], now);
  if (!candidates.length) return [];
  const already = await db.noticeKeys(candidates.map(reminderKey));
  const waiting = new Map<SiteId, Waiting>();
  const told: string[] = [];
  for (const s of candidates) {
    const key = reminderKey(s);
    if (already.has(key)) continue;
    if (!waiting.has(s.siteId)) waiting.set(s.siteId, await waitingAt(s.siteId, db));
    const m = shiftReminderMessage(s, waiting.get(s.siteId), today);
    if (await db.queueNotice({ personId: s.personId, kind: "shift", title: m.title, body: m.body, dedupeKey: key, sendAfter: now, url: "/me" })) told.push(s.personId);
  }
  return told;
}
