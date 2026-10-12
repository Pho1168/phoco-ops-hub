import { store } from "@/lib/data";
import { sectionsFor } from "@/lib/domain/staff";
import type { SiteId } from "@/lib/domain/types";
import type { SiteOpt } from "./StaffForm";

/** The sites the form offers: `leads`, the sites the person filling it in runs (every site for an owner). */
export async function siteOptions(leads: SiteId[]): Promise<SiteOpt[]> {
  return (await store().sites()).filter((s) => leads.includes(s.id)).map((s) => ({ id: s.id, name: s.name, sections: sectionsFor(s.kind), closed: s.status === "closed" }));
}
