import type { Outcome, TempRule } from "./types";

/**
 * Classifies a reading against an approved rule.
 *   ok    within target
 *   warn  outside target but within the legal limit (re-check, record what was done)
 *   bad   beyond the legal limit (critical: manager alert, corrective action required)
 * A rule with no legal limit can only produce ok or warn.
 */
export function classifyReading(value: number, rule: TempRule): Outcome {
  if (!Number.isFinite(value)) return "todo";
  if (rule.legalMax !== undefined && value > rule.legalMax) return "bad";
  if (rule.legalMin !== undefined && value < rule.legalMin) return "bad";
  if (rule.targetMax !== undefined && value > rule.targetMax) return "warn";
  if (rule.targetMin !== undefined && value < rule.targetMin) return "warn";
  return "ok";
}

/** Only a reading past the safe limit raises an alert; above target but within it is recorded, with a re-check prompt. */
export const raisesAlert = (outcome: Outcome) => outcome === "bad";

/** Parses what staff type: "9.4", "9,4", "-18", "−18.5" (unicode minus). Returns NaN if not a number. */
export function parseReading(raw: string): number {
  const cleaned = raw.trim().replace(",", ".").replace(/[−–]/g, "-").replace(/°c?$/i, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return NaN;
  return Number(cleaned);
}

/** Readings outside this range are almost certainly typing mistakes and are rejected. */
export const PLAUSIBLE_RANGE = { min: -40, max: 120 } as const;

export function isPlausible(value: number): boolean {
  return value >= PLAUSIBLE_RANGE.min && value <= PLAUSIBLE_RANGE.max;
}

export function describeRule(rule: TempRule): string {
  const parts: string[] = [];
  if (rule.targetMax !== undefined) parts.push(`≤ ${rule.targetMax}°C target`);
  if (rule.targetMin !== undefined && rule.targetMin !== rule.legalMin) parts.push(`≥ ${rule.targetMin}°C target`);
  if (rule.legalMax !== undefined) parts.push(`${rule.legalMax}°C limit`);
  if (rule.legalMin !== undefined) parts.push(`≥ ${rule.legalMin}°C`);
  return parts.join(" · ");
}

/**
 * Freezer readings (rule Z) are typed without the minus sign: the box shows a fixed "−" and the number typed is
 * saved below zero, so a slip like "18" for -18 can't raise an alert. A freezer that really is above zero (broken)
 * is recorded by switching the sign to "+" first (`above`). Anything that isn't a number comes back as typed, for
 * the usual check to refuse.
 */
export function freezerValue(typed: string, above: boolean): string {
  const t = typed.trim().replace(/^[-−–+]\s*/, "").replace(",", ".").replace(/\s*°c?$/i, "");
  if (!t) return "";
  const n = Number(t);
  if (!Number.isFinite(n)) return typed.trim();
  if (n === 0) return "0";
  return `${above ? "" : "-"}${Math.abs(n)}`;
}
/** What the freezer box shows for a saved reading: the number without its sign, and whether it was above zero. */
export function freezerShown(value: string): { digits: string; above: boolean } {
  const n = Number(value);
  if (!value.trim() || !Number.isFinite(n)) return { digits: value, above: false };
  return { digits: String(Math.abs(n)), above: n > 0 };
}
