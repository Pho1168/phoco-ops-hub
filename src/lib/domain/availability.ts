import { isOwner } from "./access";
import { weekStartOf } from "./rota";
import { addDays, londonDate, londonHM, londonToUtc, longDay, shortDay } from "./time";
import type { Person, Site, SiteId } from "./types";

/**
 * Weekly availability: staff say when they can work in the week ahead (Monday–Sunday), day by day, before the rota is
 * written. Answers are only ever added; the latest for a person and week counts. Due by Saturday 15:00 the week
 * before; the app reminds whoever hasn't said on Friday at midday and Saturday morning. Managers see it on the Rota page.
 */

/** A day: a morning shift (to 15:00), an evening shift, either (all day), or not at all. */
export type Avail = "am" | "pm" | "all" | "off";
export const AVAILS: Avail[] = ["all", "am", "pm", "off"];
export const AVAIL_LABEL: Record<Avail, string> = { all: "All day", am: "Morning", pm: "Evening", off: "Off" };
export const AVAIL_SHORT: Record<Avail, string> = { all: "All", am: "AM", pm: "PM", off: "Off" };
export interface AvailDay { a: Avail; note?: string }
export interface Availability { id: string; personId: string; personName?: string; week: string; days: AvailDay[]; createdAt: number }

export const AVAIL_NOTE_MAX = 80;
/** When it closes (London, on `dueDay`), and when reminders go out to whoever hasn't said yet. */
export const AVAIL_DUE_AT = "15:00";
export const AVAIL_REMIND = { fri: "12:00", sat: "10:00" } as const;
export type AvailStage = keyof typeof AVAIL_REMIND;

/** The week being asked about: next week (its Monday). */
export const askedWeek = (now: number) => addDays(weekStartOf(londonDate(now)), 7);
/** The last day to answer: the Saturday before the week, until `AVAIL_DUE_AT` London. */
export const dueDay = (week: string) => addDays(week, -2);
export const dueAt = (week: string) => londonToUtc(dueDay(week), AVAIL_DUE_AT);
export const isLate = (week: string, at: number) => at >= dueAt(week);
/** "Saturday 31 October at 15:00". */
export const dueText = (week: string) => `${longDay(dueDay(week))} at ${AVAIL_DUE_AT}`;
/** The days of a week, Monday first. */
export const weekDays = (week: string) => Array.from({ length: 7 }, (_, i) => addDays(week, i));

/** Who is asked: active staff, managers and operations managers at an open site; never owners. */
const ASKED_ROLES: string[] = ["staff", "manager", "ops"];
export function asksAvailability(p: Pick<Person, "status" | "access">, sites: Pick<Site, "id" | "status">[]): boolean {
  if (p.status !== "active" || isOwner(p)) return false;
  const open = new Set(sites.filter((s) => s.status === "open").map((s) => s.id));
  return p.access.some((a) => ASKED_ROLES.includes(a.role) && open.has(a.siteId));
}

/** A person may answer for this week or the one after, until the week starts. */
export function canAnswer(week: string, now: number): boolean {
  const thisWeek = weekStartOf(londonDate(now));
  return week === addDays(thisWeek, 7) || week === addDays(thisWeek, 14);
}

/** The seven days, checked: one of the four answers each, a short note if any. */
export function cleanAvailability(days: { a: string; note?: string }[]): { ok: true; value: AvailDay[] } | { ok: false; error: string } {
  if (days.length !== 7) return { ok: false, error: "Answer every day of the week" };
  const out: AvailDay[] = [];
  for (const d of days) {
    if (!(AVAILS as string[]).includes(d.a)) return { ok: false, error: "Pick morning, evening, all day or off for every day" };
    const note = d.note?.trim().replace(/\s+/g, " ").slice(0, AVAIL_NOTE_MAX) || undefined;
    out.push({ a: d.a as Avail, ...(note ? { note } : {}) });
  }
  return { ok: true, value: out };
}

/**
 * After the deadline the rota is being written from what was sent, so a day can only be opened up, never closed:
 * off → anything, anything → all day, or left as it was. Taking a day off then is a time off request or a word with
 * the manager. A first answer sent late is taken as it is (marked late). Notes can always change.
 */
export const opensUp = (was: Avail, now: Avail) => now === was || now === "all" || was === "off";
/** What a day can be changed to after the deadline. */
export const allowedAfter = (was: Avail): Avail[] => AVAILS.filter((a) => opensUp(was, a));

export function checkChange(week: string, before: AvailDay[] | undefined, after: AvailDay[], now: number): { ok: true } | { ok: false; error: string } {
  if (!before || !isLate(week, now)) return { ok: true };
  const days = weekDays(week);
  const closed = after.map((d, i) => (opensUp(before[i].a, d.a) ? undefined : shortDay(days[i]))).filter((x): x is string => !!x);
  if (!closed.length) return { ok: true };
  return { ok: false, error: `It's past the Saturday 15:00 deadline, so you can only add more time now, not take it away (${closed.join(", ")}). To take a day off, request time off or ask your manager` };
}

/** The latest answer for each person (records only ever added). */
export function latestAvailability(list: Availability[]): Map<string, Availability> {
  const out = new Map<string, Availability>();
  for (const x of [...list].sort((a, b) => a.createdAt - b.createdAt)) out.set(x.personId, x);
  return out;
}

export interface AvailRow { personId: string; name: string; sections: string[]; answer?: Availability; late: boolean }
/**
 * The availability grid for a site and week: everyone asked who works there (by name), with their latest answer;
 * those with none are listed as waiting.
 */
export function availabilityGrid(people: Pick<Person, "id" | "name" | "status" | "access">[], sites: Pick<Site, "id" | "status">[], siteId: SiteId, week: string, answers: Availability[]):
  { rows: AvailRow[]; waiting: AvailRow[]; days: string[] } {
  const latest = latestAvailability(answers.filter((a) => a.week === week));
  const rows = people.filter((p) => asksAvailability(p, sites) && p.access.some((a) => a.siteId === siteId && ASKED_ROLES.includes(a.role)))
    .map((p) => {
      const answer = latest.get(p.id);
      return { personId: p.id, name: p.name, sections: p.access.find((a) => a.siteId === siteId)?.sections ?? [], answer, late: !!answer && isLate(week, answer.createdAt) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { rows, waiting: rows.filter((r) => !r.answer), days: weekDays(week) };
}

/** Reminders due now (Friday from 12:00, Saturday from 10:00 until it closes), for a week: which stage, if any. */
export function availReminderStage(week: string, now: number): AvailStage | undefined {
  const today = londonDate(now), hm = londonHM(now);
  if (today === addDays(dueDay(week), -1) && hm >= AVAIL_REMIND.fri) return "fri";
  if (today === dueDay(week) && hm >= AVAIL_REMIND.sat && now < dueAt(week)) return "sat";
  return undefined;
}

export function availReminderMessage(week: string, stage: AvailStage): { title: string; body: string } {
  return stage === "sat"
    ? { title: `Your availability is due at ${AVAIL_DUE_AT} today`, body: `Say when you can work the week of ${shortDay(week)} by ${AVAIL_DUE_AT} today, so the rota can be written. It takes a minute: My shifts → Availability.` }
    : { title: "When can you work next week?", body: `Say when you can work the week of ${shortDay(week)}, by ${dueText(week)}. My shifts → Availability.` };
}
