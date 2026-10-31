import { store } from "@/lib/data";
import { currentDevice } from "@/lib/device";
import { current } from "@/lib/session";
import { brandOf, type Brand } from "@/lib/domain/brand";

/**
 * The business this request is for: the signed-in person's site, else the registered tablet's site. Undefined on a
 * device nobody has signed in on and that isn't a site tablet (the neutral "Ops Hub" sign-in).
 */
export async function requestBrand(): Promise<Brand | undefined> {
  try {
    const ctx = await current();
    if (ctx) return brandOf(ctx.site);
    const device = await currentDevice();
    if (device) return brandOf(await store().site(device.siteId));
  } catch {
    // Metadata must never break a page: fall back to the neutral name.
  }
  return undefined;
}
