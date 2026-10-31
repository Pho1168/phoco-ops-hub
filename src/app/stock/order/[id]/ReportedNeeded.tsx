import type { ReportedRow } from "@/lib/domain/stock";

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/**
 * Beside a round supplier's order for a restaurant (Cafe La Viet's Surelygrow): everything else the restaurant has
 * reported and is still waiting, so the order can be made up from it. What the supplier also sells comes first.
 */
export function ReportedNeeded({ rows, supplierName, siteName }: { rows: ReportedRow[]; supplierName: string; siteName: string }) {
  const parts = [
    { title: `${supplierName} sells these too`, rows: rows.filter((r) => r.sold) },
    { title: "Everything else reported", rows: rows.filter((r) => !r.sold) },
  ].filter((p) => p.rows.length);
  return (
    <section className="card stack round-need" aria-label={`Stock reported at ${siteName}`} style={{ gap: 10 }}>
      <div className="stack" style={{ gap: 2 }}>
        <h2 className="h-sec" style={{ margin: 0 }}>Stock reported</h2>
        <div className="muted" style={{ fontSize: 14 }}>Everything else {siteName} has reported and is still waiting on Stock needed, with who it&apos;s usually bought from. Their packs, not {supplierName}&apos;s cases.</div>
      </div>
      {rows.length === 0 && <div className="muted">Nothing else reported at the moment.</div>}
      {parts.map((p) => (
        <div key={p.title} className="stack" style={{ gap: 6 }}>
          <div className="stock-ticked-head muted" style={{ borderTop: 0, paddingTop: 0 }}>{p.title} ({p.rows.length})</div>
          <div className="round-need-wrap">
            <table className="round-need-table">
              <thead><tr><th scope="col">Item</th><th scope="col">Usually from</th><th scope="col" className="rn-num">Needed</th></tr></thead>
              <tbody>
                {p.rows.map((r) => (
                  <tr key={r.product.id}>
                    <th scope="row"><span className="strong">{r.product.name}</span>{r.urgent && <span className="chip late" style={{ marginLeft: 6 }}>Urgent</span>}<span className="muted round-need-pack">{r.product.size ?? "Each"}</span></th>
                    <td className="muted">{r.supplier}</td>
                    <td className="rn-num round-need-total">{r.qty ? fmt(r.qty) : ""}{r.unknown ? <span className="muted">{r.qty ? " +?" : "?"}</span> : null}</td>
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
