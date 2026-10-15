import Link from "next/link";
import { store } from "@/lib/data";
import { productLabel, reqCode, STATE_LABEL, wantedOf, withProgress, type RequestState } from "@/lib/domain/stock";
import { londonDate, shortDay } from "@/lib/domain/time";
import { StockBar, StockNav } from "../Bar";
import { ownerStockCtx, qtyText } from "../load";

export const dynamic = "force-dynamic";

const PERIODS = { "30": 30, "90": 90, "365": 365, all: 0 } as const;

/** Every request (nothing is ever deleted): filter by site, state, period or product, and open one for its story. */
export default async function History(props: { searchParams: Promise<{ site?: string; state?: string; days?: string; q?: string }> }) {
  const sp = await props.searchParams;
  const { ctx, onPhone } = await ownerStockCtx();
  const db = store();
  const now = Date.now();
  const days = PERIODS[(sp.days ?? "30") as keyof typeof PERIODS] ?? 30;
  const [data, { products, suppliers }, sites] = await Promise.all([db.stockData({ since: days ? now - days * 86_400_000 : 0 }), db.stockCatalog(), db.sites()]);
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  const q = (sp.q ?? "").trim().toLowerCase();
  const rows = withProgress(data)
    .filter((x) => !sp.site || x.request.siteId === sp.site)
    .filter((x) => !sp.state || x.progress.state === sp.state)
    .filter((x) => { if (!q) return true; const p = products.find((y) => y.id === x.request.productId); return !!p && `${p.name} ${p.size ?? ""}`.toLowerCase().includes(q); })
    .sort((a, b) => b.request.createdAt - a.request.createdAt);
  const shown = rows.slice(0, 300);
  return (
    <>
      <StockBar ctx={ctx} onPhone={onPhone} title="Stock history" back="/stock" eyebrow="Stock & Purchasing · every site" />
      <main className="wide stack">
        <form className="stock-filter" method="get">
          <input className="txt" name="q" type="search" placeholder="Product" defaultValue={sp.q ?? ""} aria-label="Product" />
          <select name="site" defaultValue={sp.site ?? ""} aria-label="Site"><option value="">Every site</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select name="state" defaultValue={sp.state ?? ""} aria-label="State"><option value="">Any state</option>{(Object.keys(STATE_LABEL) as RequestState[]).map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}</select>
          <select name="days" defaultValue={sp.days ?? "30"} aria-label="Period"><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last year</option><option value="all">Everything</option></select>
          <button className="btn small" type="submit">Show</button>
          <span className="muted">{rows.length} request{rows.length === 1 ? "" : "s"}{rows.length > shown.length ? `, newest ${shown.length} shown` : ""}</span>
        </form>
        <div className="table-wrap">
          <table className="rec">
            <thead><tr><th>Request</th><th>Day</th><th>Site</th><th>Product</th><th>Supplier</th><th>Wanted</th><th>Got</th><th>Received</th><th>State</th></tr></thead>
            <tbody>
              {shown.map(({ request: r, progress: p }) => {
                const prod = products.find((x) => x.id === r.productId);
                return (
                  <tr key={r.id}>
                    <td><Link href={`/stock/request/${r.id}`}>{reqCode(r)}</Link></td>
                    <td>{shortDay(londonDate(r.createdAt))}</td>
                    <td>{siteName.get(r.siteId) ?? r.siteId}</td>
                    <td>{prod ? productLabel(prod) : "?"}{r.level === "out" ? " (out)" : ""}</td>
                    <td>{suppliers.find((s) => s.id === r.supplierId)?.name ?? "—"}</td>
                    <td>{qtyText(wantedOf(r))}</td><td>{qtyText(p.obtained)}</td><td>{qtyText(p.received)}</td>
                    <td>{STATE_LABEL[p.state]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
      <StockNav ctx={ctx} onPhone={onPhone} />
    </>
  );
}
