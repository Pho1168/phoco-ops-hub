import type { Area, SiteId } from "./types";
import type { AvailDay } from "./availability";
import { addDays, daysBetween } from "./time";
import { weekStartOf } from "./rota";

/**
 * Drafting next week's rota for the owner (the "rota builder"). Rules, no network: the shape of the week is copied
 * from the last published week at the site, and each shift is filled from who said they can work then. The result is
 * a scratchpad the owner reads, swaps and then types into the rota sheet; the app never writes to the sheet, and the
 * draft itself is never stored.
 *
 * Who fits a shift: someone with that section at the site, who said all day / morning (shift ends by 15:00) / evening
 * (shift starts from 15:00) for that day, isn't already on that day (another shift here, a shift at any other site,
 * either business, or approved time off). Someone who didn't send availability isn't put on. Who gets it: whoever had
 * that shift last week if they fit, else whoever has the fewest hours in the draft so far (a fair spread), then by name.
 *
 * Weekend cover: on the days in `WEEKEND` the site needs `weekendMin` different people on. When last week's shape has
 * fewer, shifts are added copying that day's most common shift and filled the same way; what can't be filled is a gap.
 */

/** Minimum different people on a Friday, Saturday or Sunday (Cafe La Viet: the owner's rule). */
export const WEEKEND_MIN = 6;
/** Day offsets from Monday that count as the weekend for `weekendMin`. */
export const WEEKEND = [4, 5, 6];
/** Morning shifts end by here; evening ones start from here (the availability form's split). */
export const AM_PM_SPLIT = "15:00";

export interface DraftPerson { id: string; name: string; sections: Area[] }
export interface TemplateShift { personId?: string; section: string; date: string; start: string; end: string; hours?: number }
/** A day someone already has: a shift at any site (either business) or approved time off. */
export interface BusyDay { personId: string; date: string; why: string }

export interface DraftSlot {
  id: string;
  /** 0 = Monday. */
  day: number;
  date: string;
  section: string;
  start: string;
  end: string;
  hours: number;
  /** Who had this shift last week, if anyone still at the site. */
  wasPersonId?: string;
  /** Added to reach the weekend minimum (not in last week's shape). */
  added?: boolean;
}
export interface DraftInput {
  siteId: SiteId;
  week: string;
  /** Last published week's shifts at the site (its shape). */
  template: TemplateShift[];
  people: DraftPerson[];
  /** Latest availability answer for the week, by person. */
  availability: Map<string, AvailDay[]>;
  busy: BusyDay[];
  weekendMin?: number;
}
export interface Draft {
  week: string;
  days: string[];
  slots: DraftSlot[];
  /** Slot id → person id (missing = a gap). */
  fills: Map<string, string>;
  gaps: { slotId: string; reason: string }[];
  /** People at the site who didn't send availability for the week. */
  noAnswer: DraftPerson[];
  /** Hours per person in the draft. */
  hours: Map<string, number>;
}

const toMin = (hm: string) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
/** Paid hours for a shift: its length less an hour's break (the sheet's default when none is given); never below 0. */
export function shiftHours(start: string, end: string): number {
  let mins = toMin(end) - toMin(start);
  if (mins <= 0) mins += 24 * 60; // over midnight
  return Math.max(0, Math.round((mins / 60 - 1) * 4) / 4);
}

/** Does this availability answer cover a shift at these times? */
export function availableFor(day: AvailDay | undefined, start: string, end: string): boolean {
  if (!day) return false;
  if (day.a === "all") return true;
  if (day.a === "am") return toMin(end) <= toMin(AM_PM_SPLIT) && toMin(end) > toMin(start);
  if (day.a === "pm") return toMin(start) >= toMin(AM_PM_SPLIT);
  return false;
}

/** Last week's shifts as this week's slots: same weekday, section and times. */
export function slotsFromTemplate(week: string, template: TemplateShift[], people: DraftPerson[]): DraftSlot[] {
  const ids = new Set(people.map((p) => p.id));
  return template
    .map((t, i) => {
      const day = daysBetween(weekStartOf(t.date), t.date);
      return { id: `s${i + 1}`, day, date: addDays(week, day), section: t.section, start: t.start, end: t.end, hours: t.hours ?? shiftHours(t.start, t.end),
        wasPersonId: t.personId && ids.has(t.personId) ? t.personId : undefined };
    })
    .sort((a, b) => a.day - b.day || a.start.localeCompare(b.start) || a.section.localeCompare(b.section));
}

/**
 * What a top-up shift copies: the most common shift that day in the section with the fewest people on so far (so extra
 * cover is spread across front and back of house), ties to FOH.
 */
function usualShift(slots: DraftSlot[], fills: Map<string, string>, day: number): Pick<DraftSlot, "section" | "start" | "end" | "hours"> | undefined {
  const onDay = slots.filter((s) => s.day === day && !s.added);
  if (!onDay.length) return undefined;
  const sections = Array.from(new Set(onDay.map((s) => s.section)));
  const onIn = (sec: string) => new Set(slots.filter((s) => s.day === day && s.section === sec && fills.has(s.id)).map((s) => fills.get(s.id))).size;
  const order = ["FOH", "BOH", "PROD"];
  const section = sections.sort((a, b) => onIn(a) - onIn(b) || order.indexOf(a) - order.indexOf(b))[0];
  const count = new Map<string, { n: number; s: DraftSlot }>();
  for (const s of onDay.filter((x) => x.section === section)) { const k = `${s.start}|${s.end}`; const c = count.get(k); if (c) c.n++; else count.set(k, { n: 1, s }); }
  const best = Array.from(count.values()).sort((a, b) => b.n - a.n || a.s.start.localeCompare(b.s.start))[0].s;
  return { section: best.section, start: best.start, end: best.end, hours: best.hours };
}

interface State { input: DraftInput; slots: DraftSlot[]; fills: Map<string, string>; hours: Map<string, number> }

/** Who could take this slot right now: fits the section and their availability, free that day. With why not, for the rest. */
export function candidatesFor(state: Pick<State, "input" | "slots" | "fills" | "hours">, slot: DraftSlot, ignoreSlotId?: string): { fit: DraftPerson[]; unfit: { person: DraftPerson; why: string }[] } {
  const { input, slots, fills } = state;
  const fit: DraftPerson[] = [];
  const unfit: { person: DraftPerson; why: string }[] = [];
  for (const p of input.people) {
    if (!p.sections.includes(slot.section as Area)) { unfit.push({ person: p, why: `not ${slot.section}` }); continue; }
    const answer = input.availability.get(p.id);
    if (!answer) { unfit.push({ person: p, why: "didn't send availability" }); continue; }
    if (!availableFor(answer[slot.day], slot.start, slot.end)) { unfit.push({ person: p, why: `said ${answer[slot.day]?.a === "off" ? "off" : answer[slot.day]?.a === "am" ? "morning only" : answer[slot.day]?.a === "pm" ? "evening only" : "no"}` }); continue; }
    const busy = input.busy.find((b) => b.personId === p.id && b.date === slot.date);
    if (busy) { unfit.push({ person: p, why: busy.why }); continue; }
    const already = slots.find((s) => s.id !== slot.id && s.id !== ignoreSlotId && s.date === slot.date && fills.get(s.id) === p.id);
    if (already) { unfit.push({ person: p, why: `already on ${already.start}–${already.end}` }); continue; }
    fit.push(p);
  }
  return { fit, unfit };
}

function pick(state: State, slot: DraftSlot): DraftPerson | undefined {
  const { fit } = candidatesFor(state, slot);
  if (!fit.length) return undefined;
  const was = fit.find((p) => p.id === slot.wasPersonId);
  if (was) return was;
  return [...fit].sort((a, b) => (state.hours.get(a.id) ?? 0) - (state.hours.get(b.id) ?? 0) || a.name.localeCompare(b.name))[0];
}

function reasonFor(state: State, slot: DraftSlot): string {
  const { unfit } = candidatesFor(state, slot);
  const inSection = unfit.filter((u) => u.person.sections.includes(slot.section as Area));
  if (!inSection.length) return `nobody works ${slot.section} here`;
  const whys = new Map<string, number>();
  for (const u of inSection) whys.set(u.why, (whys.get(u.why) ?? 0) + 1);
  return Array.from(whys.entries()).sort((a, b) => b[1] - a[1]).map(([w, n]) => `${n} ${w}`).join(", ");
}

/** Builds the draft. Deterministic: the same inputs always give the same draft. */
export function draftRota(input: DraftInput): Draft {
  const weekendMin = input.weekendMin ?? WEEKEND_MIN;
  const slots = slotsFromTemplate(input.week, input.template, input.people);
  const state: State = { input, slots, fills: new Map(), hours: new Map() };
  const gaps: Draft["gaps"] = [];
  const assign = (slot: DraftSlot) => {
    const p = pick(state, slot);
    if (p) { state.fills.set(slot.id, p.id); state.hours.set(p.id, (state.hours.get(p.id) ?? 0) + slot.hours); }
    else gaps.push({ slotId: slot.id, reason: reasonFor(state, slot) });
  };
  // Last week's shifts first (the people who had them keep them when they can), day by day.
  for (const slot of slots) assign(slot);
  // Then the weekend minimum: extra shifts copying the day's usual one until enough different people are on.
  for (const day of WEEKEND) {
    let tries = 0;
    const onDay = () => new Set(slots.filter((s) => s.day === day && state.fills.has(s.id)).map((s) => state.fills.get(s.id))).size;
    while (onDay() < weekendMin && tries < weekendMin) {
      tries++;
      const usual = usualShift(slots, state.fills, day);
      if (!usual) break;
      const slot: DraftSlot = { id: `s${slots.length + 1}`, day, date: addDays(input.week, day), ...usual, added: true };
      slots.push(slot);
      const p = pick(state, slot);
      if (p) { state.fills.set(slot.id, p.id); state.hours.set(p.id, (state.hours.get(p.id) ?? 0) + slot.hours); }
      else { gaps.push({ slotId: slot.id, reason: `need ${weekendMin} on, only ${onDay()} available: ${reasonFor(state, slot)}` }); break; }
    }
  }
  slots.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start) || a.section.localeCompare(b.section) || a.id.localeCompare(b.id));
  const noAnswer = input.people.filter((p) => !input.availability.has(p.id));
  return { week: input.week, days: Array.from({ length: 7 }, (_, i) => addDays(input.week, i)), slots, fills: state.fills, gaps, noAnswer, hours: state.hours };
}

/** Hours per person after a swap or an edit, from the fills as they are now. */
export function hoursOf(slots: DraftSlot[], fills: Map<string, string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of slots) { const p = fills.get(s.id); if (p) out.set(p, (out.get(p) ?? 0) + s.hours); }
  return out;
}

/** How many different people are on each day (0 = Monday). */
export const peopleOnDays = (slots: DraftSlot[], fills: Map<string, string>): number[] =>
  Array.from({ length: 7 }, (_, d) => new Set(slots.filter((s) => s.day === d && fills.has(s.id)).map((s) => fills.get(s.id))).size);

/**
 * The draft laid out like the rota sheet: one row per person and section, Monday to Sunday "start–end", so it's quick
 * to type in. People with nothing are left out.
 */
export function sheetRows(draft: Pick<Draft, "slots" | "fills">, people: DraftPerson[]): { name: string; section: string; days: string[]; hours: number }[] {
  const rows = new Map<string, { name: string; section: string; days: string[]; hours: number }>();
  for (const s of draft.slots) {
    const pid = draft.fills.get(s.id);
    if (!pid) continue;
    const p = people.find((x) => x.id === pid);
    if (!p) continue;
    const k = `${pid}|${s.section}`;
    const row = rows.get(k) ?? { name: p.name, section: s.section, days: Array(7).fill(""), hours: 0 };
    row.days[s.day] = row.days[s.day] ? `${row.days[s.day]}, ${s.start}–${s.end}` : `${s.start}–${s.end}`;
    row.hours += s.hours;
    rows.set(k, row);
  }
  const order = ["FOH", "BOH", "PROD"];
  return Array.from(rows.values()).sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section) || a.name.localeCompare(b.name));
}
