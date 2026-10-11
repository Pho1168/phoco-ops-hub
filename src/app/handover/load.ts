import { store } from "@/lib/data";
import { canUsePrep } from "@/lib/domain/prep";
import { requireCtx } from "@/lib/session";

/** Every signed-in person uses the Handover tab. The prep part shows only at sites where it's switched on. */
export async function handoverPage() {
  const ctx = await requireCtx();
  const enabled = await store().prepEnabledSites();
  const prepOn = canUsePrep(ctx.access) && enabled.includes(ctx.site.id);
  const sites = (await store().sites()).filter((s) => s.status === "open" && ctx.person.access.some((a) => a.siteId === s.id));
  return { ctx, prepOn, sites };
}
