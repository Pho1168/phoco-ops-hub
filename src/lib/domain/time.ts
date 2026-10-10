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

export const QUIET_START = "22:00";
export const QUIET_END = "08:00";

/** Messages created in quiet hours (22:00–08:00 London) wait until 08:00. Returns when to send. */
export function afterQuietHours(now: number): number {
  const hm = londonHM(now);
  if (hm >= QUIET_END && hm < QUIET_START) return now;
  const today = londonDate(now);
  const day = hm >= QUIET_START ? addDays(today, 1) : today;
  return londonToUtc(day, QUIET_END);
}
