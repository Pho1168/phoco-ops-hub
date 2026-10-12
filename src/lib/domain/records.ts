import type { AnswerType, Area, Outcome } from "./types";
import { addDays, londonDate, londonHM, isIsoDate } from "./time";

/**
 * Food-safety records as an inspector (EHO) would ask for them: every temperature reading with its result and
 * the corrective action taken, and every checklist with when and by whom it was signed off.
 *
 * Answers are append-only. A correction is a newer answer for the same check, and recording a corrective
 * action re-records the same reading with the action attached. Both are shown, never hidden.
 */

/** One stored answer, with the names the records need. */
export interface RawAnswer {
  listId: string; listName: string; date: string;
  itemId: string; itemText: string; itemType: AnswerType; ruleCode?: string;
  value: string; outcome: Outcome; byName: string; at: number;
  action?: string; actionByName?: string;
}

export interface ReadingEntry {
  date: string; at: number; listId: string; listName: string; itemId: string; itemText: string; ruleCode?: string;
  value: string; outcome: Outcome; byName: string;
  action?: string; actionByName?: string; actionAt?: number;
  /** A later reading replaced this one (re-check or typing correction). */
  correctedTo?: string;
}

/** Temperature readings in time order, with corrective actions attached to the reading they were for. */
export function readingLog(rows: RawAnswer[]): ReadingEntry[] {
  const temps = rows.filter((r) => r.itemType === "temp" && r.outcome !== "todo" && r.value !== "").sort((a, b) => a.at - b.at);
  const last = new Map<string, ReadingEntry>();
  const out: ReadingEntry[] = [];
  for (const r of temps) {
    const key = `${r.date}|${r.listId}|${r.itemId}`;
    const prev = last.get(key);
    if (prev && r.action && r.value === prev.value) {
      // The corrective action recorded for the reading just before (same value, now with an action).
      prev.action = r.action; prev.actionByName = r.actionByName ?? r.byName; prev.actionAt = r.at;
      continue;
    }
    if (prev) prev.correctedTo = r.value;
    const e: ReadingEntry = {
      date: r.date, at: r.at, listId: r.listId, listName: r.listName, itemId: r.itemId, itemText: r.itemText, ruleCode: r.ruleCode,
      value: r.value, outcome: r.outcome, byName: r.byName,
      ...(r.action ? { action: r.action, actionByName: r.actionByName ?? r.byName, actionAt: r.at } : {}),
    };
    last.set(key, e);
    out.push(e);
  }
  return out;
}

export interface ListInfo { id: string; name: string; area: Area; due?: string }
export interface RunInfo { listId: string; date: string; signedAt?: number; signedByName?: string; answered: number; total: number }

export type SignoffStatus = "on_time" | "late" | "not_signed" | "open";
export interface SignoffRow {
  date: string; listId: string; listName: string; area: Area; due?: string;
  status: SignoffStatus; signedAt?: number; signedByName?: string; answered: number; total: number;
}

/** Every day from `from` to `to`, newest first. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = to; d >= from && out.length < 400; d = addDays(d, -1)) out.push(d);
  return out;
}

/**
 * Each checklist on each day: signed on time, signed late, not signed, or still open (today, before it's due).
 * Checklists with a due time are expected every day. Ones without (deliveries, per batch, toilet rounds, weekly
 * cleans) only appear when someone has started them, and count as not signed only if started and left unfinished.
 * Days before `trackingFrom` (the first day the site recorded any checklist) are left out, so the weeks before
 * a site started using the app don't show up as missed.
 */
export function signoffLog(lists: ListInfo[], runs: RunInfo[], dates: string[], now: number, trackingFrom: string | undefined): SignoffRow[] {
  if (!trackingFrom) return [];
  const today = londonDate(now), nowHM = londonHM(now);
  const byKey = new Map(runs.map((r) => [`${r.date}|${r.listId}`, r]));
  const rows: SignoffRow[] = [];
  for (const date of dates) {
    if (date < trackingFrom || date > today) continue;
    for (const l of lists) {
      const run = byKey.get(`${date}|${l.id}`);
      if (!l.due && !run) continue;
      const base = { date, listId: l.id, listName: l.name, area: l.area, due: l.due, answered: run?.answered ?? 0, total: run?.total ?? 0 };
      if (run?.signedAt) {
        const onTime = londonDate(run.signedAt) === date && (!l.due || londonHM(run.signedAt) <= l.due);
        rows.push({ ...base, status: onTime ? "on_time" : "late", signedAt: run.signedAt, signedByName: run.signedByName });
      } else if (date === today && (!l.due || nowHM <= l.due)) {
        rows.push({ ...base, status: "open" });
      } else {
        rows.push({ ...base, status: "not_signed" });
      }
    }
  }
  return rows;
}

export interface RecordsSummary { readings: number; outOfRange: number; critical: number; actions: number; onTime: number; late: number; notSigned: number }

export function recordsSummary(readings: ReadingEntry[], signoffs: SignoffRow[]): RecordsSummary {
  const out = readings.filter((r) => r.outcome === "warn" || r.outcome === "bad");
  return {
    readings: readings.length, outOfRange: out.length, critical: readings.filter((r) => r.outcome === "bad").length,
    actions: out.filter((r) => r.action).length,
    onTime: signoffs.filter((s) => s.status === "on_time").length,
    late: signoffs.filter((s) => s.status === "late").length,
    notSigned: signoffs.filter((s) => s.status === "not_signed").length,
  };
}

/** A sensible range from what's typed into the form: valid dates, `from` ≤ `to`, at most `maxDays` long, not in the future. */
export function clampRange(from: string | undefined, to: string | undefined, today: string, defaultDays: number, maxDays = 93): { from: string; to: string } {
  let t = isIsoDate(to) ? to : today;
  if (t > today) t = today;
  let f = isIsoDate(from) ? from : addDays(t, -(defaultDays - 1));
  if (f > t) f = t;
  if (f < addDays(t, -(maxDays - 1))) f = addDays(t, -(maxDays - 1));
  return { from: f, to: t };
}
