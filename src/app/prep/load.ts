import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { canUsePrep } from "@/lib/domain/prep";
import { requireCtx } from "@/lib/session";

/** Signed-in kitchen staff or manager at a site with the prep board switched on; anyone else goes back to Today. */
export async function prepPage() {
  const ctx = await requireCtx();
  const enabled = await store().prepEnabledSites();
  if (!canUsePrep(ctx.access, ctx.isManager) || !enabled.includes(ctx.site.id)) redirect("/today");
  const sites = (await store().sites()).filter((s) => enabled.includes(s.id) && s.status === "open" && ctx.person.access.some((a) => a.siteId === s.id));
  return { ctx, sites };
}
