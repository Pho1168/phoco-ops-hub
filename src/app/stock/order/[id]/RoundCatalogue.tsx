"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { addFromCatalogueAction } from "@/app/actions";

interface P { id: string; name: string; size?: string; category?: string }
const MAX = 9999;
const fmt = (n: number) => String(Math.round(n * 100) / 100);

/**
 * A round supplier's whole catalogue (Surelygrow's) on its order page: tick what the kitchen needs, say how many, and
 * add it to the order. What's already on the order stays; the amount ticked here goes on top of it.
 */
export function RoundCatalogue({ supplierId, supplierName, siteName, products, onOrder, wanted }:
  { supplierId: string; supplierName: string; siteName: string; products: P[]; onOrder: Record<string, number>;
    wanted: Record<string, { qty: number; sizes: string[]; sites: string }> }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Record<string, number | undefined>>({});
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("all");
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [busy, start] = useTransition();

  const cats = useMemo(() => [...new Set(products.map((p) => p.category ?? "Other"))].sort((a, b) => a.localeCompare(b)), [products]);
  const q = query.trim().toLowerCase();
  const nWanted = products.filter((p) => wanted[p.id]).length;
  const shown = products.filter((p) => (q ? `${p.name} ${p.size ?? ""}`.toLowerCase().includes(q)
    : cat === "all" || (cat === "ticked" ? p.id in picked : cat === "wanted" ? !!wanted[p.id] : (p.category ?? "Other") === cat)));
  const ids = Object.keys(picked);
  const missing = ids.filter((id) => !(picked[id]! > 0)).length;

  const toggle = (p: P) => { setMsg(undefined); setPicked((x) => { const n = { ...x }; if (p.id in n) delete n[p.id]; else n[p.id] = 1; return n; }); };
  const set = (id: string, v: number | undefined) => setPicked((x) => ({ ...x, [id]: v === undefined ? undefined : Math.min(MAX, Math.max(0, v)) }));

  const add = () => start(async () => {
    setMsg(undefined);
    const lines = ids.map((productId) => ({ productId, qty: picked[productId] ?? 0 }));
    const r = await addFromCatalogueAction(supplierId, lines);
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
    setPicked({});
    setMsg({ ok: true, text: `Added ${r.added} item${r.added === 1 ? "" : "s"} to the ${supplierName} order.` });
    router.refresh();
  });

  return (
    <section className="card stack round-cat" aria-label={`${supplierName} catalogue`}>
      <div className="stack" style={{ gap: 4 }}>
        <h2 className="h-sec" style={{ margin: 0 }}>{supplierName} catalogue</h2>
        <div className="muted" style={{ fontSize: 14 }}>
          Tick what {siteName} needs from {supplierName} and say how many. It goes on the order above, on top of anything already there.
        </div>
      </div>
      <input className="txt" type="search" style={{ width: "100%", maxWidth: "none" }} placeholder="Search, e.g. lime" aria-label="Search the catalogue" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="chips stock-cats" role="group" aria-label="Show">
        <button type="button" className={`chip ${cat === "all" && !q ? "done" : ""}`} onClick={() => setCat("all")}>All ({products.length})</button>
        {nWanted > 0 && <button type="button" className={`chip ${cat === "wanted" && !q ? "done" : ""}`} onClick={() => setCat("wanted")}>Restaurants want ({nWanted})</button>}
        {ids.length > 0 && <button type="button" className={`chip ${cat === "ticked" && !q ? "done" : ""}`} onClick={() => setCat("ticked")}>Ticked ({ids.length})</button>}
        {cats.map((c) => <button key={c} type="button" className={`chip ${cat === c && !q ? "done" : ""}`} onClick={() => setCat(c)}>{c}</button>)}
      </div>
      {shown.length === 0 && <div className="muted">Nothing matches{q ? ` “${query.trim()}”` : ""}.</div>}
      <div className="stock-list">
        {shown.map((p) => {
          const on = p.id in picked;
          const v = picked[p.id];
          const have = onOrder[p.id];
          const want = wanted[p.id];
          return (
            <div key={p.id} className={`stock-item ${on ? "on" : ""}`}>
              <button type="button" className="stock-head" aria-pressed={on} onClick={() => toggle(p)}>
                <span className="mark" aria-hidden="true">{on ? "✓" : "+"}</span>
                <span className="grow stack" style={{ gap: 2, textAlign: "left" }}>
                  <span className="strong">{p.name}</span>
                  <span className="muted" style={{ fontSize: 13 }}>{p.size ?? "Each"}{have ? ` · on the order: ${fmt(have)}` : ""}</span>
                  {want && <span className="round-want">Restaurants want {fmt(want.qty)} × {want.sizes.join(" / ")} <span className="muted">({want.sites})</span></span>}
                </span>
                {on && v ? <span className="chip warn">{have ? `+${fmt(v)}` : fmt(v)}</span> : null}
              </button>
              {on && (
                <div className="round-cat-qty">
                  <div className="stepper" role="group" aria-label={`${p.name}: how many`}>
                    <button type="button" aria-label={`One less ${p.name}`} onClick={() => set(p.id, Math.max(1, (v ?? 1) - 1))}>−</button>
                    <input className="txt" inputMode="decimal" aria-label={`How many ${p.name}`} value={v !== undefined ? fmt(v) : ""} placeholder="0"
                      onChange={(e) => { const n = Number(e.target.value.replace(",", ".")); set(p.id, e.target.value.trim() === "" || !Number.isFinite(n) ? undefined : n); }} />
                    <button type="button" aria-label={`One more ${p.name}`} onClick={() => set(p.id, (v ?? 0) + 1)}>+</button>
                  </div>
                  {have ? <span className="muted" style={{ fontSize: 13 }}>{v ? `${fmt(have)} + ${fmt(v)} = ${fmt(have + v)} on the order` : `${fmt(have)} already on the order`}</span> : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="round-cat-bar">
        <span className="grow strong">{ids.length ? `${ids.length} ticked` : "Nothing ticked yet"}{missing ? ` · ${missing} without an amount` : ""}</span>
        {ids.length > 0 && <button type="button" className="btn ghost small" disabled={busy} onClick={() => { setPicked({}); setMsg(undefined); }}>Clear</button>}
        <button type="button" className="btn" disabled={busy || !ids.length || missing > 0} onClick={add}>{busy ? "Adding…" : "Add to order"}</button>
      </div>
      {msg && <div className={msg.ok ? "alert good" : "err"} role={msg.ok ? "status" : "alert"}>{msg.text}</div>}
    </section>
  );
}
