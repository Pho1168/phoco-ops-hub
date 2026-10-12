"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { askCover, withdrawCover } from "@/app/actions";

/** My latest cover request for a shift. "none": nothing in play (withdrawn, or the rota changed), so I can ask. */
export interface MyCover { id: string; state: "open" | "approved" | "done" | "declined" | "cancelled" | "none"; offers: number; coveredByName?: string; note?: string }

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
  const wrap = { whiteSpace: "normal" } as const;

  if (cover && (cover.state === "open" || cover.state === "approved" || cover.state === "done")) {
    return (
      <div className="stack" style={{ gap: 6, marginTop: 8 }}>
        <div className="row wrap" style={{ gap: 6 }}>
          {cover.state === "open" && <span className="chip warn" style={wrap}>Asking for cover · {cover.offers ? `${cover.offers} offer${cover.offers > 1 ? "s" : ""}, waiting for your manager` : "no offers yet"}</span>}
          {cover.state === "approved" && <span className="chip done" style={wrap}>Covered by {cover.coveredByName} · the rota will be updated</span>}
          {cover.state === "done" && <span className="chip done" style={wrap}>Covered by {cover.coveredByName}</span>}
          {cover.state === "open" && <button type="button" className="btn ghost small" disabled={pending} onClick={() => { if (confirm("Take back your request for cover?")) run(() => withdrawCover(cover.id)); }}>Withdraw request</button>}
        </div>
        {err && <div className="err" role="alert">{err}</div>}
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 6, marginTop: 8 }}>
      {(cover?.state === "declined" || cover?.state === "cancelled") && (
        <div className="stack" style={{ gap: 2 }}>
          <div><span className="chip bad" style={wrap}>{cover.state === "declined" ? "Cover not approved" : "Cover cancelled: this shift is yours again"}</span></div>
          {cover.note && <div className="muted" style={{ whiteSpace: "pre-wrap" }}>&ldquo;{cover.note}&rdquo;</div>}
        </div>
      )}
      {!open && <div><button type="button" className="btn ghost small" onClick={() => setOpen(true)}>Ask for cover</button></div>}
      {open && (
        <form className="stack" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); run(() => askCover(shiftId, note)); }}>
          <span className="muted">Colleagues in your section who aren&apos;t working then are asked, and your manager decides. Until then the shift is still yours.</span>
          <label className="stack" style={{ gap: 4 }}>
            <span className="muted">Reason, for your manager only (optional)</span>
            <textarea id={`cover-note-${shiftId}`} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
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
