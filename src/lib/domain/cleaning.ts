import type { Area, SiteId } from "./types";
import { addDays, londonDate, shortDay } from "./time";

/**
 * The cleaning board: jobs done once or twice a week (or once a month) on no fixed day. Whoever takes one this week
 * claims it ("I'll do it"), then ticks it done; until it's done it stays on the board for everyone, amber late in the
 * week and orange on the last day. A job not done by the end of its week or month is marked missed (once) and the
 * site's managers are told. Everything is an event, only ever added (migration 0040).
 *
 * A job done every few months ("every", migration 0041: the air con every 6 months) runs from when it was last done:
 * it's due `everyMonths` after that (or on `firstDue` until it's first done), stays off the board until
 * `EVERY_SHOW_DAYS` before then, and the managers get a reminder when it comes up. It's never "missed"; it stays on
 * the board, due now, until it's done.
 */

export type CleanPer = "week" | "month" | "every";
export interface CleaningJob {
  id: string; siteId: SiteId; area: Area; name: string;
  /** How often: `times` per week or per month; or once every `everyMonths` months ("every"). */
  per: CleanPer; times: number;
  /** "every" only: how many months after it was last done, and when it's first due (YYYY-MM-DD). */
  everyMonths?: number; firstDue?: string;
  position: number; active: boolean; createdAt: number;
}
/** A job done every few months shows on the board this many days before it's due. */
export const EVERY_SHOW_DAYS = 14;
export type CleaningEventKind = "claimed" | "released" | "done" | "missed";
export interface CleaningEvent {
  id: string; jobId: string;
  /** The week (its Monday) or month (its 1st) it counts for, as YYYY-MM-DD; for an "every" job, the date it was due. */
  period: string;
  kind: CleaningEventKind;
  /** Who; none for "missed", which the app records. */
  personId?: string; personName?: string;
  /** For missed: how many were done of how many. */
  note?: string;
  at: number;
}

export const AREA_LABEL: Record<Area, string> = { BOH: "Kitchen", FOH: "Front of house", PROD: "Production" };
export const howOften = (j: Pick<CleaningJob, "per" | "times" | "everyMonths">) =>
  j.per === "every" ? `Every ${j.everyMonths ?? 1} month${j.everyMonths === 1 ? "" : "s"}` : j.times === 1 ? (j.per === "week" ? "Once a week" : "Once a month") : j.times === 2 ? (j.per === "week" ? "Twice a week" : "Twice a month") : `${j.times} times a ${j.per}`;

/** A date some months on, kept to the end of a shorter month (31 Aug + 6 months = 28 Feb). */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = (m - 1) + n, year = y + Math.floor(t / 12), month = ((t % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
const niceDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** When an "every" job is next due: some months after it was last done, or its first due date. */
export function dueOf(job: Pick<CleaningJob, "id" | "everyMonths" | "firstDue">, events: CleaningEvent[]): string {
  const last = events.filter((e) => e.jobId === job.id && e.kind === "done").sort((a, b) => b.at - a.at)[0];
  return last ? addMonths(londonDate(last.at), job.everyMonths ?? 6) : job.firstDue ?? londonDate(Date.now());
}

/** The week (Monday, London) or month (the 1st) a moment falls in. */
export function periodStart(per: CleanPer, now: number): string {
  const d = londonDate(now);
  if (per === "month") return `${d.slice(0, 7)}-01`;
  const dow = (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7; // Mon = 0
  return addDays(d, -dow);
}
/** The first day after the period. */
export function periodEnd(per: CleanPer, start: string): string {
  if (per === "week") return addDays(start, 7);
  const [y, m] = start.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}
/** The period before this one. */
export function previousPeriod(per: CleanPer, start: string): string {
  if (per === "week") return addDays(start, -7);
  const [y, m] = start.split("-").map(Number);
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
}
export const periodLabel = (per: CleanPer, start: string) =>
  per === "week" ? `week of ${shortDay(start)}` : new Date(`${start}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export type CleanUrgency = "ok" | "soon" | "late";
export interface JobView {
  job: CleaningJob; period: string;
  /** Done this period, oldest first. */
  done: CleaningEvent[];
  complete: boolean;
  /** Who has said they'll do it (the latest claim, not since let go or done). */
  claimed?: { personId: string; name?: string; at: number };
  urgency: CleanUrgency;
  /** The last time it was done, in any period. */
  lastDone?: CleaningEvent;
  /** Missed in the period before this one. */
  missedLast: boolean;
  /** "every" jobs: when it's due (complete means it isn't on the board yet). */
  dueOn?: string;
}

/**
 * How late in its period a job is: a week is "soon" from Thursday and "late" on Sunday; a month is "soon" in its last
 * 10 days and "late" in the last 3. A job done as often as it should be is fine. A job done twice a week that hasn't
 * had its first by Wednesday is "soon" too.
 */
export function urgencyOf(job: Pick<CleaningJob, "per" | "times">, period: string, count: number, now: number): CleanUrgency {
  if (count >= job.times) return "ok";
  const today = londonDate(now);
  const left = Math.round((Date.parse(`${periodEnd(job.per, period)}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000); // days left, today included
  if (job.per === "week") {
    if (left <= 1) return "late";
    if (left <= 4 || (job.times > 1 && count === 0 && left <= 5)) return "soon";
    return "ok";
  }
  if (left <= 3) return "late";
  return left <= 10 ? "soon" : "ok";
}

function everyView(job: CleaningJob, events: CleaningEvent[], now: number): JobView {
  const mine = events.filter((e) => e.jobId === job.id).sort((a, b) => a.at - b.at);
  const due = dueOf(job, mine);
  const today = londonDate(now);
  const here = mine.filter((e) => e.period === due);
  const last = [...here].reverse().find((e) => e.kind === "claimed" || e.kind === "released" || e.kind === "done");
  const complete = today < addDays(due, -EVERY_SHOW_DAYS);
  const claimed = !complete && last?.kind === "claimed" && last.personId ? { personId: last.personId, name: last.personName, at: last.at } : undefined;
  const lastDone = [...mine].reverse().find((e) => e.kind === "done");
  return { job, period: due, done: [], complete, claimed, urgency: complete ? "ok" : today >= addDays(due, -3) ? "late" : "soon", lastDone, missedLast: false, dueOn: due };
}

export function jobView(job: CleaningJob, events: CleaningEvent[], now: number): JobView {
  if (job.per === "every") return everyView(job, events, now);
  const period = periodStart(job.per, now);
  const mine = events.filter((e) => e.jobId === job.id).sort((a, b) => a.at - b.at);
  const here = mine.filter((e) => e.period === period);
  const done = here.filter((e) => e.kind === "done");
  // The latest of claimed / let go / done decides who has it: a claim lasts until it's let go or done.
  const last = [...here].reverse().find((e) => e.kind === "claimed" || e.kind === "released" || e.kind === "done");
  const complete = done.length >= job.times;
  const claimed = !complete && last?.kind === "claimed" && last.personId ? { personId: last.personId, name: last.personName, at: last.at } : undefined;
  const lastDone = [...mine].reverse().find((e) => e.kind === "done");
  const prev = previousPeriod(job.per, period);
  return { job, period, done, complete, claimed, urgency: urgencyOf(job, period, done.length, now), lastDone, missedLast: mine.some((e) => e.kind === "missed" && e.period === prev) };
}

/** The board: what still needs doing first (late, then soon, then the rest), then what's done; in list order within. */
export function cleaningBoard(jobs: CleaningJob[], events: CleaningEvent[], now: number): JobView[] {
  const rank: Record<CleanUrgency, number> = { late: 0, soon: 1, ok: 2 };
  return jobs.filter((j) => j.active).map((j) => jobView(j, events, now))
    .sort((a, b) => Number(a.complete) - Number(b.complete) || rank[a.urgency] - rank[b.urgency] || a.job.position - b.job.position);
}

export type CleaningAction = "claimed" | "released" | "done";
/**
 * Whether someone can do this now: claim a job that isn't done yet (taking it over from someone else is fine), let
 * go of their own claim, or tick it done (claimed or not) while it still needs doing this period.
 */
export function canAct(view: Pick<JobView, "complete" | "claimed">, action: CleaningAction, personId: string): { ok: true } | { ok: false; error: string } {
  if (action === "released") return view.claimed?.personId === personId ? { ok: true } : { ok: false, error: "You haven't said you'll do that one" };
  if (view.complete) return { ok: false, error: "That's already done for now" };
  if (action === "claimed" && view.claimed?.personId === personId) return { ok: false, error: "You've already said you'll do it" };
  return { ok: true };
}

/** The status line on the board: "Done Tue by Jamie", "1 of 2 done · Sam is doing it", "Nobody yet". */
export function statusLine(v: JobView): string {
  const first = (n?: string) => (n ? n.split(" ")[0] : "someone");
  const day = (t: number) => new Date(t).toLocaleDateString("en-GB", { weekday: "short", timeZone: "Europe/London" });
  if (v.job.per === "every") {
    const last = v.lastDone ? ` · last done ${niceDate(londonDate(v.lastDone.at))} by ${first(v.lastDone.personName)}` : "";
    if (v.complete) return `Next due ${niceDate(v.dueOn!)}${last}`;
    return `${v.claimed ? `${first(v.claimed.name)} is doing it` : "Nobody has taken it yet"} · due by ${niceDate(v.dueOn!)}`;
  }
  const lastBy = v.done.length ? `${day(v.done[v.done.length - 1].at)} by ${first(v.done[v.done.length - 1].personName)}` : "";
  if (v.complete) return v.job.times > 1 ? `Done ${v.done.length} of ${v.job.times} · last ${lastBy}` : `Done ${lastBy}`;
  const parts = [
    ...(v.job.times > 1 ? [`${v.done.length} of ${v.job.times} done`] : []),
    v.claimed ? `${first(v.claimed.name)} is doing it` : "Nobody has taken it yet",
  ];
  return parts.join(" · ");
}

/**
 * Jobs to mark missed: each active job's period before this one, when it was done fewer times than it should be and
 * isn't marked yet. A period only counts if the job was on the board for at least 4 days of it (a job added on a
 * Saturday isn't missed that weekend).
 */
export function missedJobs(jobs: CleaningJob[], events: CleaningEvent[], now: number): { job: CleaningJob; period: string; count: number }[] {
  const out: { job: CleaningJob; period: string; count: number }[] = [];
  for (const job of jobs.filter((j) => j.active && j.per !== "every")) {
    const period = previousPeriod(job.per, periodStart(job.per, now));
    const end = Date.parse(`${periodEnd(job.per, period)}T00:00:00Z`);
    if (job.createdAt > end - 4 * 86_400_000) continue;
    const here = events.filter((e) => e.jobId === job.id && e.period === period);
    if (here.some((e) => e.kind === "missed")) continue;
    const count = here.filter((e) => e.kind === "done").length;
    if (count < job.times) out.push({ job, period, count });
  }
  return out;
}

/** The message to a site's managers about what was missed (one per site per period end). */
export function missedMessage(siteName: string, missed: { job: CleaningJob; period: string; count: number }[]): { title: string; body: string } {
  const line = (m: (typeof missed)[number]) => `${m.job.name}${m.job.times > 1 ? ` (${m.count} of ${m.job.times})` : ""}`;
  return {
    title: `${siteName}: ${missed.length} cleaning job${missed.length === 1 ? "" : "s"} missed`,
    body: `Not done in the ${periodLabel(missed[0].job.per, missed[0].period)}: ${missed.map(line).join(", ")}.`,
  };
}

/** A site's cleaning at a glance, for the owner screen: what's done this week, what's late, what was missed. */
export function cleaningSummary(board: JobView[]): { total: number; complete: number; late: number; soon: number; missedLast: number } {
  return {
    total: board.length, complete: board.filter((v) => v.complete).length,
    late: board.filter((v) => !v.complete && v.urgency === "late").length, soon: board.filter((v) => !v.complete && v.urgency === "soon").length,
    missedLast: board.filter((v) => v.missedLast).length,
  };
}

/** "every" jobs that have just come up on the board (due within `EVERY_SHOW_DAYS`, or overdue, and not done). */
export function comingDue(jobs: CleaningJob[], events: CleaningEvent[], now: number): { job: CleaningJob; due: string }[] {
  return jobs.filter((j) => j.active && j.per === "every").map((j) => everyView(j, events, now)).filter((v) => !v.complete).map((v) => ({ job: v.job, due: v.dueOn! }));
}
/** The reminder to a site's managers when an "every" job comes up. */
export function dueMessage(siteName: string, job: CleaningJob, due: string): { title: string; body: string } {
  return { title: `${siteName}: ${job.name} due by ${niceDate(due)}`, body: `${howOften(job)}. It's on the cleaning board now: take it with "I'll do it" and tick it done on the tablet.` };
}
