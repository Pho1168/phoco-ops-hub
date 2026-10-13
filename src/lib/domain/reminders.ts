import { canManage, isLead } from "./access";
import { noteOrder } from "./handover";
import { addDays, afterQuietHours, londonToUtc, shortDay } from "./time";
import type { Person, SiteId } from "./types";

/**
 * Shift reminders and replies.
 *
 * Every published shift gets one reminder, 2 hours before it starts (or earlier, when the owner presses
 * "Send reminders now"). It goes out whatever the time, quiet hours or not: getting people in on time is the point.
 * It carries what's waiting from handover at the site. The person can answer: on my way, running late, or can't
 * make it. Managers are told about late and can't-make-it replies straight away.
 */

export const SHIFT_REMINDER_LEAD_MIN = 120;
/** A reminder doesn't go before 05:00 London, unless the shift starts before 05:30: then it keeps its 2 hours. */
export const SHIFT_REMINDER_EARLIEST = "05:00";
/** Moved to 05:00, a reminder still comes at least this long before the shift (the scheduler runs every 10 minutes). */
const MIN_NOTICE_MS = 30 * 60_000;

export interface ShiftTimes { date: string; start: string; end: string }
export interface ReminderShift extends ShiftTimes { id: string; personId: string; siteId: SiteId; siteName: string; section: string }

export const shiftStart = (s: ShiftTimes) => londonToUtc(s.date, s.start);
/** A shift that ends at or before its start time ends the next day. */
export const shiftEnd = (s: ShiftTimes) => londonToUtc(s.end <= s.start ? addDays(s.date, 1) : s.date, s.end);

/** When a shift's reminder is due: 2 hours before it starts, but not before 05:00 unless the shift starts before 05:30. */
export function reminderAt(s: ShiftTimes): number {
  const start = shiftStart(s);
  const at = start - SHIFT_REMINDER_LEAD_MIN * 60_000;
  const earliest = londonToUtc(s.date, SHIFT_REMINDER_EARLIEST);
  return at < earliest && start - earliest >= MIN_NOTICE_MS ? earliest : at;
}

/** One reminder per person per shift. A shift that moves to a new time gets a new one. */
export const reminderKey = (s: Pick<ReminderShift, "id" | "personId" | "date" | "start">) => `shift|${s.id}|${s.personId}|${s.date}T${s.start}`;

/** Shifts whose reminder is due: from `reminderAt` until the shift starts. */
export function dueReminders<T extends ShiftTimes>(shifts: T[], now: number): T[] {
  return shifts.filter((s) => reminderAt(s) <= now && now < shiftStart(s));
}

/** For "Send reminders now": today's shifts that haven't started yet. */
export function startingLaterToday<T extends ShiftTimes>(shifts: T[], today: string, now: number): T[] {
  return shifts.filter((s) => s.date === today && now < shiftStart(s));
}

/**
 * The shifts on today's team list: today's, last night's that haven't ended yet, and tonight's after midnight once
 * they're within 6 hours (so a late-night reply about them shows straight away).
 */
export function todaysShifts<T extends ShiftTimes>(shifts: T[], today: string, now: number): T[] {
  return shifts.filter((s) => s.date === today || (s.date < today && shiftEnd(s) > now) || (s.date > today && shiftStart(s) - now <= 6 * 3_600_000));
}

const SECTION_NAME: Record<string, string> = { FOH: "Front of house", BOH: "Back of house", PROD: "Production" };
export const sectionName = (s: string) => SECTION_NAME[s] ?? s;

// ---------- what's waiting from handover ----------

export interface HandoverNote { category: string; body: string; needsAction: boolean; closedAt?: number; createdAt: number; assignedTo?: string }
export interface WaitingPrep { name: string; urgent: boolean; assignedTo?: string }
/** What's waiting at a site, as it goes into a reminder on someone's phone. */
export interface Waiting {
  /** Open notes that need action, in categories whose text may show on a lock screen. */
  actions: HandoverNote[];
  /** Open customer complaints: only their number goes, as they can name a customer. */
  complaints: number;
  /** Prep still to do, urgent first. */
  prep: WaitingPrep[];
  /** Open notes that need action and are for someone, whatever their category: each person's own line says what kind. */
  assigned: HandoverNote[];
}

/**
 * Which handover note categories may reach a lock screen. Only these: anything else (staff notes, or a category
 * added later and not listed here) stays on the tablet. A test checks every category is decided.
 */
export const PHONE_TEXT_CATEGORIES = ["Food safety", "Equipment", "Stock shortage", "Other"];
export const PHONE_COUNT_CATEGORIES = ["Customer complaint"];
export const TABLET_ONLY_CATEGORIES = ["Staff note"];

export function waitingFrom(notes: HandoverNote[], prep: WaitingPrep[]): Waiting {
  const open = notes.filter((n) => n.needsAction && !n.closedAt);
  return {
    actions: noteOrder(open.filter((n) => PHONE_TEXT_CATEGORIES.includes(n.category))),
    complaints: open.filter((n) => PHONE_COUNT_CATEGORIES.includes(n.category)).length,
    prep: [...prep].sort((a, b) => Number(b.urgent) - Number(a.urgent)),
    assigned: noteOrder(open.filter((n) => n.assignedTo)),
  };
}

/**
 * How a handover note shows on someone's phone (My shifts, a manager's read-only Handover page, a reminder): its
 * words if a lock screen may show them, otherwise only what kind of note it is, to be read on the tablet.
 */
export function phoneNote(n: { category: string; body: string }): { text: string; onTablet: boolean } {
  if (PHONE_TEXT_CATEGORIES.includes(n.category)) return { text: n.category === "Food safety" ? `Food safety: ${n.body}` : n.body, onTablet: false };
  if (PHONE_COUNT_CATEGORIES.includes(n.category)) return { text: "A customer complaint to follow up", onTablet: true };
  return { text: n.category === "Staff note" ? "A staff note" : "A note", onTablet: true };
}

/** Whether a note can be read on a phone at all (a manager's read-only Handover page): otherwise it's only counted there. */
export const phoneShows = (n: { category: string; body: string }) => !phoneNote(n).onTablet;

export interface ForYouItem { kind: "prep" | "note"; text: string; urgent: boolean; onTablet: boolean }

/**
 * What's for someone at one site: open notes that need action and prep still to do that were given to them. In the
 * Handover tab's order: food safety first, then urgent prep, other notes, the rest of the prep.
 */
export function forYou(personId: string, prep: WaitingPrep[], notes: HandoverNote[]): ForYouItem[] {
  const mine = noteOrder(notes.filter((n) => n.needsAction && !n.closedAt && n.assignedTo === personId));
  const note = (n: HandoverNote): ForYouItem => ({ kind: "note", ...phoneNote(n), urgent: n.category === "Food safety" });
  const myPrep = prep.filter((x) => x.assignedTo === personId);
  const item = (x: WaitingPrep): ForYouItem => ({ kind: "prep", text: x.name, urgent: x.urgent, onTablet: false });
  return [
    ...mine.filter((n) => n.category === "Food safety").map(note),
    ...myPrep.filter((x) => x.urgent).map(item),
    ...mine.filter((n) => n.category !== "Food safety").map(note),
    ...myPrep.filter((x) => !x.urgent).map(item),
  ];
}

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The first handover line of someone's reminder: what was given to them. Undefined when nothing is. */
export function forYouLine(w: Waiting, personId: string, maxItems = 3): string | undefined {
  const items = forYou(personId, w.prep, w.assigned);
  if (!items.length) return undefined;
  const part = (i: ForYouItem) => i.kind === "prep" ? `${i.text}${i.urgent ? " (urgent)" : ""}`
    : i.onTablet ? `${i.text.charAt(0).toLowerCase()}${i.text.slice(1)} (on the tablet)` : clip(i.text, 50);
  return `For you: ${items.slice(0, maxItems).map(part).join(", ")}${items.length > maxItems ? ` +${items.length - maxItems} more` : ""}`;
}

/**
 * The handover lines of a reminder. Empty when nothing is waiting. `unassigned`: only what isn't for anyone in
 * particular (a person's own items have their own line, and what was given to someone else is theirs).
 */
export function waitingLines(w: Waiting, maxItems = 3, unassigned = false): string[] {
  const actions = w.actions.filter((n) => !unassigned || !n.assignedTo);
  const complaints = w.complaints - (unassigned ? w.assigned.filter((n) => PHONE_COUNT_CATEGORIES.includes(n.category)).length : 0);
  const prep = w.prep.filter((p) => !unassigned || !p.assignedTo);
  const out = actions.slice(0, maxItems).map((n) => `• ${n.category === "Food safety" ? "Food safety: " : ""}${clip(n.body, 70)}`);
  if (actions.length > maxItems) out.push(`• +${actions.length - maxItems} more on the tablet`);
  if (complaints) out.push(`• ${plural(complaints, "customer complaint")} to follow up`);
  if (prep.length) {
    const urgent = prep.filter((p) => p.urgent).length;
    const names = prep.slice(0, maxItems).map((p) => p.name).join(", ");
    out.push(`• Prep to do: ${prep.length}${urgent ? ` (${urgent} urgent)` : ""}: ${names}${prep.length > maxItems ? ` +${prep.length - maxItems} more` : ""}`);
  }
  return out;
}

/**
 * The reminder itself: start time first (it's what a lock screen shows), then what's been given to them, then what
 * isn't for anyone in particular, then how to reply.
 */
export function shiftReminderMessage(s: ReminderShift, w: Waiting | undefined, today: string): { title: string; body: string } {
  const day = s.date === today ? "today" : s.date === addDays(today, 1) ? "tomorrow" : shortDay(s.date);
  const lines = [`${s.start}–${s.end} · ${sectionName(s.section)}`];
  const mine = w ? forYouLine(w, s.personId) : undefined;
  if (mine) lines.push(mine);
  const waiting = w ? waitingLines(w, 3, true) : [];
  if (waiting.length) lines.push(mine ? "Also waiting from handover:" : "Waiting from handover:", ...waiting);
  lines.push("Tap to reply: on my way, running late or can't make it.");
  return { title: `Shift at ${s.start} ${day} · ${s.siteName}`, body: lines.join("\n") };
}

// ---------- replies ----------

export type ReplyKind = "on_my_way" | "late" | "cant_make_it";
export const LATE_MINUTES = [15, 30, 45] as const;
export type LateMinutes = (typeof LATE_MINUTES)[number];
export interface ShiftReply { id: string; shiftId: string; personId: string; siteId: SiteId; kind: ReplyKind; lateMinutes?: LateMinutes; createdAt: number }

/**
 * Replies open at the start of the shift's day (or when its reminder goes, if that's earlier: a shift just after
 * midnight) and close when the shift ends. So any reminder, even one the owner sends early, can be answered.
 */
export const replyOpensAt = (s: ShiftTimes) => Math.min(londonToUtc(s.date, "00:00"), reminderAt(s));
export const replyOpen = (s: ShiftTimes, now: number) => now >= replyOpensAt(s) && now < shiftEnd(s);

export function canReply(shift: ShiftTimes & { personId: string; published: boolean; cancelled: boolean }, personId: string, now: number): { ok: true } | { ok: false; error: string } {
  if (shift.personId !== personId) return { ok: false, error: "That isn't your shift" };
  if (!shift.published || shift.cancelled) return { ok: false, error: "That shift isn't on the rota any more" };
  if (now >= shiftEnd(shift)) return { ok: false, error: "That shift has finished" };
  if (now < replyOpensAt(shift)) return { ok: false, error: "You can reply on the day of the shift" };
  return { ok: true };
}

export function replyText(r: Pick<ShiftReply, "kind" | "lateMinutes">): string {
  return r.kind === "on_my_way" ? "On my way" : r.kind === "late" ? `Running about ${r.lateMinutes} min late` : "Can't make it";
}

/** True when a reply says the same as the one before it (a second tap): nothing new to record or send. */
export const sameReply = (a: Pick<ShiftReply, "kind" | "lateMinutes"> | undefined, b: Pick<ShiftReply, "kind" | "lateMinutes">) =>
  !!a && a.kind === b.kind && (a.lateMinutes ?? 0) === (b.lateMinutes ?? 0);

/** How long a reply stays at the top of Today: a late one until half an hour after they said they'd be in, a can't-make-it until the shift ends. */
export function replyAlertUntil(reply: Pick<ShiftReply, "kind" | "lateMinutes"> | undefined, s: ShiftTimes): number | undefined {
  if (reply?.kind === "cant_make_it") return shiftEnd(s);
  if (reply?.kind === "late") return shiftStart(s) + ((reply.lateMinutes ?? 0) + 30) * 60_000;
  return undefined;
}

/** The latest reply for each shift (a newer reply replaces the last). */
export function latestReplies(replies: ShiftReply[]): Map<string, ShiftReply> {
  const out = new Map<string, ShiftReply>();
  for (const r of [...replies].sort((a, b) => a.createdAt - b.createdAt)) out.set(r.shiftId, r);
  return out;
}

export interface ReplyMessage { personId: string; title: string; body: string; dedupeKey: string; url: string }

/**
 * When a reply reaches managers' phones. Like other urgent messages it waits out 00:00–08:00, except when the shift
 * starts within 3 hours: then it goes at once (a can't-make-it at 06:30 for a 09:00 start can't wait until 08:00).
 */
export function replySendAfter(now: number, shift: ShiftTimes): number {
  return Math.min(afterQuietHours(now, true), Math.max(now, shiftStart(shift) - 3 * 3_600_000));
}

/**
 * Who hears about a reply and what they're told: the site's managers and owners (not the person who replied).
 * Late and can't make it go straight away. "On my way" is only passed on when it takes back an earlier late or
 * can't-make-it reply; otherwise it just shows in the app.
 */
export function replyMessages(reply: ShiftReply, previous: ShiftReply | undefined, shift: ReminderShift, name: string,
  people: Pick<Person, "id" | "status" | "access">[], today: string): ReplyMessage[] {
  if (reply.kind === "on_my_way" && (!previous || previous.kind === "on_my_way")) return [];
  const day = shift.date === today ? "today " : `${shortDay(shift.date)} `;
  const what = `${day}${shift.start}–${shift.end} (${sectionName(shift.section)}) at ${shift.siteName}`;
  const msg = reply.kind === "late"
    ? { title: `Running late: ${name}`, body: `About ${reply.lateMinutes} min late for ${what}` }
    : reply.kind === "cant_make_it"
      ? { title: `Can't make it: ${name}`, body: `${name} can't make ${what}. They've been asked to phone you too.` }
      : { title: previous?.kind === "cant_make_it" ? `Can make it after all: ${name}` : `On the way: ${name}`, body: `${name} is on the way for ${what}` };
  return people
    .filter((p) => p.status === "active" && p.id !== reply.personId && canManage(p, shift.siteId))
    .map((p) => ({ personId: p.id, ...msg, dedupeKey: `reply|${reply.id}|${p.id}`, url: isLead(p) ? "/owner" : "/today" }));
}

// ---------- today's team, for managers and the owner ----------

export interface TeamDayRow {
  shiftId: string; personId: string; name: string; siteId: SiteId; siteName: string; section: string; date: string; start: string; end: string;
  started: boolean; ended: boolean; remindedAt?: number; reply?: ShiftReply; notificationsOn: boolean;
  /** Until when the reply belongs at the top of Today (see replyAlertUntil). */
  alertUntil?: number;
}

/** Today's shifts, earliest first, with each one's reminder and latest reply. */
export function teamDay(shifts: (ReminderShift & { name: string })[], reminded: Map<string, number>, replies: ShiftReply[], withPush: Set<string>, now: number): TeamDayRow[] {
  const latest = latestReplies(replies);
  return shifts
    .map((s): TeamDayRow => ({
      shiftId: s.id, personId: s.personId, name: s.name, siteId: s.siteId, siteName: s.siteName, section: s.section, date: s.date, start: s.start, end: s.end,
      started: now >= shiftStart(s), ended: now >= shiftEnd(s), remindedAt: reminded.get(reminderKey(s)), reply: latest.get(s.id), notificationsOn: withPush.has(s.personId),
      alertUntil: replyAlertUntil(latest.get(s.id), s),
    }))
    .sort((a, b) => a.siteName.localeCompare(b.siteName) || shiftStart(a) - shiftStart(b) || a.name.localeCompare(b.name));
}
