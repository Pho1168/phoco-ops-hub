import { NextResponse } from "next/server";
import { store } from "@/lib/data";
import { editsSiteNeeded, neededCount, neededSheet, runsOrdering } from "@/lib/domain/stock";
import { londonDate, londonHM, longDay } from "@/lib/domain/time";
import { checklistPdf } from "@/lib/pdf";
import { current } from "@/lib/session";
import { neededView, siteNeededView } from "@/lib/stock-service";

export const dynamic = "force-dynamic";

/**
 * Everything on Stock needed as one tick-off sheet (PDF): new items, then each supplier's items with a box to tick,
 * the amount and who it's for. For owners and operations managers, to print or keep on a phone. On a restaurant's tablet,
 * everyone else who can see its Stock needed gets the same sheet for that restaurant only.
 */
export async function GET() {
  const ctx = await current();
  if (!ctx || ctx.person.pinMustChange) return new NextResponse("Sign in to see this", { status: 401 });
  const orders = runsOrdering(ctx.person);
  if (!orders && !editsSiteNeeded(ctx.person, ctx.site, ctx.scope)) return new NextResponse("Only the owner, operations managers and the restaurant's tablet can print this", { status: 403 });
  const db = store();
  const now = Date.now();
  // Owners and ops: everything they order for. The tablet: this restaurant's list (new items go to the owner, not shown).
  const view = orders ? await neededView(db, ctx.person, now) : undefined;
  const mine = view ? undefined : await siteNeededView(db, ctx.site.id, now);
  const groups = view?.groups ?? mine!.groups;
  const sites = view?.sites ?? [ctx.site];
  const newItems = view ? await db.stockNewItems({ open: true, siteIds: view.siteIds }) : [];
  const name = new Map(sites.map((s) => [s.id, s.name]));
  const supplierName = new Map((await db.stockCatalog()).suppliers.filter((s) => s.active).map((s) => [s.id, s.name]));
  const sheet = neededSheet(groups, newItems, (id) => name.get(id) ?? id, (id) => supplierName.get(id));
  const items = neededCount(groups) + newItems.length;
  const suppliers = groups.filter((g) => g.rows.length).length;
  const today = londonDate(now);
  const pdf = checklistPdf({
    title: orders ? "PHO & CO stock needed" : `PHO & CO stock needed \u00b7 ${ctx.site.name}`,
    lines: [longDay(today), `${items} item${items === 1 ? "" : "s"} from ${suppliers} supplier${suppliers === 1 ? "" : "s"}`, `Printed by ${ctx.person.name.split(" ")[0]} at ${londonHM(now)}`],
    groups: sheet,
    foot: "Tick in the app too, so the list stays right for everyone.",
  });
  return new NextResponse(Buffer.from(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="PHO-CO-stock-needed-${today}.pdf"`, "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
