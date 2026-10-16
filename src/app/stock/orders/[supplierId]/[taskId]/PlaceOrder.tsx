"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { recordStockTask } from "@/app/actions";

/**
 * Sending the order (nothing goes to the supplier by itself): copy, WhatsApp, email or print, then "Order placed"
 * with their reference. Once placed, who and when.
 */
export function PlaceOrder({ taskId, supplierName, text, subject, canPlace, placed }: {
  taskId: string; supplierName: string; text: string; subject: string; canPlace: boolean; placed?: { by?: string; at: string; ref?: string };
}) {
  const router = useRouter();
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { setErr("Couldn't copy here: select the text and copy it"); }
  };
  const place = () => start(async () => {
    setErr("");
    const r = await recordStockTask(taskId, { kind: "ordered", allBought: true, ref: ref.trim() || undefined });
    if (!r.ok) { setErr(r.error); return; }
    if (note.trim()) await recordStockTask(taskId, { kind: "note", text: note.trim() });
    router.refresh();
  });

  return (
    <div className="stack no-print" style={{ gap: 12 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <button type="button" className="btn" onClick={copy}>{copied ? "Copied" : "Copy text"}</button>
        <a className="btn ghost" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">Open in WhatsApp</a>
        <a className="btn ghost" href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`}>Email</a>
        <button type="button" className="btn ghost" onClick={() => window.print()}>Print / PDF</button>
      </div>
      <span className="muted">The app never sends anything to {supplierName}. You send it, then mark it placed.</span>
      {placed ? (
        <div className="sup-count done">
          <span className="sup-dot" aria-hidden>✓</span>
          <span className="grow"><b>Placed</b> {placed.at}{placed.by ? ` by ${placed.by}` : ""}{placed.ref ? ` · their ref ${placed.ref}` : ""}</span>
        </div>
      ) : canPlace ? (
        <div className="stack" style={{ gap: 10, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <h3 className="grp-h">Mark as placed</h3>
          <label className="stack" style={{ gap: 6 }}>
            <span className="strong">{supplierName}&apos;s order reference (optional)</span>
            <input className="txt" style={{ width: "100%" }} maxLength={80} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="their order number" />
          </label>
          <label className="stack" style={{ gap: 6 }}>
            <span className="strong">Note (optional)</span>
            <input className="txt" style={{ width: "100%" }} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. rang them, brisket confirmed" />
          </label>
          {err && <div className="err" role="alert">{err}</div>}
          <button type="button" className="btn accent" disabled={pending} onClick={place} style={{ alignSelf: "flex-start" }}>{pending ? "Saving…" : "Order placed"}</button>
        </div>
      ) : null}
      {err && placed && <div className="err" role="alert">{err}</div>}
    </div>
  );
}
