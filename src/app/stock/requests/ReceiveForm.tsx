"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { receiveStock } from "@/app/actions";

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));

/** Confirms what arrived: all of it in one tap, or how many (and why fewer). */
export function ReceiveForm({ requestId, expected }: { requestId: string; expected: number }) {
  const router = useRouter();
  const [qty, setQty] = useState(fmt(expected));
  const [note, setNote] = useState("");
  const [some, setSome] = useState(false);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const go = (n: number) => start(async () => {
    setErr("");
    const r = await receiveStock(requestId, n, note.trim() || undefined);
    if (!r.ok) setErr(r.error); else router.refresh();
  });
  return (
    <div className="stack" style={{ gap: 8 }}>
      {!some ? (
        <div className="row wrap" style={{ gap: 8 }}>
          <button type="button" className="btn accent grow" disabled={pending} onClick={() => go(expected)}>{pending ? "Saving…" : `All ${fmt(expected)} arrived`}</button>
          <button type="button" className="btn ghost" onClick={() => setSome(true)}>Fewer arrived</button>
        </div>
      ) : (
        <form className="row wrap" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); go(Number(qty.replace(",", "."))); }}>
          <label className="row" style={{ gap: 6 }}><span>Arrived</span><input className="txt" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: 80 }} aria-label="How many arrived" /></label>
          <input className="txt grow" maxLength={200} placeholder="Why fewer? e.g. one bucket damaged" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
          <button type="submit" className="btn small" disabled={pending}>Confirm</button>
          <button type="button" className="btn ghost small" onClick={() => setSome(false)}>Cancel</button>
        </form>
      )}
      {err && <div className="err" role="alert">{err}</div>}
    </div>
  );
}
