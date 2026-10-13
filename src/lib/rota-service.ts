import { store } from "@/lib/data";
import { buildEveningNotices, buildImportNotices, EVENING_REMINDER_AT, parseExport, parseStaffTab, parseWeekTable, planSync } from "@/lib/domain/rota";
import { addDays, afterQuietHours, londonDate, londonHM, londonToUtc, QUIET_START } from "@/lib/domain/time";
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
import { canBeGiven, stillFor } from "@/lib/domain/assign";
import { dailyDigest, gasConfirmedMessages, gasMessages, notReadyMessages, DAILY_DIGEST_FROM, DAILY_DIGEST_UNTIL, READY_ALERT_WINDOW_MIN, type DayFacts } from "@/lib/domain/daily";
import { dayFacts, gasFor, readyFor, shiftsAround } from "@/lib/daily-service";
import { PHOTO_KEEP_UNUSED_DAYS } from "@/lib/domain/library";
import { missingStarts, trainingReminders } from "@/lib/domain/training";
import { trainingData } from "@/lib/training-service";

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
    if (shifts.some((s) => s.staffCode === code)) messages.push(`${name} (${code}) has shifts but isn't set up in the Ops Hub yet. Add them under Staff accounts on the overview`);
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
 * and, in the morning, certificate, service and report messages (and clears away unused photos); then sends anything due.
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
  // Every run, whatever the hour: shift reminders (2 hours before each shift), the gas check at close, and the
  // not-ready message at each site's ready time. Each on its own, so one failing doesn't stop the rest.
  try { queued += (await queueShiftReminders(now, db)).length; } catch (e) { console.error("tick: shift reminders failed", e); }
  for (const job of [queueGasChecks, queueReadyAlerts]) {
    try { queued += await job(now, db); } catch (e) { console.error(`tick: ${job.name} failed`, e); }
  }
  try { await startMissingTraining(now, db); } catch (e) { console.error("tick: training starts failed", e); }
  if (hm >= DAILY_DIGEST_FROM && hm < DAILY_DIGEST_UNTIL) {
    try { queued += await queueDailyDigest(now, db); } catch (e) { console.error("tick: daily digest failed", e); }
  }
  if (hm >= CERT_REMINDER_FROM && hm < CERT_REMINDER_UNTIL) {
    // Each morning job on its own: one failing mustn't stop the others or the sending below.
    for (const job of [queueCertReminders, queueServiceReminders, queueWeeklyReport, queueTrainingReminders]) {
      try { queued += await job(now); } catch (e) { console.error(`tick: ${job.name} failed`, e); }
    }
    // Tidying: photos no SOP version uses (taken off a step, or from a draft never saved) go after a week.
    try { await db.deleteUnusedMedia(now - PHOTO_KEEP_UNUSED_DAYS * 86_400_000); } catch (e) { console.error("tick: clearing unused photos failed", e); }
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

/** Training starts today for anyone training in a section with no start yet (on go-live, everyone). How many. */
export async function startMissingTraining(now = Date.now(), db: Store = store()): Promise<number> {
  const [people, sites, starts] = await Promise.all([db.people(), db.sites(), db.trainingStarts()]);
  const missing = missingStarts(people, sites, starts, londonDate(now));
  return missing.length ? db.addTrainingStarts(missing) : 0;
}

/** Training: a refresher coming up or due, or a skill to do again. Each message has a key, so it's only queued once. */
export async function queueTrainingReminders(now = Date.now(), db: Store = store()): Promise<number> {
  const [people, sites, data] = await Promise.all([db.people(), db.sites(), trainingData(db)]);
  let queued = 0;
  for (const m of trainingReminders(people, sites, data, londonDate(now))) {
    if (await db.queueNotice({ personId: m.personId, kind: "training", title: m.title, body: m.body, dedupeKey: m.dedupeKey, sendAfter: afterQuietHours(now), url: m.url })) queued++;
  }
  return queued;
}

/**
 * Sends queued messages as push notifications. They stay visible under My shifts either way. An action passes the
 * people it just messaged, so it only sends theirs; the scheduler sends everything due.
 */
export async function deliverDue(now = Date.now(), personIds?: string[]): Promise<number> {
  const db = store();
  const due = await db.dueNotices(now, personIds ? 50 : 200, personIds);
  const HIGH = new Set(["shift", "reply", "gas", "cover"]);
  let sent = 0;
  // Five at a time: an action that messages a whole team stays quick, without opening many connections at once.
  for (let i = 0; i < due.length; i += 5) {
    const batch = await Promise.all(due.slice(i, i + 5).map((n) =>
      pushToPerson(n.personId, { title: n.title, body: n.body, url: n.url ?? "/me", tag: `${n.kind}-${n.id}` }, HIGH.has(n.kind) ? "high" : "normal")));
    sent += batch.reduce((t, x) => t + x, 0);
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

/**
 * What's waiting at a site, for its shift reminders: open handover notes that need action, and prep still to do, with
 * who each is for (nobody in particular once that person has left the site or is frozen, so it isn't lost).
 */
export async function waitingAt(siteId: SiteId, db: Store = store()): Promise<Waiting> {
  const [notes, prepOn, people] = await Promise.all([db.handover(siteId), db.prepEnabledSites().then((s) => s.includes(siteId)), db.people()]);
  const prep = prepOn ? await db.prepOutstanding(siteId) : [];
  const names = new Map(prep.length ? (await db.prepItems()).map((i) => [i.id, i.name]) : []);
  const givable = new Set(people.filter((p) => canBeGiven(p, siteId)).map((p) => p.id));
  return waitingFrom(notes.map((n) => ({ ...n, assignedTo: stillFor(n.assignedTo, givable) })),
    prep.map((e) => ({ name: names.get(e.itemId) ?? "Prep item", urgent: e.urgent, assignedTo: stillFor(e.assignedTo, givable) })));
}

/**
 * Queues shift reminders and returns who was messaged. "due": the scheduler, for shifts whose reminder time has come
 * (2 hours before). "now": the overview's button, for everyone starting later today (only at `siteIds` when given:
 * an operations manager's sites). Either way a person gets one reminder per shift, and it goes whatever the hour.
 */
export async function queueShiftReminders(now = Date.now(), db: Store = store(), mode: "due" | "now" = "due", siteIds?: SiteId[]): Promise<string[]> {
  const today = londonDate(now);
  const all = mode === "now"
    ? startingLaterToday(await db.shiftsOnDate(today), today, now)
    : dueReminders([...(await db.shiftsOnDate(today)), ...(await db.shiftsOnDate(addDays(today, 1)))], now);
  const candidates = siteIds ? all.filter((s) => siteIds.includes(s.siteId)) : all;
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

/**
 * The gas check at close: the closers are reminded from 15 minutes before the last shift ends, and the site's
 * managers and owners are told if nobody has tapped 30 minutes after. Both go whatever the hour. Each site on its own,
 * so one failing doesn't stop the others.
 */
export async function queueGasChecks(now = Date.now(), db: Store = store()): Promise<number> {
  const sites = (await db.sites()).filter((s) => s.status === "open");
  const shifts = await shiftsAround(now, db);
  let people: Awaited<ReturnType<Store["people"]>> | undefined;
  let queued = 0;
  for (const site of sites) {
    try {
      const g = await gasFor(site, now, db, { shifts });
      if (!g || (g.state !== "due" && g.state !== "overdue")) continue;
      people ??= await db.people();
      const alerted: string[] = [];
      for (const m of gasMessages(site, g.day, g.state, people, now)) {
        if (await db.queueNotice({ personId: m.personId, kind: "gas", title: m.title, body: m.body, dedupeKey: m.dedupeKey, sendAfter: now, url: m.url })) {
          queued++;
          if (m.kind === "alert") alerted.push(m.personId);
        }
      }
      // Someone may have tapped while the alert was being queued: if so, tell those just alerted that it's done.
      const [check] = alerted.length ? await db.gasChecks([site.id], g.day.date, g.day.date) : [];
      if (check) {
        for (const m of gasConfirmedMessages(site, g.day, check.personName, check.onTablet, check.createdAt, alerted)) {
          if (await db.queueNotice({ personId: m.personId, kind: "gas", title: m.title, body: m.body, dedupeKey: m.dedupeKey, sendAfter: now, url: m.url })) queued++;
        }
      }
    } catch (e) { console.error(`tick: gas check at ${site.id} failed`, e); }
  }
  return queued;
}

/**
 * For half an hour from each site's ready time: if it isn't ready (red), its managers and owners are told why, once.
 * Kit, alerts and replies count only if they were there at the ready time.
 */
export async function queueReadyAlerts(now = Date.now(), db: Store = store()): Promise<number> {
  const today = londonDate(now);
  const due = (await db.sites()).filter((s) => {
    if (s.status !== "open" || !s.readyBy) return false;
    const at = londonToUtc(today, s.readyBy);
    return now >= at && now < at + READY_ALERT_WINDOW_MIN * 60_000;
  });
  if (!due.length) return 0;
  const people = await db.people();
  let queued = 0;
  for (const site of due) {
    const r = await readyFor(site, now, db, { people }, { asOf: londonToUtc(today, site.readyBy!) });
    if (!r) continue;
    for (const m of notReadyMessages(site, today, r, people)) {
      if (await db.queueNotice({ personId: m.personId, kind: "ready", title: m.title, body: m.body, dedupeKey: m.dedupeKey, sendAfter: now, url: m.url })) queued++;
    }
  }
  return queued;
}

/**
 * 08:00–09:00: yesterday at a glance for each owner and manager, about the open sites they run that were in use.
 * Once a day: people who already have theirs are skipped before anything is worked out.
 */
export async function queueDailyDigest(now = Date.now(), db: Store = store()): Promise<number> {
  const yesterday = addDays(londonDate(now), -1);
  const sites = (await db.sites()).filter((s) => s.status === "open");
  const key = (id: string) => `daily|${yesterday}|${id}`;
  const managers = (await db.people()).filter((p) => p.status === "active" && sites.some((s) => canManage(p, s.id)));
  const sent = await db.noticeKeys(managers.map((p) => key(p.id)));
  const facts = new Map<SiteId, DayFacts>();
  let queued = 0;
  for (const p of managers.filter((x) => !sent.has(key(x.id)))) {
    const mine = sites.filter((s) => canManage(p, s.id));
    for (const s of mine) if (!facts.has(s.id)) facts.set(s.id, await dayFacts(s, yesterday, now, db));
    // A site that wasn't in use yesterday (not on the rota, no checklists, nothing reported) is left out.
    const used = mine.map((s) => facts.get(s.id)!).filter((f) => f.onRota || f.checks.expected || f.faults.reported || f.notesLeft || f.alertsRaised);
    if (!used.length) continue;
    const d = dailyDigest(yesterday, used);
    if (await db.queueNotice({ personId: p.id, kind: "daily", title: d.title, body: d.body, dedupeKey: key(p.id), sendAfter: now, url: "/manage/records" })) queued++;
  }
  return queued;
}
