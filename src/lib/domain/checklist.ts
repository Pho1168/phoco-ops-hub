import type { Answer, Checklist, ChecklistItem, Outcome, TempRule } from "./types";
import { classifyReading, isPlausible, parseReading } from "./temperature";

export type AnswerResult =
  | { ok: true; outcome: Outcome; value: string }
  | { ok: false; error: string };

/** Turns raw input for an item into a stored outcome, applying the approved rule for temperatures. */
export function evaluateAnswer(item: ChecklistItem, raw: string | boolean, rules: Record<string, TempRule>): AnswerResult {
  switch (item.type) {
    case "tick":
      return { ok: true, outcome: raw ? "done" : "todo", value: raw ? "yes" : "" };
    case "temp": {
      const n = parseReading(String(raw));
      if (Number.isNaN(n)) return { ok: false, error: "Enter a temperature in °C, for example 3.5 or -18" };
      if (!isPlausible(n)) return { ok: false, error: `${n}°C looks like a typing mistake. Check the probe and enter it again` };
      const rule = item.ruleCode ? rules[item.ruleCode] : undefined;
      return { ok: true, outcome: rule ? classifyReading(n, rule) : "ok", value: String(n) };
    }
    case "number": {
      const s = String(raw).trim().replace(/[£,]/g, "");
      if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, error: "Enter a number" };
      return { ok: true, outcome: "done", value: s };
    }
    case "text":
    case "photo": {
      const s = String(raw).trim();
      return s ? { ok: true, outcome: "done", value: s } : { ok: true, outcome: "todo", value: "" };
    }
  }
}

export interface Progress {
  answered: number;
  total: number;
  needsAction: number; // warn/bad readings with no corrective action recorded
  critical: number;
}

/** Latest answer per item wins (answers are append-only; a correction is a newer row). */
export function latestAnswers(answers: Answer[]): Map<string, Answer> {
  const m = new Map<string, Answer>();
  for (const a of [...answers].sort((x, y) => x.capturedAt - y.capturedAt)) m.set(a.itemId, a);
  return m;
}

export function progress(list: Checklist, answers: Answer[]): Progress {
  const latest = latestAnswers(answers);
  let answered = 0, needsAction = 0, critical = 0;
  for (const it of list.items) {
    const a = latest.get(it.id);
    if (!a || a.outcome === "todo") continue;
    answered++;
    if (a.outcome === "bad") critical++;
    if ((a.outcome === "warn" || a.outcome === "bad") && !a.action) needsAction++;
  }
  return { answered, total: list.items.length, needsAction, critical };
}

export type SignOffCheck = { allowed: true } | { allowed: false; reason: string };

export function canSignOff(list: Checklist, answers: Answer[], alreadySigned: boolean): SignOffCheck {
  if (alreadySigned) return { allowed: false, reason: "Already signed off" };
  const p = progress(list, answers);
  if (p.answered < p.total) return { allowed: false, reason: `${p.total - p.answered} checks left` };
  if (p.needsAction > 0) return { allowed: false, reason: `${p.needsAction} reading${p.needsAction > 1 ? "s need" : " needs"} a recorded action` };
  return { allowed: true };
}

export type RunState = "done" | "overdue" | "in_progress" | "not_started";

/** now and due are "HH:MM" in site local time. */
export function runState(p: Progress, signed: boolean, due: string | undefined, now: string): RunState {
  if (signed) return "done";
  if (due && now > due && p.answered < p.total) return "overdue";
  if (p.answered > 0) return "in_progress";
  return "not_started";
}
