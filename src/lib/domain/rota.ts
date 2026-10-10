import { normalizeStaffCode } from "./staff";
import { addDays, shortDay } from "./time";

/**
 * The rota lives in each site's Google Sheet. The sheet sends three tabs to the Hub (the Hub never writes back):
 *   Export   one row per person per section per week (formulas over the Rota tab)
 *            Week starting | Week # | Slot | Rota row | Name | Section | Mon hrs..Sun hrs | Week hrs | Checks |
 *            MON start | MON end | ... | SUN end | Days worked | Short rests
 *   Settings week table: Week # | Week starting ("Mon 5 Oct 2026") | ... | Status (Draft / Published)
 *   Staff    Name | Section | Active | Slot key | Notes | Capacity | Staff ID
 * Only Published weeks are shown to staff or send messages.
 */

export interface StaffRow { name: string; section: string; staffCode: string; active: boolean }
export interface ImportedShift {
  sourceKey: string;
  staffCode: string;
  section: string;
  week: string; // YYYY-MM-DD (Monday)
  date: string; // YYYY-MM-DD
  start: string; // HH:MM
  end: string; // HH:MM
  endsNextDay: boolean;
}
export interface StoredShift extends ImportedShift { cancelled: boolean }
export interface ImportIssue { row: number; message: string }
export type WeekStatus = "draft" | "published";

const DAY_START_COL = 15; // MON start
const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;
const pad = (t: string) => (t.length === 4 ? `0${t}` : t);

function isoFromSlash(ddmmyyyy: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(ddmmyyyy.trim());
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** "Mon 5 Oct 2026", "5 Oct 2026" or "05/10/2026" → "2026-10-05" */
export function parseSheetDate(s: string): string | null {
  const slash = isoFromSlash(s);
  if (slash) return slash;
  const m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(s);
  if (!m) return null;
  const mon = MONTHS.indexOf(m[2].toLowerCase());
  return mon < 0 ? null : `${m[3]}-${String(mon + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** Staff tab → name/section → Staff ID. Finds the header row by its "Name" and "Staff ID" columns. */
export function parseStaffTab(rows: string[][]): StaffRow[] {
  const h = rows.findIndex((r) => r.some((c) => c.trim() === "Name") && r.some((c) => c.trim() === "Staff ID"));
  if (h < 0) return [];
  const col = (name: string) => rows[h].findIndex((c) => c.trim() === name);
  const [n, s, a, id] = [col("Name"), col("Section"), col("Active"), col("Staff ID")];
  return rows.slice(h + 1)
    .filter((r) => (r[n] || "").trim() && normalizeStaffCode(r[id]))
    .map((r) => ({ name: r[n].trim(), section: (r[s] || "").trim().toUpperCase(), staffCode: normalizeStaffCode(r[id])!, active: (r[a] || "Yes").trim().toLowerCase() !== "no" }));
}

/** Settings week table → week start → status. Rows look like [week#, "Mon 5 Oct 2026", ..., "Draft"|"Published"]. */
export function parseWeekTable(rows: string[][]): Map<string, WeekStatus> {
  const out = new Map<string, WeekStatus>();
  for (const r of rows) {
    if (!/^\d+$/.test((r[0] || "").trim())) continue;
    const week = parseSheetDate(r[1] || "");
    if (!week) continue;
    const status = (r[7] || "").trim().toLowerCase();
    out.set(week, status === "published" ? "published" : "draft");
  }
  return out;
}

export function parseExport(siteId: string, rows: string[][], staff: StaffRow[]): { shifts: ImportedShift[]; issues: ImportIssue[] } {
  const shifts: ImportedShift[] = [];
  const issues: ImportIssue[] = [];
  const key = (n: string, s: string) => `${n.trim().toLowerCase()}|${s.trim().toUpperCase()}`;
  const index = new Map(staff.map((s) => [key(s.name, s.section), s.staffCode]));

  rows.forEach((r, i) => {
    const rowNo = i + 1;
    if ((r[0] || "").trim() === "Week starting") return;
    const name = (r[4] || "").trim();
    const section = (r[5] || "").trim().toUpperCase();
    if (!name) return; // empty slot
    const week = isoFromSlash(r[0] || "");
    if (!week) { issues.push({ row: rowNo, message: `Week start "${r[0]}" is not a date` }); return; }
    if (Number(r[14] || 0) > 0) { issues.push({ row: rowNo, message: `${name} (${section}), week of ${shortDay(week)}: the sheet flags this row (Checks), so it wasn't imported` }); return; }
    const staffCode = index.get(key(name, section));
    if (!staffCode) { issues.push({ row: rowNo, message: `${name} (${section}) has no Staff ID in the Staff tab` }); return; }
    for (let d = 0; d < 7; d++) {
      const start = (r[DAY_START_COL + d * 2] || "").trim();
      const end = (r[DAY_START_COL + d * 2 + 1] || "").trim();
      if (!start && !end) continue;
      const date = addDays(week, d);
      if (!TIME.test(start) || !TIME.test(end)) { issues.push({ row: rowNo, message: `${name}, ${shortDay(date)}: times "${start}–${end}" aren't valid` }); continue; }
      shifts.push({ sourceKey: `${siteId}|${week}|${staffCode}|${section}|${d}`, staffCode, section, week, date, start: pad(start), end: pad(end), endsNextDay: pad(end) <= pad(start) });
    }
  });
  return { shifts, issues };
}

export interface SyncPlan {
  /** New, or back after being removed. */
  added: ImportedShift[];
  changed: { before: StoredShift; after: ImportedShift }[];
  cancelled: StoredShift[];
}

/** What to change in the stored shifts so they match the sheet. Only weeks present in the import are touched. */
export function planSync(existing: StoredShift[], imported: ImportedShift[], weeks: Set<string>): SyncPlan {
  const byKey = new Map(existing.map((s) => [s.sourceKey, s]));
  const incoming = new Set(imported.map((s) => s.sourceKey));
  const plan: SyncPlan = { added: [], changed: [], cancelled: [] };
  for (const s of imported) {
    const old = byKey.get(s.sourceKey);
    if (!old || old.cancelled) plan.added.push(s);
    else if (old.start !== s.start || old.end !== s.end) plan.changed.push({ before: old, after: s });
  }
  for (const old of existing) if (!old.cancelled && weeks.has(old.week) && !incoming.has(old.sourceKey)) plan.cancelled.push(old);
  return plan;
}

export interface Notice { staffCode: string; title: string; body: string; kind: "published" | "changed" | "evening" }

const line = (s: { date: string; start: string; end: string; section: string }) => `${shortDay(s.date)} ${s.start}–${s.end} (${s.section})`;

/**
 * Messages to send after an import. A week that has just been Published sends each person one list of their
 * shifts that week; changes in weeks that were already Published send one message per person. Past days are skipped.
 */
export function buildImportNotices(args: {
  siteName: string; today: string; plan: SyncPlan; imported: ImportedShift[];
  before: Map<string, WeekStatus>; after: Map<string, WeekStatus>;
}): Notice[] {
  const { siteName, today, plan, imported, before, after } = args;
  const out: Notice[] = [];
  const upcoming = (d: string) => d >= today;
  const newlyPublished = new Set(Array.from(after.entries()).filter(([w, st]) => st === "published" && before.get(w) !== "published").map(([w]) => w));
  const stillPublished = (w: string) => after.get(w) === "published" && before.get(w) === "published";

  // 1. Newly published weeks: one message per person per week.
  const byPersonWeek = new Map<string, ImportedShift[]>();
  for (const s of imported) {
    if (!newlyPublished.has(s.week) || !upcoming(s.date)) continue;
    const k = `${s.staffCode}|${s.week}`;
    byPersonWeek.set(k, [...(byPersonWeek.get(k) ?? []), s]);
  }
  for (const [k, list] of Array.from(byPersonWeek.entries())) {
    const [staffCode, week] = k.split("|");
    list.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    out.push({ staffCode, kind: "published", title: `Rota out: ${siteName}, week of ${shortDay(week)}`, body: list.map(line).join("\n") });
  }

  // 2. Changes to weeks that were already published.
  const changes = new Map<string, string[]>();
  const push = (code: string, text: string) => changes.set(code, [...(changes.get(code) ?? []), text]);
  for (const s of plan.added) if (stillPublished(s.week) && upcoming(s.date)) push(s.staffCode, `New shift: ${line(s)}`);
  for (const c of plan.changed) if (stillPublished(c.after.week) && upcoming(c.after.date))
    push(c.after.staffCode, `${shortDay(c.after.date)} is now ${c.after.start}–${c.after.end} (was ${c.before.start}–${c.before.end})`);
  for (const s of plan.cancelled) if (stillPublished(s.week) && upcoming(s.date)) push(s.staffCode, `Cancelled: ${line(s)}`);
  for (const [staffCode, lines] of Array.from(changes.entries())) out.push({ staffCode, kind: "changed", title: `Rota change at ${siteName}`, body: lines.join("\n") });
  return out;
}

/** The evening-before reminder: one message per person listing tomorrow's shifts. */
export function buildEveningNotices(tomorrow: string, shifts: { staffCode: string; siteName: string; section: string; start: string; end: string; date: string }[]): Notice[] {
  const by = new Map<string, typeof shifts>();
  for (const s of shifts) if (s.date === tomorrow) by.set(s.staffCode, [...(by.get(s.staffCode) ?? []), s]);
  return Array.from(by.entries()).map(([staffCode, list]) => {
    list.sort((a, b) => a.start.localeCompare(b.start));
    return { staffCode, kind: "evening" as const, title: `Tomorrow (${shortDay(tomorrow)})`, body: list.map((s) => `${s.siteName}: ${s.start}–${s.end} (${s.section})`).join("\n") };
  });
}

export const EVENING_REMINDER_AT = "18:00";
