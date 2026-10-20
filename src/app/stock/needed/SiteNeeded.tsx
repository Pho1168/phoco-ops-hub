"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { editSiteNeededAction } from "@/app/actions";

export interface SiteRow {
  productId: string; name: string; pack?: string; qty: number; unknown: boolean; urgent: boolean; notes: string[];
  /** Still waiting: the amount can be changed or the item removed. */
  editable: boolean;
  /** Why not, when it can't be changed here. */
  status?: string;
  /** The latest change today, ready to show. */
  changed?: string;
  /** Every shop that sells it, this card's first ("Loon Fung/Lidl/Aldi/Asda"), when there's more than one. */
  shops?: string;
}
export interface SiteGroup {
  key: string; name: string; methodLabel: string; rows: SiteRow[];
  drivers: { name: string; items: string }[];
  ticked: { name: string; qty: number; who: string }[];
  removed: string[];
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));
const MAX = 9999;

/**
 * Stock needed on the restaurant's tablet: what it has asked for, by supplier. Anyone signed in can change how many of
 * something is still needed, or remove it (asked first). Ordering stays with the owner: ticked, given to a driver or
 * on the kitchen's order is shown, not changed.
 */
export function SiteNeeded({ site, groups }: { site: string; groups: SiteGroup[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  useEffect(() => { setEditing(null); setRemoving(null); }, [groups]);

  const save = (productId: string, qty: number | null) => {
    setErr("");
    start(async () => {
      const r = await editSiteNeededAction(productId, qty);
      if (!r.ok) setErr(r.error);
      router.refresh();
    });
  };

  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  if (!groups.length) return <div className="card muted">Nothing on the list for {site} right now. Add what you need on Report stock.</div>;
  return (
    <div className="stack">
      <p className="muted lead" style={{ margin: 0 }}>
        {total} item{total === 1 ? "" : "s"} {site} has asked for, by supplier. Change an amount or remove what&apos;s no longer needed; the owner orders it.
      </p>
      {err && <div className="fix" role="alert" style={{ margin: 0 }}>{err}</div>}
      {groups.map((g) => (
        <section key={g.key || "none"} className="stock-group" aria-label={g.name}>
          <div className="stock-group-head">
            <h3 className="grow">{g.name}</h3>
            <span className="chip">{g.methodLabel}</span>
            {g.rows.length > 0 && <span className="chip late">{g.rows.length}</span>}
          </div>
          {g.rows.map((r) => {
            const ed = editing?.id === r.productId ? editing : null;
            const n = ed ? Number(ed.value) : NaN;
            const ok = !!ed && ed.value.trim() !== "" && Number.isFinite(n) && n > 0 && n <= MAX;
            return (
              <div key={r.productId} className="stock-row">
                <div className="stock-row-head">
                  <span className="stock-qty">{r.unknown ? "?" : fmt(r.qty)}</span>
                  <span className="grow stack" style={{ gap: 2, minWidth: 0 }}>
                    <span className="strong">{r.name}</span>
                    {r.pack && <span className="muted" style={{ fontSize: 13 }}>{r.pack}</span>}
                    {r.shops && <span className="stock-shops">{r.shops}</span>}
                  </span>
                  {r.urgent && <span className="chip bad">Urgent</span>}
                  {r.editable && !ed && removing !== r.productId && (
                    <>
                      <button type="button" className="btn ghost small" disabled={busy} onClick={() => { setRemoving(null); setEditing({ id: r.productId, value: r.unknown ? "" : fmt(r.qty) }); }}>Change amount</button>
                      <button type="button" className="btn ghost small" disabled={busy} onClick={() => { setEditing(null); setRemoving(r.productId); }}>Remove</button>
                    </>
                  )}
                  {!r.editable && r.status && <span className="muted" style={{ fontSize: 13 }}>{r.status}</span>}
                </div>
                {ed && (
                  <div className="stock-site">
                    <span className="stepper">
                      <button type="button" aria-label="One less" disabled={busy || !(n > 1)} onClick={() => setEditing({ id: r.productId, value: fmt(Math.max(1, Math.ceil(n) - 1)) })}>−</button>
                      <input className="txt" inputMode="decimal" aria-label={`How many ${r.name}`} value={ed.value} onChange={(e) => setEditing({ id: r.productId, value: e.target.value })} />
                      <button type="button" aria-label="One more" disabled={busy || n >= MAX} onClick={() => setEditing({ id: r.productId, value: fmt(Number.isFinite(n) ? Math.floor(n) + 1 : 1) })}>+</button>
                    </span>
                    <button type="button" className="btn small" disabled={!ok || busy || (!r.unknown && n === r.qty)} onClick={() => save(r.productId, n)}>Save</button>
                    <button type="button" className="btn ghost small" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                )}
                {removing === r.productId && (
                  <div className="fix warn" role="alert" style={{ margin: 0 }}>
                    <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
                      <strong className="grow">Remove {r.unknown ? "" : `${fmt(r.qty)} × `}{r.name} from the list?</strong>
                      <button type="button" className="btn small" disabled={busy} onClick={() => save(r.productId, null)}>Yes, remove</button>
                      <button type="button" className="btn ghost small" disabled={busy} onClick={() => setRemoving(null)}>Keep it</button>
                    </div>
                  </div>
                )}
                {r.changed && <div className="muted" style={{ fontSize: 13 }}>{r.changed}</div>}
                {r.notes.length > 0 && <div style={{ fontSize: 14 }}>&ldquo;{r.notes.join("” · “")}&rdquo;</div>}
              </div>
            );
          })}
          {g.drivers.map((d, i) => (
            <div key={i} className="stock-row">
              <div className="strong">With {d.name}</div>
              <div className="muted" style={{ fontSize: 14 }}>{d.items}</div>
            </div>
          ))}
          {g.ticked.length > 0 && (
            <>
              <div className="stock-ticked-head muted">Ordered today</div>
              {g.ticked.map((t) => (
                <div key={t.name} className="stock-row done">
                  <div className="stock-row-head">
                    <span className="stock-qty">{fmt(t.qty)}</span>
                    <span className="grow strong" style={{ textDecoration: "line-through", color: "var(--ink-2)" }}>{t.name}</span>
                    <span className="muted" style={{ fontSize: 13 }}>{t.who}</span>
                  </div>
                </div>
              ))}
            </>
          )}
          {g.removed.length > 0 && <div className="muted" style={{ fontSize: 13 }}>{g.removed.join(" · ")}</div>}
        </section>
      ))}
    </div>
  );
}
