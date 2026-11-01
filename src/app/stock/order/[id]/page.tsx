import { notFound, redirect } from "next/navigation";
import { brandOf } from "@/lib/domain/brand";
import { store } from "@/lib/data";
import { canPurchase, catalogFor, neededMirror, restaurantDemand, ordersByRound } from "@/lib/domain/stock";
import { neededView, roundSite } from "@/lib/stock-service";
import { RoundCatalogue } from "./RoundCatalogue";
import { NeededMirror } from "./NeededMirror";
import { StockBar, StockNav } from "../../Bar";
import { orderingStockCtx } from "../../load";
import { NeededBoard } from "../../needed/NeededBoard";
import { boardGroups } from "../../needed/board";

export const dynamic = "force-dynamic";

/**
 * A round supplier's order (Surelygrow, delivering to the Wembley kitchen on Monday and Friday): what the production
 * kitchen has asked for, on its own list, never mixed into Stock needed. Everything still waiting goes on the next
 * delivery, which closes at the end of the day before. Tick when ordered; the PDF is the order to email them. Under it,
 * the supplier's whole catalogue: the person ordering ticks more and how many, added on top of what's there. Beside
 * it (on a tablet or computer), what the restaurants have asked production for, per branch and in total, scrolling on
 * its own while the order stays still.
 */
export default async function RoundOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, onPhone } = await orderingStockCtx();
  const db = store();
  const now = Date.now();
  const supplier = (await db.stockCatalog()).suppliers.find((s) => s.id === id);
  if (!supplier || !ordersByRound(supplier)) notFound();
  // Only its own business's sites and catalogue (PHO & CO's Surelygrow and Cafe La Viet's are separate orders).
  const brand = supplier.brand ?? "phoco";
  // Only the business of the site they're working at: another business's round order isn't reachable from here.
  if (brand !== brandOf(ctx.site).id) redirect("/stock");
  const [{ groups, sites, items, catalog: everything, siteIds }, people, purchasers, kitchenId] = await Promise.all([neededView(db, ctx.person, now, brand), db.people(), db.purchaserIds(), roundSite(db, id)]);
  const catalog = catalogFor(everything, brand);
  // Its whole catalogue, for whoever orders for the kitchen it delivers to.
  const kitchen = kitchenId && siteIds.includes(kitchenId) ? sites.find((s) => s.id === kitchenId) : undefined;
  const range = catalog.products.filter((p) => p.active && p.supplierId === supplier.id).map((p) => ({ id: p.id, name: p.name, size: p.size, category: p.category }));
  const group = groups.find((g) => g.supplier?.id === supplier.id);
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  const board = group ? boardGroups([group], { siteName, items, suppliers: catalog.suppliers }) : [];
  const drivers = people.filter((p) => canPurchase({ ...p, purchaser: purchasers.includes(p.id) }))
    .map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name));
  // What the restaurants want of each one: still to send of the kitchen's copies (restaurants order those).
  const demand = restaurantDemand(groups, catalog.products, kitchen?.id);
  const wanted: Record<string, { qty: number; sizes: string[]; sites: string }> = {};
  for (const [pid, d] of demand) wanted[pid] = { qty: d.qty, sizes: d.sizes, sites: d.sites.map((x) => `${siteName.get(x.siteId) ?? x.siteId} ${x.qty}`).join(", ") };
  // Beside it: Stock needed as it is (this business's), every supplier's items per branch and in total.
  const mirror = neededMirror(groups, catalog.products, supplier.id);
  const mirrorSites = sites.filter((s) => siteIds.includes(s.id)).map((s) => ({ id: s.id, name: s.name }));
  const onOrder: Record<string, number> = {};
  for (const r of group?.rows ?? []) if (kitchen && r.sites.some((x) => x.siteId === kitchen.id)) onOrder[r.product.id] = r.sites.filter((x) => x.siteId === kitchen.id).reduce((t, x) => t + x.qty, 0);
  return (
    <>
      <StockBar ctx={ctx} neutral onPhone={onPhone} title={`${supplier.name} order`} back="/stock/needed" />
      <main className="wide">
        <div className="round-cols">
        <div className="stack round-left">
        {board.some((g) => g.rows.length > 0) && <NeededBoard groups={board.filter((g) => g.rows.length > 0)} drivers={drivers} round />}
        {kitchen && range.length > 0 && <RoundCatalogue supplierId={supplier.id} supplierName={supplier.name} siteName={kitchen.name} products={range} onOrder={onOrder} wanted={wanted} />}
        </div>
        <NeededMirror groups={mirror} supplierName={supplier.name} sites={mirrorSites} />
        </div>
      </main>
      <StockNav ctx={ctx} onPhone={onPhone} />
    </>
  );
}
