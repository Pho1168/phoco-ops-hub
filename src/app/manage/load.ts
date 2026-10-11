import { store } from "@/lib/data";
import type { Site, SiteId } from "@/lib/domain/types";

/** The sites a manager can pick from (open or closed, in the usual order), and the one asked for. */
export async function pickSite(managed: SiteId[], wanted: string | undefined, fallback: SiteId): Promise<{ sites: Site[]; site: Site }> {
  const sites = (await store().sites()).filter((s) => managed.includes(s.id));
  const site = sites.find((s) => s.id === wanted) ?? sites.find((s) => s.id === fallback) ?? sites[0];
  return { sites, site };
}
