/** London wall-clock helpers. Shifts are entered in London time; the database stores UTC instants. */

const TZ = "Europe/London";

function londonParts(ms: number) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hm: `${hour}:${get("minute")}` };
}

/** "2026-10-13" + "11:00" in London → epoch ms (handles BST/GMT). */
export function londonToUtc(date: string, hm: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  // London is UTC or UTC+1: try both offsets and keep the one that reads back as the wall time asked for.
  for (const off of [0, 60]) {
    const t = guess - off * 60_000;
    const p = londonParts(t);
    if (p.date === date && p.hm === hm) return t;
  }
  return guess - 60 * 60_000; // in the spring-forward gap; an hour later is the nearest real time
}

export const londonDate = (ms: number) => londonParts(ms).date;
export const londonHM = (ms: number) => londonParts(ms).hm;

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "Tue 13 Oct" */
export function shortDay(iso: string): string {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** A real calendar date as YYYY-MM-DD between 1970 and 2100 (so not 2026-09-31 or 2026-13-01). */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const y = Number(s.slice(0, 4));
  if (y < 1970 || y > 2100) return false;
  const d = new Date(s + "T12:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** "10 Nov 2026" */
export function dayMonthYear(iso: string): string {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Whole days from `from` to `to` (London dates): negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z")) / 86_400_000);
}

export const QUIET_START = "22:00";
export const QUIET_END = "08:00";

/**
 * Messages created in quiet hours (22:00–08:00 London) wait until 08:00. Urgent ones (kit not working, P1 tasks)
 * still go out until midnight: only 00:00–08:00 waits. Returns when to send.
 */
export function afterQuietHours(now: number, urgent = false): number {
  const hm = londonHM(now);
  if (urgent) return hm >= QUIET_END ? now : londonToUtc(londonDate(now), QUIET_END);
  if (hm >= QUIET_END && hm < QUIET_START) return now;
  const today = londonDate(now);
  const day = hm >= QUIET_START ? addDays(today, 1) : today;
  return londonToUtc(day, QUIET_END);
}
