import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { phoneHandoverSites } from "@/lib/domain/handover";
import { canUsePrep } from "@/lib/domain/prep";
import type { Site } from "@/lib/domain/types";
import { current, requireCtx, type Ctx } from "@/lib/session";

/** Every signed-in person uses the Handover tab. The prep part shows only at sites where it's switched on. */
export async function handoverPage() {
  const ctx = await requireCtx();
  const enabled = await store().prepEnabledSites();
  const prepOn = canUsePrep(ctx.access) && enabled.includes(ctx.site.id);
  const sites = (await store().sites()).filter((s) => s.status === "open" && ctx.person.access.some((a) => a.siteId === s.id));
  return { ctx, prepOn, sites };
}

/**
 * The Handover tab, or a manager's read-only view of it on their own phone (any open site they manage, `siteParam`
 * choosing which). Ticking off, notes and the prep handover stay on the tablet. Staff on their own phone go to My shifts.
 */
export async function handoverView(siteParam?: string): Promise<{ ctx: Ctx; site: Site; prepOn: boolean; readOnly: boolean; sites: Site[] }> {
  const ctx = await current();
  if (!ctx) redirect("/login");
  if (ctx.person.pinMustChange) redirect("/pin");
  if (ctx.scope === "full") {
    const { prepOn, sites } = await handoverPage();
    return { ctx, site: ctx.site, prepOn, readOnly: false, sites };
  }
  const sites = phoneHandoverSites(ctx.person, await store().sites());
  if (!sites.length) redirect("/me");
  const site = sites.find((s) => s.id === siteParam) ?? sites.find((s) => s.id === ctx.site.id) ?? sites[0];
  return { ctx, site, prepOn: (await store().prepEnabledSites()).includes(site.id), readOnly: true, sites };
}
