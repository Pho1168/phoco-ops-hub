import { BRANDS, brandOf, type BrandId } from "./brand";
import type { Area, Person, Site, SiteId } from "./types";

/**
 * Team notices: an owner or manager posts a short notice to a site (or every site of one business: `brand`; a
 * PHO & CO notice never reaches Cafe La Viet and the other way round), optionally only for some
 * sections. Everyone it's for sees it until they tap "Got it", and the poster sees who has and hasn't.
 * Important notices also go to phones that have notifications on.
 */

export interface TeamNotice {
  id: string; siteId?: SiteId;
  /** For a notice to all sites: the business whose sites it's for. */
  brand?: BrandId;
  sections: Area[]; title: string; body: string; important: boolean;
  createdBy: string; createdByName: string; createdAt: number;
  /** London date (YYYY-MM-DD), last day it shows. */
  showUntil?: string;
  endedAt?: number;
  reads: { personId: string; readAt: number }[];
}

export const NOTICE_TITLE_MAX = 120;
export const NOTICE_BODY_MAX = 2000;

type SiteBrand = Pick<Site, "id" | "brand">;
/** The sites a notice covers: its site, or every site of its business. */
export function noticeSites(n: Pick<TeamNotice, "siteId" | "brand">, sites: SiteBrand[]): SiteId[] {
  if (n.siteId) return [n.siteId];
  return sites.filter((s) => brandOf(s).id === (n.brand ?? "phoco")).map((s) => s.id);
}

/** Whether a notice is for this person: works at one of its sites, and in one of the sections if it names any. */
export function inAudience(n: Pick<TeamNotice, "siteId" | "brand" | "sections">, person: Pick<Person, "status" | "access">, sites: SiteBrand[]): boolean {
  if (person.status === "left") return false;
  const covered = new Set(noticeSites(n, sites));
  const access = person.access.filter((a) => covered.has(a.siteId));
  if (!access.length) return false;
  if (!n.sections.length) return true;
  return access.some((a) => a.role !== "staff" || a.sections.some((s) => n.sections.includes(s)));
}

/** Still showing: not taken down, and not past its last day. */
export function isLive(n: Pick<TeamNotice, "endedAt" | "showUntil">, today: string): boolean {
  return !n.endedAt && (!n.showUntil || today <= n.showUntil);
}

/** Live notices for this person that they haven't read yet: important first, then newest. */
export function unreadFor(notices: TeamNotice[], person: Pick<Person, "id" | "status" | "access">, today: string, sites: SiteBrand[]): TeamNotice[] {
  return notices
    .filter((n) => isLive(n, today) && inAudience(n, person, sites) && !n.reads.some((r) => r.personId === person.id))
    .sort((a, b) => Number(b.important) - Number(a.important) || b.createdAt - a.createdAt);
}

export interface ReadStats { audience: number; read: { personId: string; name: string; readAt: number }[]; unread: { personId: string; name: string }[] }

/** Who it's for, who has read it and who hasn't (people who have left aren't counted). */
export function readStats(n: TeamNotice, people: Pick<Person, "id" | "name" | "status" | "access">[], sites: SiteBrand[]): ReadStats {
  const audience = people.filter((p) => inAudience(n, p, sites));
  const readAt = new Map(n.reads.map((r) => [r.personId, r.readAt]));
  return {
    audience: audience.length,
    read: audience.filter((p) => readAt.has(p.id)).map((p) => ({ personId: p.id, name: p.name, readAt: readAt.get(p.id)! })).sort((a, b) => a.readAt - b.readAt),
    unread: audience.filter((p) => !readAt.has(p.id)).map((p) => ({ personId: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * A manager may post to their own sites; only someone who manages every site of a business (open or closed, since an
 * "all sites" notice also reaches a closed site's people when it reopens) may post to all of its sites or take one down.
 */
export function canPostTo(managed: SiteId[], sites: SiteBrand[], n: Pick<TeamNotice, "siteId" | "brand">): boolean {
  if (n.siteId) return managed.includes(n.siteId);
  const covered = noticeSites(n, sites);
  return covered.length > 0 && covered.every((s) => managed.includes(s));
}

/** Who a notice is for, in words: "Everyone at Eastcote", "BOH at all PHO & CO sites". */
export function audienceLabel(n: Pick<TeamNotice, "siteId" | "brand" | "sections">, siteName: string | undefined): string {
  const who = n.sections.length ? n.sections.join(" and ") : "Everyone";
  return `${who} at ${n.siteId ? siteName ?? n.siteId : `all ${BRANDS[n.brand ?? "phoco"].name} sites`}`;
}
