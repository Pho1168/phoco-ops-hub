import { addDays, daysBetween, isIsoDate, shortDay } from "./time";

/**
 * My Day: the owner's own to-do list (migration 0049). Private: only the person it belongs to sees it, and only owners
 * have one. Tasks happen once (on a date, or whenever) or repeat every week (on a weekday) or every month (on a day of
 * the month; in a shorter month, its last day). A repeating task shows one occurrence at a time: the earliest not yet
 * done or skipped. So anything not done is carried forward and shows as overdue until it's ticked. Ticks are only
 * added (done, skipped or undone; the latest for a task and date counts). Tasks are stopped, never deleted.
 */

/** 1 urgent, 2 this week, 3 can wait. Colours follow it (orange, amber, teal); done is grey. */
export type MyPriority = 1 | 2 | 3;
export type MyRepeat = "once" | "weekly" | "monthly";
export type MyMarkKind = "done" | "skipped" | "undone";

export interface MyTask {
  id: string;
  personId: string;
  title: string;
  note?: string;
  priority: MyPriority;
  repeat: MyRepeat;
  /** weekly: ISO weekday (1 Monday … 7 Sunday); monthly: day of the month (1–31). */
  day?: number;
  /** once: the date it's due, or none for "whenever". */
  dueOn?: string;
  /** The first day it counts from (a repeating task's first occurrence is on or after it). */
  startsOn: string;
  /** Days before it's due to send a phone message (0: on the day). None: no message. */
  alertDays?: number;
  /** Pinned to the Top 3. */
  top: boolean;
  status: "open" | "stopped";
  createdAt: number;
}

export interface MyMark { id: string; taskId: string; dueOn: string; kind: MyMarkKind; at: number }

export const MY_TITLE_MAX = 120;
export const MY_NOTE_MAX = 500;
export const MY_ALERT_MAX = 14;
/** The Top 3: never more, so the first glance stays calm. */
export const TOP_MAX = 3;
/** "This week": due within this many days after today. */
export const WEEK_AHEAD = 6;
/** How far a repeating task looks for its next occurrence before giving up (a guard, not a rule). */
const SEARCH_LIMIT = 2000;

export const PRIORITY_LABEL: Record<MyPriority, string> = { 1: "Urgent", 2: "This week", 3: "Can wait" };
export const TONE: Record<MyPriority, "late" | "now" | "calm"> = { 1: "late", 2: "now", 3: "calm" };
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** ISO weekday of a date: 1 Monday … 7 Sunday. */
export function isoWeekday(iso: string): number {
  const d = new Date(iso + "T12:00:00Z").getUTCDay();
  return d === 0 ? 7 : d;
}

/** The month's `day`, or its last day when the month is shorter (the 30th in February is the 28th or 29th). */
export function monthDay(year: number, month: number, day: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

/** The first occurrence of a repeating task on or after `from`. */
export function occurrenceFrom(t: Pick<MyTask, "repeat" | "day">, from: string): string {
  if (t.repeat === "weekly") return addDays(from, (t.day! - isoWeekday(from) + 7) % 7);
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  for (;;) {
    const d = monthDay(y, m, t.day!);
    if (d >= from) return d;
    if (++m > 12) { m = 1; y++; }
  }
}

/** The occurrence after `due`. */
export function nextAfter(t: Pick<MyTask, "repeat" | "day">, due: string): string {
  return occurrenceFrom(t, addDays(due, 1));
}

/** For each task and date, whether it's been dealt with (done or skipped): the latest tick counts. */
export function handled(marks: MyMark[]): Map<string, MyMark> {
  const latest = new Map<string, MyMark>();
  for (const m of [...marks].sort((a, b) => a.at - b.at)) latest.set(`${m.taskId}|${m.dueOn}`, m);
  for (const [k, m] of latest) if (m.kind === "undone") latest.delete(k);
  return latest;
}

/** The date a once-task's tick is kept under: its due date, or its start for "whenever". */
export const onceKey = (t: Pick<MyTask, "dueOn" | "startsOn">) => t.dueOn ?? t.startsOn;

/**
 * The occurrence to show now: a once-task until it's ticked; a repeating task's earliest one not ticked (so a missed
 * one stays, overdue). Undefined: nothing left (a once-task done, or a stopped task).
 */
export function currentDue(t: MyTask, done: Map<string, MyMark>): string | undefined {
  if (t.status !== "open") return undefined;
  if (t.repeat === "once") return done.has(`${t.id}|${onceKey(t)}`) ? undefined : onceKey(t);
  let due = occurrenceFrom(t, t.startsOn);
  for (let i = 0; i < SEARCH_LIMIT && done.has(`${t.id}|${due}`); i++) due = nextAfter(t, due);
  return due;
}

export type MyState = "late" | "today" | "week" | "later" | "anytime";
export interface MyItem { task: MyTask; due: string; state: MyState; tone: "late" | "now" | "calm"; overdueDays: number }

export function stateOf(t: MyTask, due: string, today: string): MyState {
  if (t.repeat === "once" && !t.dueOn) return "anytime";
  const d = daysBetween(today, due);
  return d < 0 ? "late" : d === 0 ? "today" : d <= WEEK_AHEAD ? "week" : "later";
}

export interface MyDayView {
  /** At most 3: pinned first, then overdue, then today, by priority. */
  top: MyItem[];
  /** The rest of what's for today, carried-forward ones first. */
  today: MyItem[];
  week: MyItem[];
  later: MyItem[];
  /** Once-tasks with no date. */
  anytime: MyItem[];
  /** Ticked today (done or skipped), newest first: can be put back. */
  doneToday: { task: MyTask; due: string; kind: "done" | "skipped" }[];
  /** How many of today's (and overdue) are still open. */
  leftToday: number;
}

const order = (a: MyItem, b: MyItem) =>
  Number(b.task.top) - Number(a.task.top) || Number(b.state === "late") - Number(a.state === "late")
  || a.task.priority - b.task.priority || a.due.localeCompare(b.due) || a.task.title.localeCompare(b.task.title);

/** Everything on the list for `today` (London date), sorted into the screen's sections. */
export function myDay(tasks: MyTask[], marks: MyMark[], today: string, todayStart: number): MyDayView {
  const done = handled(marks);
  const items: MyItem[] = [];
  for (const t of tasks) {
    const due = currentDue(t, done);
    if (!due) continue;
    const state = stateOf(t, due, today);
    items.push({ task: t, due, state, tone: TONE[t.priority], overdueDays: state === "late" ? daysBetween(due, today) : 0 });
  }
  items.sort(order);
  // Today's pool: overdue, due today, urgent "whenever" tasks, and anything pinned.
  const pool = items.filter((i) => i.state === "late" || i.state === "today" || i.task.top || (i.state === "anytime" && i.task.priority === 1));
  const top = pool.slice(0, TOP_MAX);
  const inTop = new Set(top.map((i) => i.task.id));
  const rest = items.filter((i) => !inTop.has(i.task.id));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const doneToday = [...done.values()].filter((m) => m.at >= todayStart && byId.has(m.taskId))
    .sort((a, b) => b.at - a.at).map((m) => ({ task: byId.get(m.taskId)!, due: m.dueOn, kind: m.kind as "done" | "skipped" }));
  return {
    top,
    today: rest.filter((i) => i.state === "late" || i.state === "today"),
    week: rest.filter((i) => i.state === "week"),
    later: rest.filter((i) => i.state === "later"),
    anytime: rest.filter((i) => i.state === "anytime"),
    doneToday,
    leftToday: items.filter((i) => i.state === "late" || i.state === "today").length,
  };
}

/** "Today", "Tomorrow", "Overdue since Fri 30 Oct", "Mon 2 Nov", or "No date". */
export function dueWords(i: Pick<MyItem, "due" | "state">, today: string): string {
  if (i.state === "anytime") return "No date";
  const d = daysBetween(today, i.due);
  if (d < 0) return `Overdue since ${shortDay(i.due)}`;
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  return shortDay(i.due);
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

/** "Every Monday", "Every month on the 30th", or "" for a once-task. */
export function repeatWords(t: Pick<MyTask, "repeat" | "day">): string {
  if (t.repeat === "weekly") return `Every ${WEEKDAYS[t.day! - 1]}`;
  if (t.repeat === "monthly") return `Every month on the ${ordinal(t.day!)}${t.day! > 28 ? " (last day in shorter months)" : ""}`;
  return "";
}

/** "Alert 2 days before", "Alert on the day", or "". */
export function alertWords(t: Pick<MyTask, "alertDays">): string {
  if (t.alertDays === undefined) return "";
  return t.alertDays === 0 ? "Alert on the day" : `Alert ${t.alertDays} day${t.alertDays === 1 ? "" : "s"} before`;
}

export interface MyTaskInput {
  title: string; note?: string; priority: number; repeat: string; day?: number; dueOn?: string; alertDays?: number; top?: boolean;
}
export type MyTaskClean = Pick<MyTask, "title" | "note" | "priority" | "repeat" | "day" | "dueOn" | "alertDays" | "top">;

/** Checks and tidies a task from the form. */
export function cleanMyTask(x: MyTaskInput): { ok: true; value: MyTaskClean } | { ok: false; error: string } {
  const title = x.title.trim().replace(/\s+/g, " ");
  if (!title) return { ok: false, error: "Give the task a name" };
  if (title.length > MY_TITLE_MAX) return { ok: false, error: `Keep the name under ${MY_TITLE_MAX} characters` };
  const note = x.note?.trim() || undefined;
  if (note && note.length > MY_NOTE_MAX) return { ok: false, error: `Keep the note under ${MY_NOTE_MAX} characters` };
  if (![1, 2, 3].includes(x.priority)) return { ok: false, error: "Pick how urgent it is" };
  const priority = x.priority as MyPriority;
  if (x.alertDays !== undefined && (!Number.isInteger(x.alertDays) || x.alertDays < 0 || x.alertDays > MY_ALERT_MAX)) return { ok: false, error: "Pick when to be reminded" };
  const base = { title, note, priority, alertDays: x.alertDays, top: !!x.top };
  if (x.repeat === "once") {
    if (x.dueOn !== undefined && !isIsoDate(x.dueOn)) return { ok: false, error: "Pick a real date" };
    if (x.dueOn === undefined && x.alertDays !== undefined) return { ok: false, error: "A reminder needs a date" };
    return { ok: true, value: { ...base, repeat: "once", dueOn: x.dueOn } };
  }
  if (x.repeat === "weekly") {
    if (!Number.isInteger(x.day) || x.day! < 1 || x.day! > 7) return { ok: false, error: "Pick the day of the week" };
    return { ok: true, value: { ...base, repeat: "weekly", day: x.day } };
  }
  if (x.repeat === "monthly") {
    if (!Number.isInteger(x.day) || x.day! < 1 || x.day! > 31) return { ok: false, error: "Pick the day of the month (1–31)" };
    return { ok: true, value: { ...base, repeat: "monthly", day: x.day } };
  }
  return { ok: false, error: "Pick once, every week or every month" };
}

/**
 * When a repeating task starts counting. New: today. Changed to a different day or schedule: today, so the
 * change doesn't make past dates overdue; otherwise it keeps its start (its ticks still line up).
 */
export function startsFor(before: Pick<MyTask, "repeat" | "day" | "startsOn"> | undefined, after: Pick<MyTask, "repeat" | "day">, today: string): string {
  if (!before || before.repeat !== after.repeat || before.day !== after.day) return today;
  return before.startsOn;
}

/** A phone message for one occurrence: a heads-up `alertDays` before, and one on the day. */
export interface MyAlert { personId: string; taskId: string; due: string; stage: "ahead" | "day"; title: string; body: string; dedupeKey: string }

/** The messages due today (London date) for open tasks with a reminder. Each has a key, so it's only sent once. */
export function myAlerts(tasks: MyTask[], marks: MyMark[], today: string): MyAlert[] {
  const done = handled(marks);
  const out: MyAlert[] = [];
  for (const t of tasks) {
    if (t.alertDays === undefined) continue;
    const due = currentDue(t, done);
    if (!due || (t.repeat === "once" && !t.dueOn)) continue;
    const away = daysBetween(today, due);
    let stage: MyAlert["stage"] | undefined;
    if (away === 0) stage = "day";
    else if (away > 0 && away <= t.alertDays) stage = "ahead";
    if (!stage) continue;
    out.push({
      personId: t.personId, taskId: t.id, due, stage,
      title: stage === "day" ? `Due today: ${t.title}` : `Coming up: ${t.title}`,
      body: stage === "day" ? (t.note ?? "Tap to tick it off in My Day.") : `Due ${away === 1 ? "tomorrow" : shortDay(due)}.${t.note ? ` ${t.note}` : ""}`,
      dedupeKey: `myday|${t.id}|${due}|${stage}|${t.personId}`,
    });
  }
  return out;
}

/** Only the owner it belongs to sees or changes a task. */
export const ownsTask = (t: Pick<MyTask, "personId">, personId: string) => t.personId === personId;
