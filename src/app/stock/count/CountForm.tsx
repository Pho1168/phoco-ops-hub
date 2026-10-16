"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { sendProductionCountNow, sendSupplierCountNow } from "@/app/actions";

interface P { id: string; name: string; size?: string; category?: string }
type Kept = { values: Record<string, string>; note: string };

const OTHER = "Other";
const parse = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));

function load(key: string): Kept | undefined {
  try { const raw = sessionStorage.getItem(key); return raw ? (JSON.parse(raw) as Kept) : undefined; } catch { return undefined; }
}
function keep(key: string, k: Kept) {
  try { sessionStorage.setItem(key, JSON.stringify(k)); } catch { /* storage blocked: the count stays on screen until it's sent */ }
}
function forget(key: string) {
  try { sessionStorage.removeItem(key); } catch { /* nothing kept */ }
}

/**
 * The count: every item the kitchen sends out, grouped as in the catalogue, a number for each in its own unit (0 when
 * there's none). A blank line wasn't counted. Kept in this tab while it's being done, sent once.
 */
export function CountForm({ storeKey, siteName, products, last, canPlan, supplier }: { storeKey: string; siteName: string; products: P[]; last?: string; canPlan: boolean;
  /** A supplier's products on an order day (otherwise the kitchen's production list). */
  supplier?: { id: string; name: string; canOrder: boolean } }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [restored, setRestored] = useState(false);
  const [confirmGaps, setConfirmGaps] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState<{ make: number; below: number; counted: number; of: number } | undefined>();
  const [pending, start] = useTransition();
  const ready = useRef(false);

  // Picked up again after a reload or a slip of the finger, in this tab only.
  useEffect(() => {
    const k = load(storeKey);
    if (k && Object.keys(k.values).length) { setValues(k.values); setNote(k.note ?? ""); setRestored(true); }
    ready.current = true;
  }, [storeKey]);
  useEffect(() => { if (ready.current && !sent) keep(storeKey, { values, note }); }, [values, note, storeKey, sent]);

  const groups = useMemo(() => {
    const out: { name: string; items: P[] }[] = [];
    for (const p of products) {
      const name = p.category ?? OTHER;
      let g = out.find((x) => x.name === name);
      if (!g) { g = { name, items: [] }; out.push(g); }
      g.items.push(p);
    }
    return out;
  }, [products]);

  const counted = products.filter((p) => parse(values[p.id]) !== null).length;
  const gaps = products.length - counted;
  const set = (id: string, v: string) => { setValues((x) => ({ ...x, [id]: v })); setConfirmGaps(false); setErr(""); };
  const step = (id: string, d: number) => {
    const n = parse(values[id]);
    set(id, fmt(Math.max(0, n === null ? (d > 0 ? 1 : 0) : Math.round((n + d) * 100) / 100)));
  };

  const send = () => {
    setErr("");
    if (!counted) { setErr("Count at least one item. Put 0 for anything that has run out"); return; }
    const bad = products.find((p) => values[p.id]?.trim() && parse(values[p.id]) === null);
    if (bad) { setErr(`${bad.name}: put a number from 0, or leave it blank if you didn't count it`); return; }
    if (gaps && !confirmGaps) { setConfirmGaps(true); return; }
    start(async () => {
      const input = { lines: products.map((p) => ({ productId: p.id, qty: parse(values[p.id]) })), note: note.trim() || undefined };
      if (supplier) {
        const r = await sendSupplierCountNow(supplier.id, input);
        if (!r.ok) { setErr(r.error); return; }
        forget(storeKey);
        setSent({ make: r.toOrder ?? 0, below: 0, counted: r.counted ?? counted, of: r.of ?? products.length });
      } else {
        const r = await sendProductionCountNow(input);
        if (!r.ok) { setErr(r.error); return; }
        forget(storeKey);
        setSent({ make: r.make ?? 0, below: r.below ?? 0, counted: r.counted ?? counted, of: r.of ?? products.length });
      }
      window.scrollTo({ top: 0 });
    });
  };

  if (sent) {
    return (
      <main className="stack">
        <div className="card stack" style={{ gap: 10 }} role="status">
          <div className="strong" style={{ fontSize: 20 }}>Count sent</div>
          {supplier ? (
            <>
              <div>{sent.counted} of {sent.of} {supplier.name} items counted at {siteName}. {sent.make ? `${sent.make} product${sent.make === 1 ? "" : "s"} suggested to order` : "Nothing suggested to order"}.</div>
              <div className="muted">Whoever orders from {supplier.name} has been told.</div>
            </>
          ) : (
            <>
              <div>{sent.counted} of {sent.of} items counted at {siteName}. {sent.make ? `${sent.make} item${sent.make === 1 ? "" : "s"} to make` : "Nothing to make"}{sent.below ? `, ${sent.below} below target` : ""}.</div>
              <div className="muted">Whoever plans the day has been told.</div>
            </>
          )}
          <div className="row wrap" style={{ gap: 8 }}>
            {supplier?.canOrder && <Link className="btn" href={`/stock/orders/${supplier.id}`}>See the order</Link>}
            {!supplier && canPlan && <Link className="btn" href="/stock/plan">See the plan</Link>}
            <Link className="btn ghost" href="/stock">Back to Stock</Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <>
      <main className="stack" style={{ paddingBottom: 120 }}>
        <div className="card stack" style={{ gap: 6 }}>
          <div>Count what&apos;s on the shelf now, in each item&apos;s own unit. Put <b>0</b> if there&apos;s none. Leave a line blank if you didn&apos;t count it.</div>
          {last && <div className="muted">{last}</div>}
          {restored && (
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="muted">Picked up where you left off.</span>
              <button type="button" className="btn ghost small" onClick={() => { setValues({}); setNote(""); setRestored(false); forget(storeKey); }}>Start again</button>
            </div>
          )}
        </div>
        {!products.length && <div className="card muted">Nothing to count yet: the catalogue has no products from this kitchen.</div>}
        {groups.map((g) => (
          <section key={g.name} className="stack" style={{ gap: 8 }} aria-label={g.name}>
            <h2 className="grp-h">{g.name} <span>{g.items.filter((p) => parse(values[p.id]) !== null).length} of {g.items.length}</span></h2>
            <div className="count-list">
              {g.items.map((p) => {
                const v = values[p.id] ?? "";
                const done = parse(v) !== null;
                return (
                  <div key={p.id} className={`count-row ${done ? "done" : ""}`}>
                    <span className="grow stack" style={{ gap: 2, minWidth: 140 }}>
                      <span className="strong">{p.name}</span>
                      <span className="muted" style={{ fontSize: 13 }}>{p.size ? `counted in ${p.size}` : "counted each"}</span>
                    </span>
                    <div className="stepper" role="group" aria-label={`${p.name}: how many on the shelf`}>
                      <button type="button" aria-label={`One less ${p.name}`} onClick={() => step(p.id, -1)}>−</button>
                      <input className="txt" inputMode="decimal" aria-label={`${p.name} on the shelf`} value={v} placeholder="" onChange={(e) => set(p.id, e.target.value)} />
                      <button type="button" aria-label={`One more ${p.name}`} onClick={() => step(p.id, 1)}>+</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {products.length > 0 && (
          <label className="stack" style={{ gap: 6 }}>
            <span className="strong">Note for the planners (optional)</span>
            <input className="txt" style={{ width: "100%" }} maxLength={300} placeholder="e.g. freezer 2 not counted, iced up" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        )}
      </main>
      {products.length > 0 && (
        <div className="sticky-foot">
          <div className="inner">
            <div className="prep-count" aria-live="polite"><b>{counted}</b><span>of {products.length}</span></div>
            <span className="grow" style={{ fontSize: 13 }}>
              {err ? <span className="err-text" role="alert">{err}</span> : confirmGaps ? <span className="muted">{gaps} not counted. Tap again to send anyway.</span> : <span className="muted">counted</span>}
            </span>
            <button type="button" className="btn accent" disabled={pending} onClick={send}>{pending ? "Sending…" : confirmGaps ? "Send anyway" : "Send count"}</button>
          </div>
        </div>
      )}
    </>
  );
}
