"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { changeStockRequestAction } from "@/app/actions";

/** The owner's controls on a request: set the quantity, change the supplier, cancel (each with the log keeping why). */
export function RequestControls({ requestId, wanted, suppliers, supplierId, canSupplier, canCancel }: {
  requestId: string; wanted?: number; suppliers: { id: string; name: string }[]; supplierId?: string; canSupplier: boolean; canCancel: boolean;
}) {
  const router = useRouter();
  const [qty, setQty] = useState(wanted !== undefined ? String(wanted) : "");
  const [sup, setSup] = useState(supplierId ?? "");
  const [why, setWhy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const run = (c: Parameters<typeof changeStockRequestAction>[1], done: string) => start(async () => {
    setErr(""); setMsg("");
    const r = await changeStockRequestAction(requestId, c);
    if (!r.ok) setErr(r.error); else { setMsg(done); router.refresh(); }
  });
  return (
    <section className="card stack" aria-label="Owner">
      <h2 className="h-sec">Change it</h2>
      <form className="row wrap" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); run({ qty: Number(qty.replace(",", ".")) }, "Quantity set"); }}>
        <label className="row" style={{ gap: 8 }}><span className="strong">Quantity</span><input className="txt" inputMode="decimal" value={qty} placeholder="?" onChange={(e) => setQty(e.target.value)} style={{ width: 90 }} /></label>
        <button type="submit" className="btn small" disabled={pending || !qty.trim() || Number(qty) === wanted}>Set</button>
      </form>
      <form className="row wrap" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); run({ supplierId: sup || null }, "Supplier changed"); }}>
        <label className="row wrap" style={{ gap: 8 }}><span className="strong">Supplier</span>
          <select value={sup} disabled={!canSupplier} onChange={(e) => setSup(e.target.value)} className="txt" style={{ minWidth: 200 }}>
            <option value="">No supplier</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
        <button type="submit" className="btn small" disabled={pending || !canSupplier || sup === (supplierId ?? "")}>Change</button>
        {!canSupplier && <span className="muted" style={{ fontSize: 13, flexBasis: "100%" }}>Part of it is assigned or bought: take it off the task first.</span>}
      </form>
      {canCancel && (
        <form className="row wrap" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); run({ cancel: why }, "Cancelled"); }}>
          <input className="txt grow" maxLength={200} placeholder="Why cancel? e.g. not needed after all" value={why} onChange={(e) => setWhy(e.target.value)} aria-label="Reason" />
          <button type="submit" className="btn bad small" disabled={pending || !why.trim()}>Cancel request</button>
        </form>
      )}
      {err && <div className="err" role="alert">{err}</div>}
      {msg && <div className="alert good" role="status">{msg}</div>}
    </section>
  );
}
