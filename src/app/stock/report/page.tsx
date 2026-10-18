import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { editsSiteNeeded, frequent, isClosed, siteWaitingRows, STATE_LABEL, typicalQty } from "@/lib/domain/stock";
import { siteNeededView, stockView } from "@/lib/stock-service";
import { StockBar, StockNav } from "../Bar";
import { stockCtx } from "../load";
import { ReportStock, type Waiting } from "./ReportStock";

export const dynamic = "force-dynamic";

/**
 * Report Stock: the catalogue on the left, the person's list on the right (their unsent picks, then what the
 * restaurant already has on Stock needed, until the buyer ticks it off).
 */
export default async function ReportPage() {
  const { ctx, onPhone, can } = await stockCtx();
  if (!can.report) redirect("/stock");
  const db = store();
  const now = Date.now();
  const [{ catalog, items }, site] = await Promise.all([stockView(db, now, [ctx.site.id], 365), siteNeededView(db, ctx.site.id, now)]);
  const draft = await db.stockDraft(ctx.site.id, ctx.person.id);
  const lastSent = (await db.stockReports([ctx.site.id], now - 60 * 86_400_000)).some((r) => r.lines.length > 0);
  const history = items.map((x) => x.request);
  // A production kitchen doesn't order what it makes itself.
  const ownSupplier = new Set(catalog.suppliers.filter((s) => s.method === "production" && s.siteId === ctx.site.id).map((s) => s.id));
  const products = catalog.products.filter((p) => p.active && !(p.supplierId && ownSupplier.has(p.supplierId)))
    .map((p) => ({ id: p.id, name: p.name, size: p.size, category: p.category, typical: typicalQty(history, p.id, ctx.site.id) }));
  const open = items.filter((x) => !isClosed(x.progress)).map((x) => ({ productId: x.request.productId, state: STATE_LABEL[x.progress.state] }));
  const waiting: Waiting[] = siteWaitingRows(site.groups, site.items).map(({ row, group, editable, status }) => ({
    productId: row.product.id, name: row.product.name, pack: row.product.size, qty: row.qty, unknown: row.qty === 0 && row.unknownIds.length > 0, urgent: row.urgent,
    supplier: group.supplier?.name ?? "No supplier yet", editable, status: status === "kitchen" ? "On the kitchen's order" : status === "ordering" ? "Being ordered" : undefined,
  })).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <StockBar ctx={ctx} onPhone={onPhone} title="Report stock" back="/stock" />
      <ReportStock siteName={ctx.site.name} products={products} frequent={frequent(history, ctx.site.id, now)} open={open} waiting={waiting}
        canEditWaiting={editsSiteNeeded(ctx.person, ctx.site, ctx.scope)}
        draft={draft ? { lines: draft.lines, noIssues: draft.noIssues, extras: draft.extras } : undefined} canRepeat={lastSent} />
      <StockNav ctx={ctx} onPhone={onPhone} />
    </>
  );
}
