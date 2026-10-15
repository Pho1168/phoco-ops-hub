import { canManage, isLead } from "./access";
import { shiftEnd, shiftStart, type ReplyKind, type ShiftTimes } from "./reminders";
import { addDays, londonHM, londonToUtc, shortDay } from "./time";
import type { Person, SiteId } from "./types";

/**
 * The daily loop: ready to open in the morning, gas off at close, and yesterday at a glance the next morning.
 * A site is only checked on a day it has shifts on its published rota, so a day it's shut (or a site whose rota
 * isn't in the app yet) never raises an alarm.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const listOf = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

// ---------- ready to open ----------

export type Light = "green" | "amber" | "red";
export interface ReadyInput {
  date: string;
  /** "12:00": the site's opening checks must be signed by then. */
  readyBy: string;
  now: number;
  /** The site's checklists today: those due at or before readyBy are the opening checks. */
  lists: { name: string; due?: string; signed: boolean }[];
  /** `since`: when it went down. */
  kitDown: { name: string; foodSafety: boolean; since?: number }[];
  alerts: { title: string; critical: boolean; createdAt?: number }[];
  /** Shifts starting at or before readyBy, with the latest reply to their reminder. */
  team: { name: string; start: string; reply?: { kind: ReplyKind; lateMinutes?: number; createdAt?: number } }[];
  /**
   * Judge the kit, alerts and replies as they were at this time (the scheduler passes the ready time, so a
   * problem that comes up later in the day isn't reported as the reason the site wasn't ready).
   */
  asOf?: number;
}
export interface Reason { level: "red" | "amber"; text: string }
export interface Ready { light: Light; readyBy: string; past: boolean; signed: number; total: number; reasons: Reason[] }

/**
 * Green when the opening checks are signed and nothing is in the way. Before the ready time, unsigned checks are
 * amber (still getting ready); from the ready time they're red. Food-safety kit not working, or a critical alert,
 * is red at any time; other kit, warnings and people late or not coming are amber.
 */
export function readyToOpen(x: ReadyInput): Ready {
  const opening = x.lists.filter((l) => l.due && l.due <= x.readyBy);
  const unsigned = opening.filter((l) => !l.signed).map((l) => l.name);
  const past = x.now >= londonToUtc(x.date, x.readyBy);
  const by = (t?: number) => x.asOf === undefined || t === undefined || t <= x.asOf;
  const reasons: Reason[] = [];
  if (unsigned.length) reasons.push({ level: past ? "red" : "amber", text: `${past ? "Not signed" : "Still to sign"}: ${listOf(unsigned)}` });
  for (const k of x.kitDown.filter((k) => by(k.since))) reasons.push({ level: k.foodSafety ? "red" : "amber", text: `Not working: ${k.name}` });
  for (const a of x.alerts.filter((a) => by(a.createdAt))) reasons.push({ level: a.critical ? "red" : "amber", text: `Open alert: ${a.title}` });
  for (const t of x.team.filter((t) => by(t.reply?.createdAt))) {
    if (t.reply?.kind === "cant_make_it") reasons.push({ level: "amber", text: `${t.name} can't make it (${t.start})` });
    else if (t.reply?.kind === "late") reasons.push({ level: "amber", text: `${t.name} about ${t.reply.lateMinutes} min late (${t.start})` });
  }
  reasons.sort((a, b) => Number(b.level === "red") - Number(a.level === "red"));
  const light: Light = reasons.some((r) => r.level === "red") ? "red" : reasons.length ? "amber" : "green";
  return { light, readyBy: x.readyBy, past, signed: opening.length - unsigned.length, total: opening.length, reasons };
}

export const LIGHT_TEXT: Record<Light, string> = { green: "Ready to open", amber: "Getting ready", red: "Not ready" };
export const readyHeadline = (r: Ready) =>
  r.light === "green" ? `Ready to open · ${plural(r.total, "opening check")} signed`
    : r.light === "red" ? (r.past ? `Not ready at ${r.readyBy}` : "Not ready")
      : r.past ? "Ready, with things to sort" : `Getting ready for ${r.readyBy} · ${r.signed} of ${r.total} opening checks signed`;

/** The light is shown until an hour after the ready time; after that the day's other screens take over. */
export const READY_SHOWN_FOR_MIN = 60;
export const readyShownUntil = (date: string, readyBy: string) => londonToUtc(date, readyBy) + READY_SHOWN_FOR_MIN * 60_000;
/** The scheduler checks for this long after the ready time (so a message can't arrive long after opening). */
export const READY_ALERT_WINDOW_MIN = 30;

export interface DailyMessage { personId: string; title: string; body: string; dedupeKey: string; url: string }
const managersOf = (people: Pick<Person, "id" | "status" | "access">[], siteId: SiteId) =>
  people.filter((p) => p.status === "active" && canManage(p, siteId));
const urlFor = (p: Pick<Person, "access">) => (isLead(p) ? "/owner" : "/today");

/** At the ready time, a site that isn't ready (red) tells its managers and owners why, once a day. */
export function notReadyMessages(site: { id: SiteId; name: string }, date: string, r: Ready, people: Pick<Person, "id" | "status" | "access">[]): DailyMessage[] {
  if (!r.past || r.light !== "red") return [];
  const body = r.reasons.map((x) => x.text).join("\n");
  return managersOf(people, site.id).map((p) => ({ personId: p.id, title: `${site.name} not ready to open (${r.readyBy})`, body, dedupeKey: `ready|${site.id}|${date}|${p.id}`, url: urlFor(p) }));
}

// ---------- gas off at close ----------

/** The closers get a reminder this long before the last shift ends... */
export const GAS_REMIND_MIN = 15;
/** ...managers and owners are told if nobody has tapped this long after it ends... */
export const GAS_ALERT_MIN = 30;
/** ...and the check can still be done until this long after. */
export const GAS_OPEN_HOURS = 6;

/** `kitchen`: closeAt is the site's kitchen-close time (`sites.gas_by`), not the end of the last shift. */
export interface GasDay { siteId: SiteId; date: string; closeAt: number; closers: string[]; kitchen?: boolean }

/** A kitchen-close time before 05:00 belongs to the night after the business date. */
export const kitchenCloseAt = (date: string, gasBy: string) => londonToUtc(gasBy < "05:00" ? addDays(date, 1) : date, gasBy);

/**
 * A site's close on a day. Without a kitchen-close time (`gasBy`): when its last published shift ends, and who's on
 * until then (finishing within 30 minutes of it). With one: the kitchen-close time on that day (never after the last
 * shift ends), and everyone on shift then (started by it, finishing no more than 30 minutes before it); if nobody is,
 * those on until the last shift ends. People who said they can't make that shift (`absent`, shift ids) aren't asked.
 */
export function gasDay(siteId: SiteId, date: string, shifts: (ShiftTimes & { id?: string; personId: string; siteId: SiteId })[], absent: Set<string> = new Set(), gasBy?: string): GasDay | undefined {
  const day = shifts.filter((s) => s.siteId === siteId && s.date === date);
  if (!day.length) return undefined;
  const lastEnd = Math.max(...day.map(shiftEnd));
  const here = day.filter((s) => !(s.id && absent.has(s.id)));
  const until = (at: number) => Array.from(new Set(here.filter((s) => shiftStart(s) <= at && shiftEnd(s) >= at - 30 * 60_000).map((s) => s.personId)));
  const atEnd = Array.from(new Set(here.filter((s) => shiftEnd(s) >= lastEnd - 30 * 60_000).map((s) => s.personId)));
  if (gasBy) {
    const kitchen = kitchenCloseAt(date, gasBy);
    if (kitchen < lastEnd) {
      const on = until(kitchen);
      return { siteId, date, closeAt: kitchen, closers: on.length ? on : atEnd, kitchen: true };
    }
  }
  return { siteId, date, closeAt: lastEnd, closers: atEnd };
}

/** How the close is named in messages: "the kitchen closed at 21:30" or "the last shift ended at 22:15". */
export const closeWords = (d: Pick<GasDay, "kitchen">) => d.kitchen ? "the kitchen closed" : "the last shift ended";

/** The day the gas check went live. Closes before it aren't judged: there was nothing to tap then. */
export const GAS_CHECKS_START = "2026-10-12";
/** A close is expected to have a gas check if the site was on the rota that day, from the day the check went live. */
export const gasExpected = (date: string, onRota: boolean) => onRota && date >= GAS_CHECKS_START;

/** The last close whose gas check window is over (6 hours after it), for "Last close" on the Owner screen. */
export function lastCloseDay(days: (GasDay | undefined)[], now: number): GasDay | undefined {
  return days.filter((d): d is GasDay => !!d && d.date >= GAS_CHECKS_START && d.closeAt + GAS_OPEN_HOURS * 3_600_000 <= now).sort((a, b) => b.closeAt - a.closeAt)[0];
}

export type GasState = "later" | "due" | "overdue" | "done" | "missed";
export function gasState(d: GasDay, checkedAt: number | undefined, now: number): GasState {
  if (checkedAt !== undefined) return "done";
  if (now < d.closeAt - GAS_REMIND_MIN * 60_000) return "later";
  if (now < d.closeAt + GAS_ALERT_MIN * 60_000) return "due";
  if (now < d.closeAt + GAS_OPEN_HOURS * 3_600_000) return "overdue";
  return "missed";
}

/** The gas check that can be done now, if any: from 15 minutes before close until 6 hours after. */
export function openGasDay(days: (GasDay | undefined)[], now: number): GasDay | undefined {
  return days.find((d) => d && now >= d.closeAt - GAS_REMIND_MIN * 60_000 && now < d.closeAt + GAS_OPEN_HOURS * 3_600_000);
}

const hm = (t: number) => londonHM(t);

/** What the scheduler sends for a site's gas check now: the closers' reminder, then the alert to managers if nobody taps. */
export function gasMessages(site: { id: SiteId; name: string }, d: GasDay, state: GasState, people: Pick<Person, "id" | "status" | "access" | "name">[], now: number): (DailyMessage & { kind: "reminder" | "alert" })[] {
  if (state === "due" && now < d.closeAt + GAS_ALERT_MIN * 60_000) {
    return d.closers.map((id) => ({
      kind: "reminder" as const, personId: id, title: `Gas check before you leave · ${site.name}`,
      body: "Make sure every gas appliance and the gas supply are off, then tap All gas is off (on your phone or the tablet).",
      dedupeKey: `gas|${site.id}|${d.date}|${id}`, url: "/me",
    }));
  }
  if (state === "overdue") {
    const names = people.filter((p) => d.closers.includes(p.id)).map((p) => p.name);
    return managersOf(people, site.id).map((p) => ({
      kind: "alert" as const, personId: p.id, title: `No gas-off check at ${site.name}`,
      body: `${d.kitchen ? "The kitchen closed" : "The last shift ended"} at ${hm(d.closeAt)} and nobody has confirmed the gas is off.${names.length ? ` Closing: ${listOf(names)}.` : ""}`,
      dedupeKey: `gasalert|${site.id}|${d.date}|${p.id}`, url: urlFor(p),
    }));
  }
  return [];
}

/** Once someone taps, the managers and owners who were alerted hear that it's done. */
export function gasConfirmedMessages(site: { id: SiteId; name: string }, d: GasDay, byName: string, onTablet: boolean, at: number, alerted: string[]): DailyMessage[] {
  return alerted.map((personId) => ({ personId, title: `Gas off at ${site.name}`, body: `Confirmed by ${byName} at ${hm(at)}${onTablet ? " on the tablet" : " on their phone"}.`,
    dedupeKey: `gasok|${site.id}|${d.date}|${personId}`, url: "/today" }));
}

// ---------- yesterday at a glance ----------

export interface DayFacts {
  siteName: string;
  /** False when the site had no published shifts that day. */
  onRota: boolean;
  /** On the rota, on or after the day the gas check went live (gasExpected). */
  gasExpected: boolean;
  checks: { expected: number; signed: number; missed: string[] };
  outOfRange: number;
  alertsRaised: number;
  faults: { reported: number; fixed: number; stillDown: string[] };
  notesLeft: number;
  tasksOverdue: number;
  gas?: { byName: string; at: number; onTablet: boolean };
  late: number; cantMakeIt: number;
}

/** One line per site, the important things first. */
export function dayLine(f: DayFacts): string {
  const bits: string[] = [];
  if (f.gasExpected && !f.gas) bits.push("NO gas-off check");
  if (f.checks.expected) bits.push(`${f.checks.signed}/${f.checks.expected} checks signed${f.checks.missed.length ? ` (missed: ${f.checks.missed.slice(0, 3).join(", ")}${f.checks.missed.length > 3 ? "…" : ""})` : ""}`);
  if (f.outOfRange) bits.push(`${plural(f.outOfRange, "temperature")} out of range`);
  if (f.alertsRaised) bits.push(`${plural(f.alertsRaised, "alert")}`);
  for (const k of f.faults.stillDown.slice(0, 2)) bits.push(`${k} still not working`);
  if (f.faults.reported) bits.push(`${plural(f.faults.reported, "fault")} reported`);
  if (f.faults.fixed) bits.push(`${f.faults.fixed} fixed`);
  if (f.cantMakeIt) bits.push(`${plural(f.cantMakeIt, "person", "people")} couldn't make it`);
  if (f.late) bits.push(`${f.late} late`);
  if (f.notesLeft) bits.push(`${plural(f.notesLeft, "handover note")}`);
  if (f.tasksOverdue) bits.push(`${plural(f.tasksOverdue, "task")} overdue`);
  if (f.gas) bits.push(`gas off ✓ ${f.gas.byName} ${hm(f.gas.at)}`);
  return `${f.siteName}: ${bits.join(" · ") || "a quiet day"}`;
}

export function dailyDigest(date: string, sites: DayFacts[]): { title: string; body: string } {
  return { title: `Yesterday at a glance: ${shortDay(date)}`, body: `${sites.map(dayLine).join("\n")}\nDetails: Manage → Records.` };
}

/** The 08:00 summary goes out between 08:00 and 09:00 London (the scheduler runs every 10 minutes). */
export const DAILY_DIGEST_FROM = "08:00";
export const DAILY_DIGEST_UNTIL = "09:00";

/** A gas-off tap: who, when, and whether it was on the shop tablet or their own phone. The first tap of the day counts. */
export interface GasCheck { siteId: SiteId; date: string; personId: string; personName: string; onTablet: boolean; createdAt: number }
