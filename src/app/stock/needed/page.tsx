import { store } from "@/lib/data";
import { buyFrom, canPurchase, lookAlikes, methodOf, runsPurchasing } from "@/lib/domain/stock";
import { londonDate, shortDay } from "@/lib/domain/time";
import { neededView } from "@/lib/stock-service";
import { Icon } from "@/components/Icon";
import { StockBar, StockNav } from "../Bar";
import { orderingStockCtx } from "../load";
import { NeededBoard, type BoardGroup } from "./NeededBoard";
import { NewItemsCard } from "./NewItemsCard";
import { ClearNeeded } from "./ClearNeeded";

export const dynamic = "force-dynamic";

/**
 * Stock needed (owners and operations managers): everything the restaurants asked for, one card per supplier, as a
 * checklist. Tick = ordered or bought (production: sent). Shop runs can go to a driver; a delivery supplier's list
 * downloads as a PDF to email.
 */
export default async function NeededPage() {
  const { ctx, onPhone } = await orderingStockCtx();
  const db = store();
  const now = Date.now();
  const [{ groups, sites, items, siteIds, catalog }, people, purchasers] = await Promise.all([neededView(db, ctx.person, now), db.people(), db.purchaserIds()]);
  const newItems = await db.stockNewItems({ open: true, siteIds });
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  // What clearing would take off: every row and every item with a driver, and new items (the owner's to decide).
  const clearable = groups.reduce((n, g) => n + g.rows.length + g.drivers.reduce((m, d) => m + d.open, 0), 0) + (runsPurchasing(ctx.person) ? newItems.length : 0);
  const drivers = people.filter((p) => canPurchase({ ...p, purchaser: purchasers.includes(p.id) }))
    .map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name));
  const board: BoardGroup[] = groups.map((g) => ({
    key: g.key, name: g.supplier?.name ?? "No supplier yet", method: g.supplier?.method ?? "shop", methodLabel: g.supplier ? methodOf(g.supplier.method)?.label ?? "" : "Set one in the catalogue",
    production: g.production, pdf: g.supplier?.method === "delivery",
    rows: g.rows.map((r) => ({
      productId: r.product.id, name: r.product.name, pack: r.product.size, qty: r.qty, urgent: r.urgent, notes: r.notes, photoIds: r.photoIds,
      sites: r.sites.filter((s) => s.qty > 0).map((s) => ({ name: siteName.get(s.siteId) ?? s.siteId, qty: s.qty })),
      unknown: r.unknownIds.map((id) => {
        const siteId = items.find((x) => x.request.id === id)?.request.siteId;
        return { requestId: id, site: siteId ? siteName.get(siteId) ?? siteId : undefined };
      }),
      // Other shops that sell it, to move it to before a run (not for a production kitchen's items).
      buyFrom: g.production ? [] : buyFrom(r.product, catalog.suppliers).filter((s) => s.id !== g.supplier?.id).map((s) => ({ id: s.id, name: s.name })),
    })),
    drivers: g.drivers.map((d) => ({ taskId: d.task.id, name: d.task.assigneeName ?? "Someone", items: d.items, open: d.open, done: d.done })),
  }));
  return (
    <>
      <StockBar ctx={ctx} onPhone={onPhone} title="Stock needed" back="/stock" eyebrow={`Stock · ${shortDay(londonDate(now))}`} />
      <main className="stack">
        {(clearable > 0 || newItems.length > 0) && (
          <div className="row wrap no-print" style={{ gap: 8, alignItems: "center" }}>
            <span className="muted grow" style={{ fontSize: 14 }}>Everything below on one page, with boxes to tick.</span>
            <a className="btn small" href="/stock/needed/sheet" target="_blank" rel="noreferrer"><Icon name="print" /> Tick-off sheet (PDF)</a>
          </div>
        )}
        {newItems.length > 0 && (
          <NewItemsCard owner={runsPurchasing(ctx.person)}
            items={newItems.map((n) => ({ id: n.id, name: n.name, size: n.size, qty: n.qty, note: n.note, site: siteName.get(n.siteId) ?? n.siteId,
              by: n.requestedByName?.split(" ")[0], at: n.createdAt, like: lookAlikes(n.name, catalog.products).map((p) => ({ id: p.id, label: p.size ? `${p.name} · ${p.size}` : p.name })) }))}
            suppliers={catalog.suppliers.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name })).sort((a, b) => a.name.localeCompare(b.name))}
            categories={[...new Set(catalog.products.map((p) => p.category).filter((c): c is string => !!c))].sort()} />
        )}
        <NeededBoard groups={board} drivers={drivers} />
        {(clearable > 0) && <ClearNeeded count={clearable} />}
      </main>
      <StockNav ctx={ctx} onPhone={onPhone} />
    </>
  );
}
