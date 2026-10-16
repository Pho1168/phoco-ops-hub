"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { addStockPrice, saveStockProduct, saveStockSupplier, setPurchaserAction, setStockReminderAction } from "@/app/actions";
import { METHODS, type Product, type Supplier } from "@/lib/domain/stock";

type P = Product & { price?: string };
type Tab = "products" | "suppliers" | "people";

/** Suppliers, products, prices and purchasers, all in one place for the owner. Every change is logged. */
export function CatalogueEditor({ suppliers, products, productionSites, sites, people, today }: {
  suppliers: Supplier[]; products: P[]; productionSites: { id: string; name: string }[]; sites: { id: string; name: string; reminder: boolean }[];
  people: { id: string; name: string; owner: boolean; on: boolean }[]; today: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("products");
  const [q, setQ] = useState("");
  const [sup, setSup] = useState("");
  const [edit, setEdit] = useState<string | undefined>();
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => start(async () => {
    setErr(""); setMsg("");
    const r = await fn();
    if (!r.ok) { setErr(r.error ?? "Something went wrong"); return; }
    setMsg(done); setEdit(undefined); router.refresh();
  });
  const supName = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);
  const shown = products.filter((p) => (!q || `${p.name} ${p.size ?? ""} ${p.category ?? ""}`.toLowerCase().includes(q.toLowerCase())) && (!sup || (p.supplierId ?? "none") === sup));

  return (
    <main className="wide stack">
      <div className="seg" role="group" aria-label="Show">
        <button type="button" aria-pressed={tab === "products"} onClick={() => setTab("products")}>Products ({products.length})</button>
        <button type="button" aria-pressed={tab === "suppliers"} onClick={() => setTab("suppliers")}>Suppliers ({suppliers.length})</button>
        <button type="button" aria-pressed={tab === "people"} onClick={() => setTab("people")}>Purchasers and sites</button>
      </div>
      {err && <div className="err" role="alert">{err}</div>}
      {msg && <div className="alert good" role="status">{msg}</div>}

      {tab === "products" && (
        <>
          <div className="stock-filter">
            <input className="txt grow" type="search" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
            <select value={sup} onChange={(e) => setSup(e.target.value)} aria-label="Supplier"><option value="">Every supplier</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}<option value="none">No supplier</option></select>
            <button type="button" className="btn accent small" onClick={() => setEdit("new")}>Add product</button>
          </div>
          {edit === "new" && <ProductForm suppliers={suppliers} pending={pending} onCancel={() => setEdit(undefined)} onSave={(v) => run(() => saveStockProduct(undefined, v), `${v.name} added`)} />}
          <div className="stock-list">
            {shown.map((p) => edit === p.id
              ? <ProductForm key={p.id} p={p} suppliers={suppliers} pending={pending} today={today} onCancel={() => setEdit(undefined)} onSave={(v) => run(() => saveStockProduct(p.id, v), `${v.name} saved`)}
                  onPrice={(v) => run(() => addStockPrice(p.id, v), "Price added")} />
              : (
                <button key={p.id} type="button" className="stock-line" style={{ textAlign: "left", border: 0, cursor: "pointer", font: "inherit", opacity: p.active ? 1 : .55 }} onClick={() => setEdit(p.id)}>
                  <span className="row wrap" style={{ gap: 8 }}>
                    <span className="strong grow">{p.name}{p.size ? ` · ${p.size}` : ""}</span>
                    {!p.active && <span className="chip">Off</span>}
                    <span className="chip">{p.supplierId ? supName.get(p.supplierId) : "No supplier"}</span>
                    {(p.alsoFrom ?? []).length > 0 && <span className="chip">also {(p.alsoFrom ?? []).map((id) => supName.get(id)).filter(Boolean).join(", ")}</span>}
                  </span>
                  <span className="muted" style={{ fontSize: 13 }}>{p.category ?? "No category"} · {p.price ?? "no price"}{p.importName && p.importName !== p.name ? ` · from the sheet as "${p.importName}"` : ""}</span>
                </button>
              ))}
          </div>
        </>
      )}

      {tab === "suppliers" && (
        <>
          <button type="button" className="btn accent small" style={{ alignSelf: "flex-start" }} onClick={() => setEdit("new-sup")}>Add supplier</button>
          {edit === "new-sup" && <SupplierForm productionSites={productionSites} pending={pending} onCancel={() => setEdit(undefined)} onSave={(v) => run(() => saveStockSupplier(undefined, v), `${v.name} added`)} />}
          <div className="stock-list">
            {suppliers.map((s) => edit === s.id
              ? <SupplierForm key={s.id} s={s} productionSites={productionSites} pending={pending} onCancel={() => setEdit(undefined)} onSave={(v) => run(() => saveStockSupplier(s.id, v), `${v.name} saved`)} />
              : (
                <button key={s.id} type="button" className="stock-line" style={{ textAlign: "left", border: 0, cursor: "pointer", font: "inherit", opacity: s.active ? 1 : .55 }} onClick={() => setEdit(s.id)}>
                  <span className="row wrap" style={{ gap: 8 }}><span className="strong grow">{s.name}</span>{!s.active && <span className="chip">Off</span>}<span className="chip">{METHODS.find((m) => m.id === s.method)?.label}</span></span>
                  <span className="muted" style={{ fontSize: 13 }}>{products.filter((p) => p.supplierId === s.id).length} products{s.note ? ` · ${s.note}` : ""}</span>
                </button>
              ))}
          </div>
        </>
      )}

      {tab === "people" && (
        <div className="cols two">
          <section className="card stack" aria-label="Purchasers">
            <h2 className="h-sec">Who can be given purchasing work</h2>
            <p className="muted lead" style={{ margin: 0 }}>They appear in Assign driver and Assign buyer. Owners always do.</p>
            {people.map((p) => (
              <label key={p.id} className="row" style={{ gap: 10 }}>
                <input type="checkbox" checked={p.on || p.owner} disabled={p.owner || pending} onChange={(e) => run(() => setPurchaserAction(p.id, e.target.checked), `${p.name} ${e.target.checked ? "added" : "taken off"}`)} style={{ width: 22, height: 22 }} />
                <span className="grow">{p.name}</span>{p.owner && <span className="chip done">Owner</span>}
              </label>
            ))}
          </section>
          <section className="card stack" aria-label="Sites">
            <h2 className="h-sec">Ask closers for a stock report</h2>
            <p className="muted lead" style={{ margin: 0 }}>Shown in Shift Mode to whoever is closing, until someone at the site sends today&apos;s report.</p>
            {sites.map((s) => (
              <label key={s.id} className="row" style={{ gap: 10 }}>
                <input type="checkbox" checked={s.reminder} disabled={pending} onChange={(e) => run(() => setStockReminderAction(s.id, e.target.checked), `${s.name}: ${e.target.checked ? "closers are asked" : "no reminder"}`)} style={{ width: 22, height: 22 }} />
                <span className="grow">{s.name}</span>
              </label>
            ))}
          </section>
        </div>
      )}
    </main>
  );
}

function ProductForm({ p, suppliers, pending, today, onSave, onCancel, onPrice }: {
  p?: P; suppliers: Supplier[]; pending: boolean; today?: string;
  onSave: (v: { name: string; size?: string; category?: string; supplierId?: string; link?: string; active: boolean; alsoFrom: string[] }) => void; onCancel: () => void;
  onPrice?: (v: { pounds: string; on: string; note?: string }) => void;
}) {
  const [v, setV] = useState({ name: p?.name ?? "", size: p?.size ?? "", category: p?.category ?? "", supplierId: p?.supplierId ?? "", link: p?.link ?? "", active: p?.active ?? true, alsoFrom: p?.alsoFrom ?? [] });
  // Other shops that can sell it: any active supplier but a production kitchen and the preferred one.
  const others = suppliers.filter((s) => s.active && s.method !== "production" && s.id !== v.supplierId);
  const [price, setPrice] = useState({ pounds: "", on: today ?? "", note: "" });
  return (
    <form className="card stack" onSubmit={(e) => { e.preventDefault(); onSave({ ...v, size: v.size || undefined, category: v.category || undefined, supplierId: v.supplierId || undefined, link: v.link || undefined, alsoFrom: v.alsoFrom.filter((id) => id !== v.supplierId) }); }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <input className="txt grow" maxLength={80} placeholder="Name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} aria-label="Name" required />
        <input className="txt" maxLength={40} placeholder="Size, e.g. Case x 14" value={v.size} onChange={(e) => setV({ ...v, size: e.target.value })} aria-label="Size" />
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <input className="txt" maxLength={40} placeholder="Category" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} aria-label="Category" />
        <select className="txt grow" value={v.supplierId} onChange={(e) => setV({ ...v, supplierId: e.target.value })} aria-label="Preferred supplier">
          <option value="">No supplier</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      {others.length > 0 && (
        <fieldset className="stack" style={{ gap: 6, border: 0, padding: 0, margin: 0 }}>
          <legend className="strong" style={{ fontSize: 14, marginBottom: 4 }}>Also sold at (optional)</legend>
          <div className="row wrap" style={{ gap: 6 }}>
            {others.map((s) => {
              const on = v.alsoFrom.includes(s.id);
              return <button key={s.id} type="button" className={`chip ${on ? "done" : ""}`} aria-pressed={on}
                onClick={() => setV({ ...v, alsoFrom: on ? v.alsoFrom.filter((x) => x !== s.id) : [...v.alsoFrom, s.id] })}>{on ? "✓ " : ""}{s.name}</button>;
            })}
          </div>
          <span className="muted" style={{ fontSize: 13 }}>Stock needed can move it to one of these before a shop run, and drivers can tick it as bought there.</span>
        </fieldset>
      )}
      <input className="txt" maxLength={300} placeholder="Product page (https://…, optional)" value={v.link} onChange={(e) => setV({ ...v, link: e.target.value })} aria-label="Product page" />
      <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} style={{ width: 22, height: 22 }} /><span>On the list (staff can report it)</span></label>
      <div className="muted" style={{ fontSize: 13 }}>Changing the supplier changes new requests only; requests already sent keep theirs (change those on the request).</div>
      <div className="row" style={{ gap: 8 }}><button type="submit" className="btn small" disabled={pending}>Save</button><button type="button" className="btn ghost small" onClick={onCancel}>Cancel</button></div>
      {onPrice && (
        <div className="stack" style={{ gap: 6, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
          <span className="strong">Add a reference price {p?.price ? `(now ${p.price})` : "(none yet)"}</span>
          <div className="row wrap" style={{ gap: 8 }}>
            <label className="row" style={{ gap: 4 }}><span>£</span><input className="txt" inputMode="decimal" placeholder="0.00" value={price.pounds} onChange={(e) => setPrice({ ...price, pounds: e.target.value })} style={{ width: 100 }} aria-label="Price ex VAT" /></label>
            <input className="txt" type="date" value={price.on} onChange={(e) => setPrice({ ...price, on: e.target.value })} aria-label="Price date" />
            <input className="txt grow" maxLength={120} placeholder="Note, e.g. ex VAT, 12 x 725ml" value={price.note} onChange={(e) => setPrice({ ...price, note: e.target.value })} aria-label="Price note" />
            <button type="button" className="btn ghost small" disabled={pending || !price.pounds} onClick={() => onPrice(price)}>Add price</button>
          </div>
        </div>
      )}
    </form>
  );
}

function SupplierForm({ s, productionSites, pending, onSave, onCancel }: {
  s?: Supplier; productionSites: { id: string; name: string }[]; pending: boolean;
  onSave: (v: { name: string; method: string; note?: string; link?: string; siteId?: string; active: boolean }) => void; onCancel: () => void;
}) {
  const [v, setV] = useState({ name: s?.name ?? "", method: s?.method ?? "shop", note: s?.note ?? "", link: s?.link ?? "", siteId: s?.siteId ?? "", active: s?.active ?? true });
  return (
    <form className="card stack" onSubmit={(e) => { e.preventDefault(); onSave({ ...v, note: v.note || undefined, link: v.link || undefined, siteId: v.method === "production" ? v.siteId || undefined : undefined }); }}>
      <input className="txt" maxLength={60} placeholder="Supplier name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} aria-label="Supplier name" required />
      <div className="seg" role="group" aria-label="How it's bought">
        {METHODS.map((m) => <button key={m.id} type="button" aria-pressed={v.method === m.id} onClick={() => setV({ ...v, method: m.id })}>{m.label}</button>)}
      </div>
      {v.method === "production" && (
        <select className="txt" value={v.siteId} onChange={(e) => setV({ ...v, siteId: e.target.value })} aria-label="Production kitchen">
          <option value="">Which production kitchen?</option>{productionSites.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      )}
      <input className="txt" maxLength={300} placeholder="Minimum order, delivery charge, cut-off (optional)" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} aria-label="Note" />
      <input className="txt" maxLength={300} placeholder="Website (https://…, optional)" value={v.link} onChange={(e) => setV({ ...v, link: e.target.value })} aria-label="Website" />
      <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} style={{ width: 22, height: 22 }} /><span>In use</span></label>
      <div className="row" style={{ gap: 8 }}><button type="submit" className="btn small" disabled={pending}>Save</button><button type="button" className="btn ghost small" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}
