import { store } from "@/lib/data";
import { brandOf } from "@/lib/domain/brand";
import { sectionsFor } from "@/lib/domain/staff";
import type { Site, SiteId } from "@/lib/domain/types";
import type { SiteOpt } from "./StaffForm";

/**
 * The sites the form offers: `leads`, the sites the person filling it in runs (every site for an owner). A site of
 * another business than the one the viewer is signed in at is marked `other` (that business's name), so the form can
 * fold it away until it's needed: an owner editing a PHO & CO person sees PHO & CO sites, with Cafe La Viet one tap away.
 */
export async function siteOptions(leads: SiteId[], current: Site): Promise<SiteOpt[]> {
  const mine = brandOf(current).id;
  return (await store().sites()).filter((s) => leads.includes(s.id))
    .map((s) => ({ id: s.id, name: s.name, sections: sectionsFor(s.kind), closed: s.status === "closed", other: brandOf(s).id === mine ? undefined : brandOf(s).name }));
}
