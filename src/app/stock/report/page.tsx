import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { frequent, isClosed, STATE_LABEL, typicalQty } from "@/lib/domain/stock";
import { stockView } from "@/lib/stock-service";
import { StockBar } from "../Bar";
import { stockCtx } from "../load";
import { ReportStock } from "./ReportStock";

export const dynamic = "force-dynamic";

/** Report Stock: the products this restaurant orders, what's already asked for, the person's unsent report. */
export default async function ReportPage() {
  const { ctx, onPhone, can } = await stockCtx();
  if (!can.report) redirect("/stock");
  const db = store();
  const now = Date.now();
  const { catalog, items } = await stockView(db, now, [ctx.site.id], 365);
  const draft = await db.stockDraft(ctx.site.id, ctx.person.id);
  const lastSent = (await db.stockReports([ctx.site.id], now - 60 * 86_400_000)).some((r) => r.lines.length > 0);
  const history = items.map((x) => x.request);
  // A production kitchen doesn't order what it makes itself.
  const ownSupplier = new Set(catalog.suppliers.filter((s) => s.method === "production" && s.siteId === ctx.site.id).map((s) => s.id));
  const products = catalog.products.filter((p) => p.active && !(p.supplierId && ownSupplier.has(p.supplierId)))
    .map((p) => ({ id: p.id, name: p.name, size: p.size, category: p.category, typical: typicalQty(history, p.id, ctx.site.id) }));
  const open = items.filter((x) => !isClosed(x.progress)).map((x) => ({ productId: x.request.productId, state: STATE_LABEL[x.progress.state] }));
  return (
    <>
      <StockBar ctx={ctx} onPhone={onPhone} title="Report stock" back="/stock" />
      <ReportStock siteName={ctx.site.name} products={products} frequent={frequent(history, ctx.site.id, now)} open={open}
        draft={draft ? { lines: draft.lines, noIssues: draft.noIssues } : undefined} canRepeat={lastSent} />
    </>
  );
}
