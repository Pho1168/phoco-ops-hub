import type { Site } from "./types";

/**
 * Adding a site. The owner gives it a short code (2–5 capital letters, never changed afterwards: records are keyed by
 * it), a name and a kind. A restaurant serves customers; a production kitchen supplies the restaurants (Stock &
 * Purchasing sends its products' requests there). Times are optional and set later on the Owner screen too.
 */
export interface NewSite { id: string; name: string; kind: Site["kind"]; readyBy?: string; gasBy?: string }

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function cleanNewSite(input: { id: string; name: string; kind: string; readyBy?: string; gasBy?: string }, existing: Pick<Site, "id" | "name">[]):
  { ok: true; value: NewSite } | { ok: false; error: string } {
  const id = input.id.trim().toUpperCase();
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!/^[A-Z]{2,5}$/.test(id)) return { ok: false, error: "The code is 2 to 5 letters, like GRE" };
  if (existing.some((s) => s.id === id)) return { ok: false, error: `${id} is already a site` };
  if (name.length < 2 || name.length > 40) return { ok: false, error: "Give the site a name (up to 40 letters)" };
  if (existing.some((s) => s.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: `There's already a site called ${name}` };
  if (input.kind !== "restaurant" && input.kind !== "production") return { ok: false, error: "Choose restaurant or production kitchen" };
  const readyBy = input.readyBy?.trim() || undefined, gasBy = input.gasBy?.trim() || undefined;
  if (readyBy && !HM.test(readyBy)) return { ok: false, error: "Ready by is a time like 12:00" };
  if (gasBy && !HM.test(gasBy)) return { ok: false, error: "Kitchen closes is a time like 21:30" };
  return { ok: true, value: { id, name, kind: input.kind, ...(readyBy ? { readyBy } : {}), ...(gasBy ? { gasBy } : {}) } };
}
