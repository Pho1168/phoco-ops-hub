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
  if (rule.legalMax !== undefined) parts.push(`${rule.legalMax}°C legal`);
  if (rule.legalMin !== undefined) parts.push(`≥ ${rule.legalMin}°C`);
  return parts.join(" · ");
}
