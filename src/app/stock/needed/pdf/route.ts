import { NextResponse } from "next/server";
import { store } from "@/lib/data";
import { orderSheetLines, runsOrdering } from "@/lib/domain/stock";
import { londonDate, londonHM, longDay } from "@/lib/domain/time";
import { orderSheetPdf } from "@/lib/pdf";
import { current } from "@/lib/session";
import { deliversTo, neededGroup } from "@/lib/stock-service";

export const dynamic = "force-dynamic";

/**
 * A supplier's order sheet as a PDF (what Stock needed still has to order from them, every restaurant's added up), to
 * email to the supplier. Owners and operations managers only.
 */
export async function GET(req: Request) {
  const ctx = await current();
  if (!ctx || ctx.person.pinMustChange) return new NextResponse("Sign in to see this", { status: 401 });
  if (!runsOrdering(ctx.person)) return new NextResponse("Only the owner and operations managers order stock", { status: 403 });
  const key = new URL(req.url).searchParams.get("supplier") ?? "";
  if (key.length > 64) return new NextResponse("Not found", { status: 404 });
  const db = store();
  const now = Date.now();
  const { group } = await neededGroup(db, ctx.person, key, now);
  if (!group?.supplier) return new NextResponse("Nothing to order from that supplier", { status: 404 });
  const lines = orderSheetLines(group);
  const to = await deliversTo(db, group.supplier.id);
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));
  const today = londonDate(now);
  const pdf = orderSheetPdf({
    title: `PHO & CO stock order: ${group.supplier.name}`,
    lines: [`Date: ${longDay(today)}`, ...(to ? [`Deliver to: PHO & CO ${to}`] : []), `Ordered by: ${ctx.person.name}`],
    rows: lines.map((l) => ({ qty: fmt(l.qty), item: l.name, pack: l.pack })),
    foot: `${lines.length} item${lines.length === 1 ? "" : "s"}. Made in PHO & CO Ops Hub at ${londonHM(now)}.`,
  });
  const file = `PHO-CO-order-${group.supplier.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${today}.pdf`;
  return new NextResponse(Buffer.from(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${file}"`, "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
