import type { MirrorGroup } from "@/lib/domain/stock";

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/**
 * Beside a round supplier's order: Stock needed as it is right now, a card per supplier (in Stock needed's order),
 * each item's amount per branch and in total, so the order can be made up from it. What this supplier also sells is
 * marked. Read-only: ticking stays on Stock needed.
 */
export function NeededMirror({ groups, supplierName, sites }: { groups: MirrorGroup[]; supplierName: string; sites: { id: string; name: string }[] }) {
  const cols = sites.filter((s) => groups.some((g) => g.rows.some((r) => r.sites.some((x) => x.siteId === s.id))));
  const items = groups.reduce((n, g) => n + g.rows.length, 0);
  const sold = groups.reduce((n, g) => n + g.rows.filter((r) => r.sold).length, 0);
  const cell = (r: MirrorGroup["rows"][number], siteId: string) => {
    const x = r.sites.find((y) => y.siteId === siteId);
    if (!x) return <span className="muted">–</span>;
    return <>{x.qty ? fmt(x.qty) : ""}{x.unknown ? <span className="muted">{x.qty ? " +?" : "?"}</span> : null}</>;
  };
  return (
    <section className="card stack round-need" aria-label="Stock needed" style={{ gap: 10 }}>
      <div className="stack" style={{ gap: 2 }}>
        <h2 className="h-sec" style={{ margin: 0 }}>Stock needed</h2>
        <div className="muted" style={{ fontSize: 14 }}>
          Everything on Stock needed right now ({items} item{items === 1 ? "" : "s"}), by supplier, per branch and in total. Their packs, not {supplierName}&apos;s cases.
          {sold > 0 && <> <span className="chip done" style={{ fontSize: 11 }}>{supplierName}</span> marks the {sold} {supplierName} sells too.</>}
        </div>
      </div>
      {groups.length === 0 && <div className="muted">Nothing on Stock needed at the moment.</div>}
      {groups.map((g) => (
        <div key={g.key} className="stack" style={{ gap: 6 }}>
          <div className="stock-ticked-head muted" style={{ borderTop: 0, paddingTop: 0 }}>{g.name} ({g.rows.length})</div>
          <div className="round-need-wrap">
            <table className="round-need-table">
              <thead>
                <tr><th scope="col">Item</th>{cols.map((s) => <th key={s.id} scope="col" className="rn-num">{s.name}</th>)}<th scope="col" className="rn-num">Total</th></tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.product.id}>
                    <th scope="row">
                      <span className="strong">{r.product.name}</span>
                      {r.urgent && <span className="chip late" style={{ marginLeft: 6, fontSize: 11 }}>Urgent</span>}
                      {r.sold && <span className="chip done" style={{ marginLeft: 6, fontSize: 11 }}>{supplierName}</span>}
                      <span className="muted round-need-pack">{r.product.size ?? "Each"}</span>
                    </th>
                    {cols.map((s) => <td key={s.id} className="rn-num">{cell(r, s.id)}</td>)}
                    <td className="rn-num round-need-total">{fmt(r.total)}{r.unknown ? <span className="muted"> +?</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {groups.some((g) => g.rows.some((r) => r.unknown)) && <div className="muted" style={{ fontSize: 13 }}>? = asked for without an amount.</div>}
    </section>
  );
}
