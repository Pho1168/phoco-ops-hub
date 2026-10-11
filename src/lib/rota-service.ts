import { store } from "@/lib/data";
import { buildEveningNotices, buildImportNotices, EVENING_REMINDER_AT, parseExport, parseStaffTab, parseWeekTable, planSync } from "@/lib/domain/rota";
import { addDays, afterQuietHours, londonDate, londonHM, QUIET_START } from "@/lib/domain/time";
import type { RotaResult, Store } from "@/lib/data/store";
import type { SiteId } from "@/lib/domain/types";
import { pushToPerson } from "@/lib/push";
import { certReminderMessages, CERT_REMINDER_FROM, CERT_REMINDER_UNTIL } from "@/lib/domain/certificates";
import { serviceReminderMessages } from "@/lib/domain/equipment";
import { normalizeStaffCode } from "@/lib/domain/staff";

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

/** Runs every 10 minutes (Supabase schedule). Queues the evening-before shift reminders and, in the morning, certificate reminders; then sends anything due. */
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
  if (hm >= CERT_REMINDER_FROM && hm < CERT_REMINDER_UNTIL) {
    // Each morning job on its own: one failing mustn't stop the others or the sending below.
    for (const job of [queueCertReminders, queueServiceReminders]) {
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
    if (await db.queueNotice({ personId: m.personId, kind: "cert", title: m.title, body: m.body, dedupeKey: m.dedupeKey, sendAfter: afterQuietHours(now) })) queued++;
  }
  return queued;
}

/** Sends queued messages as push notifications. They stay visible under My shifts either way. */
export async function deliverDue(now = Date.now()): Promise<number> {
  const db = store();
  let sent = 0;
  for (const n of await db.dueNotices(now, 200)) {
    sent += await pushToPerson(n.personId, { title: n.title, body: n.body, url: "/me" });
    await db.markNoticeSent(n.id);
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
      if (await db.queueNotice({ personId: m.personId, kind: "service", title: m.title, body: m.body, dedupeKey: m.dedupeKey, sendAfter: afterQuietHours(now) })) queued++;
    }
  }
  return queued;
}
