/**
 * Handover notes, shown on the same Handover tab as the kitchen prep handover.
 *
 * Notes can be written at any time and show straight away. Two kinds:
 *  - Needs action: stays on the outstanding list until someone ticks it done (who and when are kept).
 *  - For info: no ticking needed. It shows for the shift it was written in and the next one, i.e. until a second
 *    handover has been sent after it, and never for more than INFO_NOTE_MAX_HOURS (sites without a prep handover).
 * A sent handover's report includes the notes written since the handover before it.
 */

export const NOTE_CATEGORIES = ["Equipment", "Stock shortage", "Food safety", "Customer complaint", "Staff note", "Other"] as const;
export type NoteCategory = (typeof NOTE_CATEGORIES)[number];

export const INFO_NOTE_MAX_HOURS = 48;

export interface NoteLike { needsAction: boolean; createdAt: number; closedAt?: number }

/**
 * Notes to show as current on the Handover tab.
 * `sentTimes` are the site's sent handovers, newest first.
 */
export function currentNotes<T extends NoteLike>(notes: T[], sentTimes: number[], now: number): T[] {
  const sinceHandover = sentTimes.length >= 2 ? sentTimes[1] : -Infinity;
  const cutoff = Math.max(sinceHandover, now - INFO_NOTE_MAX_HOURS * 3_600_000);
  return notes.filter((n) => !n.closedAt && (n.needsAction || n.createdAt > cutoff));
}

/** Notes that belong to a sent handover: written after the previous handover was sent, up to this one. */
export function notesForHandover<T extends NoteLike>(notes: T[], sentAt: number, prevSentAt: number | undefined): T[] {
  return notes.filter((n) => n.createdAt <= sentAt && (prevSentAt === undefined || n.createdAt > prevSentAt));
}

/** Food safety first, then needs-action before info, then newest first. */
export function noteOrder<T extends NoteLike & { category: string }>(notes: T[]): T[] {
  return [...notes].sort((a, b) =>
    Number(b.category === "Food safety") - Number(a.category === "Food safety")
    || Number(b.needsAction) - Number(a.needsAction)
    || b.createdAt - a.createdAt);
}
