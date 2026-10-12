import { canManage, isOps, isOwner } from "./access";
import { addDays, isIsoDate, shortDay } from "./time";
import type { Person, SiteId } from "./types";

/**
 * Time off: staff ask from their phone, a manager of their site approves or declines. Approved days show on the
 * team rota as "Off". The rota itself stays in the sheet: a clash with a planned shift is pointed out, not changed.
 */

export type TimeOffKind = "holiday" | "unpaid" | "other";
export type TimeOffStatus = "pending" | "approved" | "declined" | "cancelled";

export const TIME_OFF_KINDS: { id: TimeOffKind; label: string }[] = [
  { id: "holiday", label: "Holiday" },
  { id: "unpaid", label: "Unpaid leave" },
  { id: "other", label: "Other (appointment, family)" },
];
export const kindLabel = (k: TimeOffKind) => TIME_OFF_KINDS.find((x) => x.id === k)?.label ?? k;

export interface TimeOff {
  id: string; personId: string; personName: string; siteId: SiteId;
  startsOn: string; endsOn: string; kind: TimeOffKind; note?: string;
  status: TimeOffStatus; createdAt: number;
  decidedBy?: string; decidedByName?: string; decidedAt?: number; decisionNote?: string;
}

export const MAX_DAYS = 31;
export const MAX_AHEAD_DAYS = 365;

/** Every date from start to end, inclusive. */
export function daysOf(t: Pick<TimeOff, "startsOn" | "endsOn">): string[] {
  const out: string[] = [];
  for (let d = t.startsOn; d <= t.endsOn && out.length <= MAX_DAYS + 1; d = addDays(d, 1)) out.push(d);
  return out;
}

export const overlaps = (a: Pick<TimeOff, "startsOn" | "endsOn">, b: Pick<TimeOff, "startsOn" | "endsOn">) => a.startsOn <= b.endsOn && b.startsOn <= a.endsOn;

/** Still counts: waiting for a decision or approved. */
export const isActive = (t: Pick<TimeOff, "status">) => t.status === "pending" || t.status === "approved";

export type Checked = { ok: true } | { ok: false; error: string };

export function validateRequest(input: { startsOn: string; endsOn: string }, today: string, mine: TimeOff[]): Checked {
  if (!isIsoDate(input.startsOn) || !isIsoDate(input.endsOn)) return { ok: false, error: "Choose the first and last day" };
  if (input.endsOn < input.startsOn) return { ok: false, error: "The last day is before the first day" };
  if (input.startsOn < today) return { ok: false, error: "Time off can't start in the past" };
  if (input.startsOn > addDays(today, MAX_AHEAD_DAYS)) return { ok: false, error: "That's more than a year away. Ask nearer the time" };
  if (daysOf(input).length > MAX_DAYS) return { ok: false, error: `Ask for at most ${MAX_DAYS} days at a time` };
  const clash = mine.find((t) => isActive(t) && overlaps(t, input));
  if (clash) return { ok: false, error: `You've already asked for ${shortDay(clash.startsOn)}${clash.endsOn !== clash.startsOn ? ` to ${shortDay(clash.endsOn)}` : ""}` };
  return { ok: true };
}

/**
 * A manager of the request's site decides it, but not their own request (owners excepted, nobody is above them).
 * An operations manager's time off is decided by an owner. `requester` is the person who asked.
 */
export function canDecide(actor: Pick<Person, "id" | "access">, t: Pick<TimeOff, "personId" | "siteId" | "status">, requester: Pick<Person, "access">): Checked {
  if (!canManage(actor, t.siteId)) return { ok: false, error: "Only a manager of that site can decide this" };
  if (t.status !== "pending") return { ok: false, error: "This request has already been decided" };
  if (isOps(requester) && !isOwner(actor)) return { ok: false, error: "The owner decides an operations manager's time off" };
  if (actor.id === t.personId && !isOwner(actor)) return { ok: false, error: "Another manager needs to decide your own request" };
  return { ok: true };
}

/** Who is told about someone's time off at a site (asked, or withdrawn): the people who could decide it, apart from them. */
export function timeOffDeciders<P extends Pick<Person, "id" | "status" | "access">>(people: P[], requester: Pick<Person, "id" | "access">, siteId: SiteId): P[] {
  return people.filter((p) => p.status === "active" && p.id !== requester.id && canDecide(p, { personId: requester.id, siteId, status: "pending" }, requester).ok);
}

/** Whether a manager sees a request on their time-off list: an operations manager's is only for the owners (and themself). */
export const seesRequest = (viewer: Pick<Person, "id" | "access">, t: Pick<TimeOff, "personId">, requester: Pick<Person, "access">) =>
  !isOps(requester) || isOwner(viewer) || viewer.id === t.personId;

/** Staff can withdraw a request that's waiting, or approved time off that hasn't started yet. */
export function canCancel(t: Pick<TimeOff, "status" | "startsOn">, today: string): boolean {
  return t.status === "pending" || (t.status === "approved" && t.startsOn > today);
}

export interface ClashShift { date: string; start: string; end: string; section: string; published: boolean }

/** Rota shifts that fall on the requested days. */
export function clashes<T extends { date: string }>(t: Pick<TimeOff, "startsOn" | "endsOn">, shifts: T[]): T[] {
  return shifts.filter((s) => s.date >= t.startsOn && s.date <= t.endsOn).sort((a, b) => a.date.localeCompare(b.date));
}

/** Approved time off covering a date. */
export function offOn(list: TimeOff[], date: string): TimeOff[] {
  return list.filter((t) => t.status === "approved" && t.startsOn <= date && t.endsOn >= date);
}

/** "Tue 20 Oct" or "Tue 20 Oct to Thu 22 Oct (3 days)". */
export function rangeLabel(t: Pick<TimeOff, "startsOn" | "endsOn">): string {
  if (t.startsOn === t.endsOn) return shortDay(t.startsOn);
  return `${shortDay(t.startsOn)} to ${shortDay(t.endsOn)} (${daysOf(t).length} days)`;
}
