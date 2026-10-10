import { store } from "@/lib/data";
import { buildEveningNotices, buildImportNotices, EVENING_REMINDER_AT, parseExport, parseStaffTab, parseWeekTable, planSync } from "@/lib/domain/rota";
import { addDays, afterQuietHours, londonDate, londonHM, QUIET_START } from "@/lib/domain/time";
import type { RotaResult } from "@/lib/data/store";
import type { SiteId } from "@/lib/domain/types";
import { pushToPerson } from "@/lib/push";

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
  const byCode = new Map(people.filter((p) => p.status !== "left").map((p) => [p.staffCode.toUpperCase(), p.id]));
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

/** Runs every few minutes (Supabase schedule). Queues the evening-before reminders, then sends anything due. */
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
  return { queued, sent: await deliverDue(now) };
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
