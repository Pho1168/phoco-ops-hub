"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { prepSetDone } from "@/app/actions";
import { canUndo } from "@/lib/domain/prep";

export interface ReportEntry {
  id: string; itemId: string; name: string; category: string; urgent: boolean; note?: string; carried: boolean;
  completedAt?: number; completedByName?: string;
}

const hm = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

/** Outstanding items as tiles: one tap marks one done and it moves to the Done list (kept, with who and when). */
export function ReportItems({ handoverId, outstanding, completed, canAct }: { handoverId: string; outstanding: ReportEntry[]; completed: ReportEntry[]; canAct: boolean }) {
  const router = useRouter();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");
  const [, start] = useTransition();
  const now = Date.now();

  const set = (e: ReportEntry, done: boolean) => {
    setErr("");
    if (done) setHidden((h) => new Set(h).add(e.id));
    start(async () => {
      const r = await prepSetDone(handoverId, e.id, done);
      if (!r.ok) { setErr(r.error); setHidden((h) => { const n = new Set(h); n.delete(e.id); return n; }); }
      router.refresh();
    });
  };
  const open = outstanding.filter((e) => !hidden.has(e.id));

  return (
    <>
      {err && <div className="err" role="alert">{err}</div>}
      {open.length === 0
        ? <div className="alert good"><div className="strong">All done. Nothing outstanding.</div></div>
        : (
          <ul className="prep-report" aria-label="Outstanding prep">
            {open.map((e) => (
              <li key={e.id} className={e.urgent ? "urgent" : ""}>
                <div className="grow">
                  <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    {e.urgent && <span className="chip bad">Urgent</span>}
                    {e.carried && <span className="chip warn">Carried over</span>}
                    <span className="muted">{e.category}</span>
                  </div>
                  <div className="prep-name">{e.name}</div>
                  {e.note && <div className="prep-note">{e.note}</div>}
                </div>
                {canAct && <button type="button" className="btn small" onClick={() => set(e, true)} aria-label={`Mark ${e.name} done`}>Done</button>}
              </li>
            ))}
          </ul>
        )}
      {completed.length > 0 && (
        <details className="card" open={completed.some((e) => canUndo(e.completedAt, now))}>
          <summary className="strong" style={{ cursor: "pointer" }}>Done ({completed.length})</summary>
          <div className="log" style={{ marginTop: 8 }}>
            {completed.map((e) => (
              <div key={e.id} style={{ alignItems: "center" }}>
                <time>{e.completedAt ? hm(e.completedAt) : ""}</time>
                <span className="grow">{e.name} <span className="muted">· {e.completedByName}</span></span>
                {canAct && canUndo(e.completedAt, now) && <button type="button" className="btn ghost small" onClick={() => set(e, false)}>Undo</button>}
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
