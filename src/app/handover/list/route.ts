import { brandOf, brandSlug } from "@/lib/domain/brand";
import { NextResponse } from "next/server";
import { store } from "@/lib/data";
import { canUsePrep, receiptSheet } from "@/lib/domain/prep";
import { londonDate, londonHM, longDay } from "@/lib/domain/time";
import { receiptPdf } from "@/lib/pdf";
import { current } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The handover list as a printed form for an 80 mm receipt printer (a Bluetooth Epson TM-m30II on the tablet): a tick
 * box for every item in use, a group at a time. For anyone using the prep handover at their site, on the full app.
 */
export async function GET() {
  const ctx = await current();
  if (!ctx || ctx.person.pinMustChange) return new NextResponse("Sign in to see this", { status: 401 });
  if (ctx.scope !== "full" || !canUsePrep(ctx.access)) return new NextResponse("The handover list is on the restaurant's tablet", { status: 403 });
  const now = Date.now();
  const groups = receiptSheet(await store().prepItems());
  const pdf = receiptPdf({
    title: "Handover list",
    lines: [`${ctx.site.name} · ${longDay(londonDate(now))}`, `Printed by ${ctx.person.name.split(" ")[0]} at ${londonHM(now)}`],
    groups,
    foot: brandOf(ctx.site).name,
  });
  return new NextResponse(Buffer.from(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${brandSlug([ctx.site])}-handover-list-${londonDate(now)}.pdf"`, "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
