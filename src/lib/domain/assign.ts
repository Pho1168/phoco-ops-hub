import { addDays, londonDate, londonHM, londonToUtc, shortDay } from "./time";
import { shiftEnd, shiftStart, type ShiftTimes } from "./reminders";
import { shiftLabel, type PrepShift } from "./prep";
import type { Person, SiteId } from "./types";

/**
 * Who each handover item is for.
 *
 * Anyone signed in on a site tablet can give a prep item, or a note that needs doing, to someone who works at the
 * site, or change who it's for, at any time. Each change keeps who made it and when (and goes in the activity log).
 * It locks nothing: anyone can still tick the item done. An item carried into a newer handover starts out for
 * nobody in particular, as that's a new shift (the review step shows who it was for).
 *
 * The pick list puts the people working the shift the handover is for first, with their times, then everyone else
 * at the site, as the rota changes. A shift here is a morning (05:00 to 15:00) or an evening (15:00 to 05:00 the
 * next day, so a late close still counts as that evening). Someone works it when their rota shift covers at least
 * an hour of it: an 11:00–22:15 shift is in both, 11:00–15:30 only the morning.
 *
 * People hear about it without extra messages: their shift reminder starts with what's for them, and My shifts
 * lists it, with the usual phone rules (forYou and phoneNote in reminders.ts): staff notes and complaint details
 * stay on the tablet.
 */

export type Part = "am" | "pm";
export interface Period { date: string; part: Part }

/** Before this it's still the evening before (a late close). */
export const DAY_FROM = "05:00";
export const EVENING_FROM = "15:00";
/** Working a shift means being on for at least this much of it. */
export const MIN_OVERLAP_MS = 60 * 60_000;
/** How far ahead the next shift is looked for (a site closed for a few days). */
export const NEXT_SHIFT_DAYS = 8;

/** The morning or evening a moment falls in. */
export function periodAt(t: number): Period {
  const date = londonDate(t), hm = londonHM(t);
  if (hm < DAY_FROM) return { date: addDays(date, -1), part: "pm" };
  return { date, part: hm < EVENING_FROM ? "am" : "pm" };
}

export function periodBounds(p: Period): [from: number, to: number] {
  return p.part === "am"
    ? [londonToUtc(p.date, DAY_FROM), londonToUtc(p.date, EVENING_FROM)]
    : [londonToUtc(p.date, EVENING_FROM), londonToUtc(addDays(p.date, 1), DAY_FROM)];
}

export const nextPeriod = (p: Period): Period => (p.part === "am" ? { date: p.date, part: "pm" } : { date: addDays(p.date, 1), part: "am" });

export function worksIn(s: ShiftTimes, p: Period): boolean {
  const [from, to] = periodBounds(p);
  return Math.min(shiftEnd(s), to) - Math.max(shiftStart(s), from) >= MIN_OVERLAP_MS;
}

/**
 * The shift a prep handover is for, from when it was written (`from`) and the site's published rota. "Next shift" is
 * the one in which the next person on the rota starts, so days the site is shut are skipped. "Tomorrow" is the day
 * after the one it was written on (after midnight, that's still the evening before).
 */
export function targetPeriod(shift: PrepShift, from: number, rota: ShiftTimes[]): Period {
  const cur = periodAt(from);
  if (shift === "tomorrow_am" || shift === "tomorrow_pm") return { date: addDays(cur.date, 1), part: shift === "tomorrow_am" ? "am" : "pm" };
  const until = from + NEXT_SHIFT_DAYS * 86_400_000;
  const starts = rota.map(shiftStart).filter((t) => t > from && t < until).sort((a, b) => a - b);
  return starts.length ? periodAt(starts[0]) : nextPeriod(cur);
}

/**
 * The shift the Handover tab's pick list is about: the one the last prep handover was for, until it's over; after
 * that, or with no prep handover, the shift people are working now, or else the next one.
 */
export function pickPeriod(latest: { shift: PrepShift; submittedAt: number } | undefined, now: number, rota: ShiftTimes[]): Period {
  if (latest) {
    const p = targetPeriod(latest.shift, latest.submittedAt, rota);
    if (now < periodBounds(p)[1]) return p;
  }
  const cur = periodAt(now);
  if (rota.some((s) => worksIn(s, cur) && shiftEnd(s) > now)) return cur;
  return targetPeriod("next", now, rota);
}

/**
 * What a sent handover says it's for, with the date so it still reads right the next day: "Tomorrow morning · Wed
 * 14 Oct", "Next shift · Wed 14 Oct morning".
 */
export function forLabel(shift: PrepShift, p: Period): string {
  return shift === "next" ? `Next shift · ${shortDay(p.date)} ${p.part === "am" ? "morning" : "evening"}` : `${shiftLabel(shift)} · ${shortDay(p.date)}`;
}

/** "this morning", "tomorrow evening", "Thu 16 Oct morning". Just after midnight, the morning ahead is still "tomorrow". */
export function periodLabel(p: Period, now: number): string {
  const today = periodAt(now).date;
  const part = p.part === "am" ? "morning" : "evening";
  if (p.date === today) return `this ${part}`;
  if (p.date === addDays(today, 1)) return `tomorrow ${part}`;
  return `${shortDay(p.date)} ${part}`;
}

export interface PickPerson { id: string; name: string; times?: string }
export interface PickGroup { label: string; people: PickPerson[] }

/**
 * The pick list for one shift: who's working it first (earliest start first, with their times), then everyone else
 * at the site, A to Z. `people` are those who can be given something there (canBeGiven).
 */
export function pickList(people: { id: string; name: string }[], rota: (ShiftTimes & { personId: string })[], p: Period, siteName: string, now: number): PickGroup[] {
  const on = new Map<string, ShiftTimes[]>();
  for (const s of rota) if (worksIn(s, p)) on.set(s.personId, [...(on.get(s.personId) ?? []), s]);
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const first = (id: string) => Math.min(...on.get(id)!.map(shiftStart));
  const working = people.filter((x) => on.has(x.id)).sort((a, b) => first(a.id) - first(b.id) || byName(a, b))
    .map((x) => ({ id: x.id, name: x.name, times: [...on.get(x.id)!].sort((a, b) => shiftStart(a) - shiftStart(b)).map((s) => `${s.start}–${s.end}`).join(", ") }));
  const rest = people.filter((x) => !on.has(x.id)).sort(byName).map((x) => ({ id: x.id, name: x.name }));
  return [
    ...(working.length ? [{ label: `Working ${periodLabel(p, now)}`, people: working }] : []),
    ...(rest.length ? [{ label: `${working.length ? "Everyone else" : "Everyone"} at ${siteName}`, people: rest }] : []),
  ];
}

/** An item can be given to someone active who works at the site. */
export function canBeGiven(p: Pick<Person, "status" | "access"> | undefined, siteId: SiteId): boolean {
  return !!p && p.status === "active" && p.access.some((a) => a.siteId === siteId);
}
