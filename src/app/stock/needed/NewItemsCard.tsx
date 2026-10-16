"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addNewStockItem, dismissNewStockItem } from "@/app/actions";

export interface NewItemView {
  id: string; name: string; size?: string; qty: number; note?: string; site: string; by?: string; at: number;
  /** Catalogue products with a similar name (it may already be there). */
  like: { id: string; label: string }[];
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));

/**
 * Items staff asked for that aren't in the catalogue. The owner checks the name and pack, chooses who it's bought from
 * and adds it (or picks the product it really is, or says it isn't needed); it then shows under its supplier below,
 * and staff can pick it next time. Operations managers see them waiting for the owner.
 */
export function NewItemsCard({ items, owner, suppliers, categories }: { items: NewItemView[]; owner: boolean; suppliers: { id: string; name: string }[]; categories: string[] }) {
  return (
    <section className="stock-group" aria-label="New items" style={{ border: "2px solid var(--accent)" }}>
      <div className="stock-group-head">
        <h3 className="grow">New items</h3>
        <span className="chip late">{items.length}</span>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        {owner ? "Asked for, but not in the catalogue yet. Check the name, choose who it's bought from and add it: it goes on the list below, and staff can pick it next time."
          : "Asked for, but not in the catalogue yet. Waiting for the owner to add them."}
      </p>
      <datalist id="stock-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      {items.map((i) => <Item key={i.id} item={i} owner={owner} suppliers={suppliers} />)}
    </section>
  );
}

function Item({ item, owner, suppliers }: { item: NewItemView; owner: boolean; suppliers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState(item.name);
  const [size, setSize] = useState(item.size ?? "");
  const [category, setCategory] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [qty, setQty] = useState(fmt(item.qty));
  const [same, setSame] = useState("");
  const [err, setErr] = useState("");
  const [busy, start] = useTransition();
  const n = Number(qty.replace(",", "."));
  const okQty = Number.isFinite(n) && n > 0 && n <= 9999;
  const run = (f: () => Promise<{ ok: true } | { ok: false; error: string }>) => start(async () => {
    setErr("");
    const r = await f();
    if (!r.ok) { setErr(r.error); return; }
    router.refresh();
  });
  const head = (
    <div className="stock-row-head">
      <span className="stock-qty">{fmt(item.qty)}</span>
      <span className="grow stack" style={{ gap: 2, minWidth: 0 }}>
        <span className="strong">{item.size ? `${item.name} · ${item.size}` : item.name}</span>
        <span className="muted" style={{ fontSize: 13 }}>For {item.site}{item.by ? ` · asked by ${item.by}` : ""}</span>
      </span>
      <span className="chip warn">Not in the catalogue</span>
    </div>
  );
  if (!owner) {
    return <div className="stock-row">{head}{item.note && <div style={{ fontSize: 14 }}>&ldquo;{item.note}&rdquo;</div>}</div>;
  }
  return (
    <div className="stock-row">
      {head}
      {item.note && <div style={{ fontSize: 14 }}>&ldquo;{item.note}&rdquo;</div>}
      {item.like.length > 0 && (
        <div className="stock-site">
          <span className="muted">Already in the catalogue?</span>
          <select className="txt" style={{ width: "auto", maxWidth: "100%" }} aria-label="Same as" value={same} onChange={(e) => setSame(e.target.value)}>
            <option value="">No, it&apos;s new</option>
            {item.like.map((p) => <option key={p.id} value={p.id}>Yes: {p.label}</option>)}
          </select>
        </div>
      )}
      {!same && (
        <div className="row wrap" style={{ gap: 8 }}>
          <input className="txt" aria-label="Name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} style={{ width: 220 }} />
          <input className="txt" aria-label="Pack or size" maxLength={40} placeholder="Pack or size" value={size} onChange={(e) => setSize(e.target.value)} style={{ width: 150 }} />
          <input className="txt" aria-label="Category" maxLength={40} placeholder="Category" list="stock-categories" value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: 150 }} />
          <select className="txt" aria-label="Bought from" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} style={{ width: 190 }}>
            <option value="">Bought from…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}
      <div className="row wrap" style={{ gap: 8 }}>
        <span className="muted">How many</span>
        <input className="txt" aria-label="How many" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: 84, textAlign: "center" }} />
        <button type="button" className="btn small" disabled={busy || !okQty || (!same && (!supplierId || name.trim().length < 2))}
          onClick={() => run(() => addNewStockItem(item.id, same ? { productId: same, qty: n } : { name, size: size || undefined, category: category || undefined, supplierId, qty: n }))}>
          {same ? "Order it" : "Add to catalogue and order"}
        </button>
        <button type="button" className="btn ghost small" disabled={busy} onClick={() => run(() => dismissNewStockItem(item.id, "Not needed"))}>Not needed</button>
      </div>
      {err && <div className="err" role="alert">{err}</div>}
    </div>
  );
}
