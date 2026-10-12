"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { askCover, withdrawCover } from "@/app/actions";

export interface MyCover { id: string; state: "open" | "approved" | "done" | "declined"; offers: number; coveredByName?: string; decisionNote?: string }

/** Under one of my upcoming shifts: ask for cover, or see how the request is going. */
export function CoverAsk({ shiftId, cover }: { shiftId: string; cover?: MyCover }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => {
    setErr("");
    const r = await fn();
    if (!r.ok) { setErr(r.error ?? "That didn't work"); return; }
    setOpen(false); setNote("");
    router.refresh();
  });

  if (cover && cover.state !== "declined") {
    return (
      <div className="stack" style={{ gap: 6, marginTop: 8 }}>
        <div className="row wrap" style={{ gap: 6 }}>
          {cover.state === "open" && <span className="chip warn" style={{ whiteSpace: "normal" }}>Asking for cover · {cover.offers ? `${cover.offers} offer${cover.offers > 1 ? "s" : ""}, waiting for your manager` : "no offers yet"}</span>}
          {cover.state === "approved" && <span className="chip done" style={{ whiteSpace: "normal" }}>Covered by {cover.coveredByName} · the rota will be updated</span>}
          {cover.state === "done" && <span className="chip done">Covered by {cover.coveredByName}</span>}
          {cover.state === "open" && <button type="button" className="btn ghost small" disabled={pending} onClick={() => { if (confirm("Take back your request for cover?")) run(() => withdrawCover(cover.id)); }}>Withdraw request</button>}
        </div>
        {err && <div className="err" role="alert">{err}</div>}
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 6, marginTop: 8 }}>
      {cover?.state === "declined" && (
        <div className="stack" style={{ gap: 2 }}>
          <div><span className="chip bad">Cover not approved</span></div>
          {cover.decisionNote && <div className="muted" style={{ whiteSpace: "pre-wrap" }}>&ldquo;{cover.decisionNote}&rdquo;</div>}
        </div>
      )}
      {!open && <div><button type="button" className="btn ghost small" onClick={() => setOpen(true)}>Ask for cover</button></div>}
      {open && (
        <form className="stack" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); run(() => askCover(shiftId, note)); }}>
          <label className="stack" style={{ gap: 4 }}>
            <span className="muted">Colleagues in your section who aren&apos;t working then are asked, and your manager decides. Until then the shift is still yours.</span>
            <textarea id={`cover-note-${shiftId}`} maxLength={200} placeholder="Anything they should know (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn ghost small" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn accent small" disabled={pending}>Send request</button>
          </div>
        </form>
      )}
      {err && <div className="err" role="alert">{err}</div>}
    </div>
  );
}
