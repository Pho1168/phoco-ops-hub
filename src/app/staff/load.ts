import { store } from "@/lib/data";
import { sectionsFor } from "@/lib/domain/staff";
import type { SiteOpt } from "./StaffForm";

export async function siteOptions(): Promise<SiteOpt[]> {
  return (await store().sites()).map((s) => ({ id: s.id, name: s.name, sections: sectionsFor(s.kind), closed: s.status === "closed" }));
}
