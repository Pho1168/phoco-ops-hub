import type { ReadingEntry, SignoffRow } from "./records";
import type { TeamShift } from "./rota";
import { londonToUtc } from "./time";

/**
 * The owner's weekly report for one site: checks, temperatures, alerts, handovers, prep and planned hours,
 * plus a short "needs attention" list in plain words. Everything comes from records the app already keeps.
 */

export interface ReportAlert { createdAt: number; resolvedAt?: number; level: "warning" | "critical" }
export interface ReportNote { createdAt: number; closedAt?: number; needsAction: boolean; category: string }
export interface ReportPrep { submittedAt: number; entries: { status: "outstanding" | "completed" | "carried"; carriedFrom?: string }[] }
export interface ReportFault { equipment: string; severity: "down" | "attention"; createdAt: number; fixedAt?: number }

export interface SiteWeekInput {
  week: string; now: number;
  /** The first day the site recorded a checklist (undefined: not started). */
  trackingFrom?: string;
  readings: ReadingEntry[]; signoffs: SignoffRow[]; alerts: ReportAlert[];
  notes: ReportNote[]; prep: ReportPrep[]; shifts: TeamShift[];
  /** Equipment problems at the site (any that were open during the week). */
  faults?: ReportFault[];
}

export interface Attention { level: "critical" | "warn" | "info"; text: string }

export interface SiteWeekReport {
  started: boolean;
  checks: { expected: number; onTime: number; late: number; notSigned: number; onTimeRate: number | null; worst: { listName: string; missed: number }[] };
  temps: { readings: number; outOfRange: number; critical: number; withAction: number; worst: { itemText: string; count: number }[] };
  alerts: { raised: number; critical: number; resolved: number; open: number; avgHoursToResolve: number | null };
  handover: { notes: number; actions: number; actionsDone: number; slow: number };
  prep: { sent: number; needed: number; carried: number };
  rota: { shifts: number; people: number; hours: number | null; byDay: number[]; bySection: { section: string; hours: number }[] };
  equipment: { reported: number; fixed: number; open: number; downHours: number; stillDown: { equipment: string; since: number }[] };
  attention: Attention[];
}

const DAY = 86_400_000;
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null);
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function siteWeekReport(x: SiteWeekInput): SiteWeekReport {
  // Checks: open ones (today, not yet due) aren't counted either way.
  const counted = x.signoffs.filter((s) => s.status !== "open");
  const onTime = counted.filter((s) => s.status === "on_time").length;
  const late = counted.filter((s) => s.status === "late").length;
  const notSigned = counted.filter((s) => s.status === "not_signed");
  const missedBy = new Map<string, number>();
  for (const s of notSigned) missedBy.set(s.listName, (missedBy.get(s.listName) ?? 0) + 1);
  const worst = Array.from(missedBy.entries()).map(([listName, missed]) => ({ listName, missed })).sort((a, b) => b.missed - a.missed || a.listName.localeCompare(b.listName));

  const out = x.readings.filter((r) => r.outcome === "warn" || r.outcome === "bad");
  const byItem = new Map<string, number>();
  for (const r of out) byItem.set(r.itemText, (byItem.get(r.itemText) ?? 0) + 1);
  const worstItems = Array.from(byItem.entries()).map(([itemText, count]) => ({ itemText, count })).sort((a, b) => b.count - a.count || a.itemText.localeCompare(b.itemText));

  const resolved = x.alerts.filter((a) => a.resolvedAt);
  const avgHours = resolved.length ? round1(resolved.reduce((t, a) => t + (a.resolvedAt! - a.createdAt), 0) / resolved.length / 3_600_000) : null;

  const actions = x.notes.filter((n) => n.needsAction);
  const slow = actions.filter((n) => (n.closedAt ?? x.now) - n.createdAt > DAY).length;

  const prepEntries = x.prep.flatMap((h) => h.entries);
  const needed = prepEntries.filter((e) => !e.carriedFrom).length;
  const carried = prepEntries.filter((e) => e.status === "carried").length;

  const days = Array.from({ length: 7 }, (_, i) => addDaysLocal(x.week, i));
  const withHours = x.shifts.filter((s) => s.hours !== undefined);
  const hours = withHours.length ? round2(withHours.reduce((t, s) => t + (s.hours ?? 0), 0)) : null;
  const sections = new Map<string, number>();
  for (const s of x.shifts) sections.set(s.section, (sections.get(s.section) ?? 0) + (s.hours ?? 0));

  // Equipment: the week runs Monday 00:00 to the next Monday 00:00 London, or to now for the current week.
  const from = londonToUtc(x.week, "00:00");
  const end = Math.min(londonToUtc(addDaysLocal(x.week, 7), "00:00"), x.now);
  const faults = x.faults ?? [];
  const openAtEnd = faults.filter((f) => f.createdAt < end && (!f.fixedAt || f.fixedAt > end));
  const downMs = faults.filter((f) => f.severity === "down")
    .reduce((t, f) => t + Math.max(0, Math.min(f.fixedAt ?? end, end) - Math.max(f.createdAt, from)), 0);

  const report: SiteWeekReport = {
    started: !!x.trackingFrom,
    checks: { expected: counted.length, onTime, late, notSigned: notSigned.length, onTimeRate: pct(onTime, counted.length), worst: worst.slice(0, 5) },
    temps: { readings: x.readings.length, outOfRange: out.length, critical: out.filter((r) => r.outcome === "bad").length, withAction: out.filter((r) => r.action).length, worst: worstItems.slice(0, 5) },
    alerts: { raised: x.alerts.length, critical: x.alerts.filter((a) => a.level === "critical").length, resolved: resolved.length, open: x.alerts.length - resolved.length, avgHoursToResolve: avgHours },
    handover: { notes: x.notes.length, actions: actions.length, actionsDone: actions.filter((n) => n.closedAt).length, slow },
    prep: { sent: x.prep.length, needed, carried },
    rota: {
      shifts: x.shifts.length, people: new Set(x.shifts.map((s) => s.personId)).size, hours,
      byDay: days.map((d) => round2(x.shifts.filter((s) => s.date === d).reduce((t, s) => t + (s.hours ?? 0), 0))),
      bySection: Array.from(sections.entries()).map(([section, h]) => ({ section, hours: round2(h) })).sort((a, b) => a.section.localeCompare(b.section)),
    },
    equipment: {
      reported: faults.filter((f) => f.createdAt >= from && f.createdAt < end).length,
      fixed: faults.filter((f) => f.fixedAt && f.fixedAt >= from && f.fixedAt < end).length,
      open: openAtEnd.length,
      downHours: round1(downMs / 3_600_000),
      stillDown: openAtEnd.filter((f) => f.severity === "down").map((f) => ({ equipment: f.equipment, since: f.createdAt })).sort((a, b) => a.since - b.since),
    },
    attention: [],
  };
  report.attention = attentionList(report, x);
  return report;
}

/** What to look at first, most serious first. Plain words, one line each. */
function attentionList(r: SiteWeekReport, x: SiteWeekInput): Attention[] {
  const a: Attention[] = [];
  const s = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const noAction = x.readings.filter((e) => (e.outcome === "warn" || e.outcome === "bad") && !e.action).length;
  if (noAction) a.push({ level: "critical", text: `${s(noAction, "temperature reading")} outside the limits with no corrective action recorded` });
  if (r.alerts.open) a.push({ level: "critical", text: `${s(r.alerts.open, "alert")} still open` });
  for (const d of r.equipment.stillDown.slice(0, 3)) {
    const days = Math.floor((x.now - d.since) / DAY);
    a.push({ level: "critical", text: `${d.equipment} not working${days >= 1 ? ` for ${s(days, "day")}` : ""}` });
  }
  if (!r.started) a.push({ level: "info", text: "Checklists haven't been used here yet. Set up the shop tablet to start recording" });
  for (const w of r.checks.worst.slice(0, 3)) a.push({ level: "warn", text: `${w.listName} not signed off on ${s(w.missed, "day")}` });
  for (const w of r.temps.worst.filter((w) => w.count >= 2).slice(0, 2)) a.push({ level: "warn", text: `${w.itemText} out of range ${w.count} times: worth checking the unit` });
  if (r.checks.late >= 3) a.push({ level: "warn", text: `${s(r.checks.late, "checklist")} signed off late` });
  if (r.handover.slow) a.push({ level: "warn", text: `${s(r.handover.slow, "handover action")} took more than a day to sort` });
  if (r.prep.carried) a.push({ level: "warn", text: `${s(r.prep.carried, "prep item")} not done by the next shift` });
  if (r.started && !r.temps.readings && r.checks.expected) a.push({ level: "warn", text: "No temperature readings recorded this week" });
  return a;
}

function addDaysLocal(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Change against last week, for the small "up/down" notes. Undefined when either side has nothing to compare. */
export function change(now: number | null, before: number | null): number | undefined {
  if (now === null || before === null) return undefined;
  return now - before;
}

export interface GroupTotals { sites: number; expected: number; onTime: number; notSigned: number; onTimeRate: number | null; outOfRange: number; openAlerts: number; hours: number | null; people: number; attention: number }

/** The head-office line across all sites in the report. */
export function groupTotals(reports: SiteWeekReport[], people: number): GroupTotals {
  const expected = reports.reduce((t, r) => t + r.checks.expected, 0);
  const onTime = reports.reduce((t, r) => t + r.checks.onTime, 0);
  const hoursKnown = reports.filter((r) => r.rota.hours !== null);
  return {
    sites: reports.length, expected, onTime, notSigned: reports.reduce((t, r) => t + r.checks.notSigned, 0), onTimeRate: pct(onTime, expected),
    outOfRange: reports.reduce((t, r) => t + r.temps.outOfRange, 0), openAlerts: reports.reduce((t, r) => t + r.alerts.open, 0),
    hours: hoursKnown.length ? round2(hoursKnown.reduce((t, r) => t + (r.rota.hours ?? 0), 0)) : null, people,
    attention: reports.reduce((t, r) => t + r.attention.filter((x) => x.level !== "info").length, 0),
  };
}
