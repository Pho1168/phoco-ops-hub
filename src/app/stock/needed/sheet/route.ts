import { NextResponse } from "next/server";
import { store } from "@/lib/data";
import { editsSiteNeeded, neededCount, neededReceipt, neededSheet, ordersByRound, runsOrdering } from "@/lib/domain/stock";
import { londonDate, londonHM, longDay } from "@/lib/domain/time";
import { checklistPdf, receiptPdf } from "@/lib/pdf";
import { current } from "@/lib/session";
import { brandOf, brandPrefix, brandSlug } from "@/lib/domain/brand";
import { neededView, siteNeededView } from "@/lib/stock-service";

export const dynamic = "force-dynamic";

/**
 * Everything on Stock needed as one tick-off sheet (PDF): new items, then each supplier's items with a box to tick,
 * the amount and who it's for. For owners and operations managers, to print or keep on a phone. On a restaurant's tablet,
 * everyone else who can see its Stock needed gets the same sheet for that restaurant only. `?format=receipt` makes it
 * for the 80 mm receipt printer instead of A4 (`receiptPdf`, in parts no longer than A4).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const receipt = url.searchParams.get("format") === "receipt";
  const ctx = await current();
  if (!ctx || ctx.person.pinMustChange) return new NextResponse("Sign in to see this", { status: 401 });
  const orders = runsOrdering(ctx.person);
  if (!orders && !editsSiteNeeded(ctx.person, ctx.site, ctx.scope)) return new NextResponse("Only the owner, operations managers and the restaurant's tablet can print this", { status: 403 });
  const db = store();
  const now = Date.now();
  // Owners and ops: everything they order for. The tablet: this restaurant's list (new items go to the owner, not shown).
  // The business of the site they're working at, as on the page.
  const view = orders ? await neededView(db, ctx.person, now, brandOf(ctx.site).id) : undefined;
  const mine = view ? undefined : await siteNeededView(db, ctx.site.id, now);
  // A round supplier's order (Surelygrow) is its own list, kept off Stock needed and so off this sheet.
  const groups = view ? view.groups.filter((g) => !ordersByRound(g.supplier)) : mine!.groups;
  const sites = view ? view.sites.filter((s) => view.siteIds.includes(s.id)) : [ctx.site];
  const newItems = view ? await db.stockNewItems({ open: true, siteIds: view.siteIds }) : [];
  const name = new Map(sites.map((s) => [s.id, s.name]));
  const supplierName = new Map((await db.stockCatalog()).suppliers.filter((s) => s.active).map((s) => [s.id, s.name]));
  const sheet = neededSheet(groups, newItems, (id) => name.get(id) ?? id, (id) => supplierName.get(id));
  const items = neededCount(groups) + newItems.length;
  const suppliers = groups.filter((g) => g.rows.length).length;
  const today = londonDate(now);
  const head = {
    title: `${brandPrefix(sites) ? `${brandPrefix(sites)}stock needed` : "Stock needed"}${orders ? "" : ` \u00b7 ${ctx.site.name}`}`,
    lines: [longDay(today), `${items} item${items === 1 ? "" : "s"} from ${suppliers} supplier${suppliers === 1 ? "" : "s"}`, `Printed by ${ctx.person.name.split(" ")[0]} at ${londonHM(now)}`],
    foot: "Tick in the app too, so the list stays right for everyone.",
  };
  const pdf = receipt ? receiptPdf({ ...head, groups: neededReceipt(sheet) }) : checklistPdf({ ...head, groups: sheet });
  return new NextResponse(Buffer.from(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${brandSlug(sites)}-stock-needed-${today}-${londonHM(now).replace(":", "")}.pdf"`, "cache-control": "no-store, no-cache, must-revalidate, max-age=0", pragma: "no-cache", expires: "0", "x-content-type-options": "nosniff" },
  });
}
