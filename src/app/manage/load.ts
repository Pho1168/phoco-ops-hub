import { store } from "@/lib/data";
import type { Site, SiteId } from "@/lib/domain/types";
import { sameBusiness } from "@/lib/domain/brand";

/**
 * The sites a manager can pick from (open or closed, in the usual order), and the one asked for: only the business
 * of the site they're working at (`fallback`), never the other one.
 */
export async function pickSite(managed: SiteId[], wanted: string | undefined, fallback: SiteId): Promise<{ sites: Site[]; site: Site }> {
  const all = await store().sites();
  const sites = sameBusiness(all, all.find((s) => s.id === fallback)).filter((s) => managed.includes(s.id));
  const site = sites.find((s) => s.id === wanted) ?? sites.find((s) => s.id === fallback) ?? sites[0];
  return { sites, site };
}
