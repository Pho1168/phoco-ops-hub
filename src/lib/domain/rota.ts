/**
 * Reads the rota Google Sheet's "Export" tab (one row per person per section per week) and turns
 * it into shifts. The Hub never writes to the sheet. Only weeks marked Published send reminders.
 *
 * Export columns: Week starting | Week # | Slot | Rota row | Name | Section | Mon hrs..Sun hrs |
 *                 Week hrs | Checks | MON start | MON end | ... | SUN end | Days worked | Short rests
 */
export interface StaffRow { name: string; section: string; staffCode: string }
export interface ImportedShift {
  sourceKey: string;
  staffCode: string;
  section: string;
  date: string; // YYYY-MM-DD
  start: string; // HH:MM
  end: string; // HH:MM
  endsNextDay: boolean;
}
export interface ImportIssue { row: number; message: string }

const DAY_START_COL = 15; // MON start
const HEADER_NAME = "Week starting";

function isoDate(ddmmyyyy: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(ddmmyyyy.trim());
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;

export function parseExport(
  siteId: string,
  rows: string[][],
  staff: StaffRow[],
): { shifts: ImportedShift[]; issues: ImportIssue[] } {
  const shifts: ImportedShift[] = [];
  const issues: ImportIssue[] = [];
  const key = (n: string, s: string) => `${n.trim().toLowerCase()}|${s.trim().toUpperCase()}`;
  const index = new Map(staff.map((s) => [key(s.name, s.section), s.staffCode]));

  rows.forEach((r, i) => {
    const rowNo = i + 1;
    if (i === 0 && r[0] === HEADER_NAME) return;
    const name = (r[4] || "").trim();
    const section = (r[5] || "").trim().toUpperCase();
    if (!name) return; // empty slot
    const week = isoDate(r[0] || "");
    if (!week) { issues.push({ row: rowNo, message: `Week start "${r[0]}" is not a date` }); return; }
    if (Number(r[14] || 0) > 0) { issues.push({ row: rowNo, message: `${name}: the sheet flags this row (Checks). Not imported` }); return; }
    const staffCode = index.get(key(name, section));
    if (!staffCode) { issues.push({ row: rowNo, message: `${name} (${section}) has no Staff ID in the Staff tab` }); return; }
    for (let d = 0; d < 7; d++) {
      const start = (r[DAY_START_COL + d * 2] || "").trim();
      const end = (r[DAY_START_COL + d * 2 + 1] || "").trim();
      if (!start && !end) continue;
      if (!TIME.test(start) || !TIME.test(end)) { issues.push({ row: rowNo, message: `${name}: day ${d + 1} times "${start}–${end}" are not valid` }); continue; }
      const date = addDays(week, d);
      shifts.push({ sourceKey: `${siteId}|${week}|${staffCode}|${section}|${d}`, staffCode, section, date, start, end, endsNextDay: end <= start });
    }
  });
  return { shifts, issues };
}

export interface ReminderSettings { eveningBefore: string; hoursBefore: number; quietStart: string; quietEnd: string }
export const DEFAULT_REMINDERS: ReminderSettings = { eveningBefore: "18:00", hoursBefore: 2, quietStart: "22:00", quietEnd: "08:00" };

function minutes(hm: string) { const [h, m] = hm.split(":").map(Number); return h * 60 + m; }
function hm(mins: number) { const m = ((mins % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; }
function inQuiet(t: number, s: ReminderSettings) {
  const qs = minutes(s.quietStart), qe = minutes(s.quietEnd);
  return qs > qe ? t >= qs || t < qe : t >= qs && t < qe;
}

/** When to send reminders for one shift (local date/time). Skips a pre-shift reminder that falls in quiet hours. */
export function reminderTimes(shift: ImportedShift, published: boolean, s: ReminderSettings = DEFAULT_REMINDERS) {
  if (!published) return [];
  const out: { date: string; time: string; kind: "evening" | "before" }[] = [];
  out.push({ date: addDays(shift.date, -1), time: s.eveningBefore, kind: "evening" });
  const before = minutes(shift.start) - s.hoursBefore * 60;
  if (!inQuiet(((before % 1440) + 1440) % 1440, s)) out.push({ date: before < 0 ? addDays(shift.date, -1) : shift.date, time: hm(before), kind: "before" });
  return out;
}

/** Shifts that changed between two imports (same source key, different times) or disappeared. */
export function diffShifts(prev: ImportedShift[], next: ImportedShift[]) {
  const p = new Map(prev.map((s) => [s.sourceKey, s]));
  const n = new Map(next.map((s) => [s.sourceKey, s]));
  const changed = next.filter((s) => p.has(s.sourceKey) && (p.get(s.sourceKey)!.start !== s.start || p.get(s.sourceKey)!.end !== s.end));
  const added = next.filter((s) => !p.has(s.sourceKey));
  const cancelled = prev.filter((s) => !n.has(s.sourceKey));
  return { changed, added, cancelled };
}
