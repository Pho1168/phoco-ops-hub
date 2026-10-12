import { canManage } from "./access";
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
/** A reminder doesn't go before 05:00 London, unless the shift itself starts before then. */
export const SHIFT_REMINDER_EARLIEST = "05:00";

export interface ShiftTimes { date: string; start: string; end: string }
export interface ReminderShift extends ShiftTimes { id: string; personId: string; siteId: SiteId; siteName: string; section: string }

export const shiftStart = (s: ShiftTimes) => londonToUtc(s.date, s.start);
/** A shift that ends at or before its start time ends the next day. */
export const shiftEnd = (s: ShiftTimes) => londonToUtc(s.end <= s.start ? addDays(s.date, 1) : s.date, s.end);

/** When a shift's reminder is due: 2 hours before it starts, but not before 05:00 unless the shift starts earlier still. */
export function reminderAt(s: ShiftTimes): number {
  const start = shiftStart(s);
  const at = start - SHIFT_REMINDER_LEAD_MIN * 60_000;
  const earliest = londonToUtc(s.date, SHIFT_REMINDER_EARLIEST);
  return at < earliest && earliest < start ? earliest : at;
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

const SECTION_NAME: Record<string, string> = { FOH: "Front of house", BOH: "Back of house", PROD: "Production" };
export const sectionName = (s: string) => SECTION_NAME[s] ?? s;

// ---------- what's waiting from handover ----------

export interface HandoverNote { category: string; body: string; needsAction: boolean; closedAt?: number; createdAt: number }
/** What's waiting at a site, as it goes into a reminder on someone's phone. */
export interface Waiting {
  /** Open notes that need action. Staff notes never leave the tablet; customer complaints go as a count only. */
  actions: HandoverNote[];
  complaints: number;
  /** Prep still to do, urgent first. */
  prep: { name: string; urgent: boolean }[];
}

/** Notes that can show on a lock screen. Staff notes stay on the tablet; complaint notes can name a customer, so only their number goes. */
export function waitingFrom(notes: HandoverNote[], prep: { name: string; urgent: boolean }[]): Waiting {
  const open = notes.filter((n) => n.needsAction && !n.closedAt && n.category !== "Staff note");
  return {
    actions: noteOrder(open.filter((n) => n.category !== "Customer complaint")),
    complaints: open.filter((n) => n.category === "Customer complaint").length,
    prep: [...prep].sort((a, b) => Number(b.urgent) - Number(a.urgent)),
  };
}

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The handover lines of a reminder. Empty when nothing is waiting. */
export function waitingLines(w: Waiting, maxItems = 3): string[] {
  const out = w.actions.slice(0, maxItems).map((n) => `• ${n.category === "Food safety" ? "Food safety: " : ""}${clip(n.body, 70)}`);
  if (w.actions.length > maxItems) out.push(`• +${w.actions.length - maxItems} more on the tablet`);
  if (w.complaints) out.push(`• ${plural(w.complaints, "customer complaint")} to follow up`);
  if (w.prep.length) {
    const urgent = w.prep.filter((p) => p.urgent).length;
    const names = w.prep.slice(0, maxItems).map((p) => p.name).join(", ");
    out.push(`• Prep to do: ${w.prep.length}${urgent ? ` (${urgent} urgent)` : ""}: ${names}${w.prep.length > maxItems ? ` +${w.prep.length - maxItems} more` : ""}`);
  }
  return out;
}

/** The reminder itself: start time first (it's what a lock screen shows), then what's waiting, then how to reply. */
export function shiftReminderMessage(s: ReminderShift, w: Waiting | undefined, today: string): { title: string; body: string } {
  const day = s.date === today ? "today" : s.date === addDays(today, 1) ? "tomorrow" : shortDay(s.date);
  const lines = [`${s.start}–${s.end} · ${sectionName(s.section)}`];
  const waiting = w ? waitingLines(w) : [];
  if (waiting.length) lines.push("Waiting from handover:", ...waiting);
  lines.push("Tap to reply: on my way, running late or can't make it.");
  return { title: `Shift at ${s.start} ${day} · ${s.siteName}`, body: lines.join("\n") };
}

// ---------- replies ----------

export type ReplyKind = "on_my_way" | "late" | "cant_make_it";
export const LATE_MINUTES = [15, 30, 45] as const;
export type LateMinutes = (typeof LATE_MINUTES)[number];
export interface ShiftReply { id: string; shiftId: string; personId: string; siteId: SiteId; kind: ReplyKind; lateMinutes?: LateMinutes; createdAt: number }

/** Replies open 12 hours before a shift starts and close when it ends. */
export const REPLY_OPENS_HOURS = 12;

export function canReply(shift: ShiftTimes & { personId: string; published: boolean; cancelled: boolean }, personId: string, now: number): { ok: true } | { ok: false; error: string } {
  if (shift.personId !== personId) return { ok: false, error: "That isn't your shift" };
  if (!shift.published || shift.cancelled) return { ok: false, error: "That shift isn't on the rota any more" };
  if (now >= shiftEnd(shift)) return { ok: false, error: "That shift has finished" };
  if (now < shiftStart(shift) - REPLY_OPENS_HOURS * 3_600_000) return { ok: false, error: "You can reply on the day of the shift" };
  return { ok: true };
}

/** Whether a shift shows the reply buttons (same window as `canReply`). */
export const replyOpen = (s: ShiftTimes, now: number) => now < shiftEnd(s) && now >= shiftStart(s) - REPLY_OPENS_HOURS * 3_600_000;

export function replyText(r: Pick<ShiftReply, "kind" | "lateMinutes">): string {
  return r.kind === "on_my_way" ? "On my way" : r.kind === "late" ? `Running about ${r.lateMinutes} min late` : "Can't make it";
}

/** True when a reply says the same as the one before it (a second tap): nothing new to record or send. */
export const sameReply = (a: Pick<ShiftReply, "kind" | "lateMinutes"> | undefined, b: Pick<ShiftReply, "kind" | "lateMinutes">) =>
  !!a && a.kind === b.kind && (a.lateMinutes ?? 0) === (b.lateMinutes ?? 0);

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
    .map((p) => ({ personId: p.id, ...msg, dedupeKey: `reply|${reply.id}|${p.id}`, url: p.access.some((a) => a.role === "owner") ? "/owner" : "/today" }));
}

// ---------- today's team, for managers and the owner ----------

export interface TeamDayRow {
  shiftId: string; personId: string; name: string; siteId: SiteId; siteName: string; section: string; date: string; start: string; end: string;
  started: boolean; ended: boolean; remindedAt?: number; reply?: ShiftReply; notificationsOn: boolean;
}

/** Today's shifts, earliest first, with each one's reminder and latest reply. */
export function teamDay(shifts: (ReminderShift & { name: string })[], reminded: Map<string, number>, replies: ShiftReply[], withPush: Set<string>, now: number): TeamDayRow[] {
  const latest = latestReplies(replies);
  return shifts
    .map((s) => ({
      shiftId: s.id, personId: s.personId, name: s.name, siteId: s.siteId, siteName: s.siteName, section: s.section, date: s.date, start: s.start, end: s.end,
      started: now >= shiftStart(s), ended: now >= shiftEnd(s), remindedAt: reminded.get(reminderKey(s)), reply: latest.get(s.id), notificationsOn: withPush.has(s.personId),
    }))
    .sort((a, b) => a.siteName.localeCompare(b.siteName) || a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
}
