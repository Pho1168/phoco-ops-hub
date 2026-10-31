import { BRANDS, brandOf, brandSlug, isBrandId } from "@/lib/domain/brand";
import { NextResponse } from "next/server";
import { store } from "@/lib/data";
import { canUsePrep, prepListBrands, receiptSheet } from "@/lib/domain/prep";
import { londonDate, londonHM, longDay } from "@/lib/domain/time";
import { receiptPdf } from "@/lib/pdf";
import { current } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The handover list as a printed form for an 80 mm receipt printer (a Bluetooth Epson TM-m30II on the tablet): a tick
 * box for every item in use, a group at a time. For anyone using the prep handover at their site, on the full app.
 */
export async function GET(req: Request) {
  const ctx = await current();
  if (!ctx || ctx.person.pinMustChange) return new NextResponse("Sign in to see this", { status: 401 });
  if (ctx.scope !== "full" || !canUsePrep(ctx.access)) return new NextResponse("The handover list is on the restaurant's tablet", { status: 403 });
  const now = Date.now();
  // The site's business's list; a manager printing from Manage → Handover list may ask for another list they keep (`?b=`).
  const asked = new URL(req.url).searchParams.get("b");
  const brand = isBrandId(asked) && prepListBrands(ctx.person, await store().sites()).includes(asked) ? asked : brandOf(ctx.site).id;
  const groups = receiptSheet(await store().prepItems(brand));
  const pdf = receiptPdf({
    title: "Handover list",
    lines: [`${ctx.site.name} · ${longDay(londonDate(now))}`, `Printed by ${ctx.person.name.split(" ")[0]} at ${londonHM(now)}`],
    groups,
    foot: BRANDS[brand].name,
  });
  return new NextResponse(Buffer.from(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${brandSlug([{ brand }])}-handover-list-${londonDate(now)}.pdf"`, "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
