import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import type { Person, Site, SiteAccess } from "@/lib/domain/types";

export const SESSION_COOKIE = "phoco_sid";
export const SESSION_TTL_MS = 14 * 60 * 60 * 1000; // one long shift

export interface Ctx { person: Person; site: Site; access: SiteAccess; sessionId: string; isOwner: boolean; isManager: boolean }

/**
 * Re-validated on every request: a revoked session, frozen person or closed site ends access at once.
 */
export async function current(): Promise<Ctx | null> {
  const sid = cookies().get(SESSION_COOKIE)?.value;
  if (!sid) return null;
  const db = store();
  const s = await db.session(sid);
  if (!s || s.revokedAt || s.expiresAt < Date.now()) return null;
  const person = await db.person(s.personId);
  const site = await db.site(s.siteId);
  if (!person || !site || person.status !== "active") return null;
  const access = person.access.find((a) => a.siteId === site.id);
  if (!access) return null;
  const isOwner = person.access.some((a) => a.role === "owner");
  if (site.status === "closed" && !isOwner) return null;
  return { person, site, access, sessionId: s.id, isOwner, isManager: isOwner || access.role === "manager" };
}

export async function requireCtx(): Promise<Ctx> {
  const c = await current();
  if (!c) redirect("/login");
  return c;
}

export function londonNow(): { date: string; hm: string } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hm: `${get("hour")}:${get("minute")}` };
}
