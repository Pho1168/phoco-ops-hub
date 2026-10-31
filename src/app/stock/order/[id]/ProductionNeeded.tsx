import type { ProductionNeedRow } from "@/lib/domain/stock";

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/**
 * Beside a round supplier's order: what the restaurants have asked the production kitchen for and it hasn't sent yet,
 * the amount per branch and the total, so the order can be made up from it. The supplier's own items first.
 */
export function ProductionNeeded({ rows, supplierName, sites }: { rows: ProductionNeedRow[]; supplierName: string; sites: { id: string; name: string }[] }) {
  const cols = sites.filter((s) => rows.some((r) => r.sites.some((x) => x.siteId === s.id)));
  const parts = [
    { title: `Sold by ${supplierName}`, rows: rows.filter((r) => r.fromSupplier) },
    { title: "Other production items", rows: rows.filter((r) => !r.fromSupplier) },
  ].filter((p) => p.rows.length);
  const cell = (r: ProductionNeedRow, siteId: string) => {
    const x = r.sites.find((y) => y.siteId === siteId);
    if (!x) return <span className="muted">–</span>;
    return <>{x.qty ? fmt(x.qty) : ""}{x.unknown ? <span className="muted">{x.qty ? " +?" : "?"}</span> : null}</>;
  };
  return (
    <section className="card stack round-need" aria-label="Stock needed from the restaurants" style={{ gap: 10 }}>
      <div className="stack" style={{ gap: 2 }}>
        <h2 className="h-sec" style={{ margin: 0 }}>Stock needed</h2>
        <div className="muted" style={{ fontSize: 14 }}>What the restaurants have asked production for and haven&apos;t been sent yet, per branch and in total. Their packs, not {supplierName}&apos;s cases.</div>
      </div>
      {rows.length === 0 && <div className="muted">Nothing asked for at the moment.</div>}
      {parts.map((p) => (
        <div key={p.title} className="stack" style={{ gap: 6 }}>
          <div className="stock-ticked-head muted" style={{ borderTop: 0, paddingTop: 0 }}>{p.title} ({p.rows.length})</div>
          <div className="round-need-wrap">
            <table className="round-need-table">
              <thead>
                <tr><th scope="col">Item</th>{cols.map((s) => <th key={s.id} scope="col" className="rn-num">{s.name}</th>)}<th scope="col" className="rn-num">Total</th></tr>
              </thead>
              <tbody>
                {p.rows.map((r) => (
                  <tr key={r.product.id}>
                    <th scope="row"><span className="strong">{r.product.name}</span><span className="muted round-need-pack">{r.product.size ?? "Each"}</span></th>
                    {cols.map((s) => <td key={s.id} className="rn-num">{cell(r, s.id)}</td>)}
                    <td className="rn-num round-need-total">{fmt(r.total)}{r.unknown ? <span className="muted"> +?</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {rows.some((r) => r.unknown) && <div className="muted" style={{ fontSize: 13 }}>? = asked for without an amount.</div>}
    </section>
  );
}
