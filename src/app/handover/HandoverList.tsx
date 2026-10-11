"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { prepSetDone, setNoteDone } from "@/app/actions";
import { canUndo } from "@/lib/domain/prep";

/** One thing on the handover: a prep item or a note. */
export interface Tile {
  kind: "prep" | "note"; id: string; title: string; label: string;
  urgent: boolean; info?: boolean; carried?: boolean; detail?: string; meta?: string;
  completedAt?: number; completedByName?: string;
}

const hm = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

/**
 * Outstanding prep items and notes as tiles. One tap marks one done and it moves to the Done list (kept, with who
 * and when). For-info notes have nothing to tick. Undo is possible for a few minutes after a tap.
 */
export function HandoverList({ handoverId, open, done, canAct }: { handoverId?: string; open: Tile[]; done: Tile[]; canAct: boolean }) {
  const router = useRouter();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");
  const [, start] = useTransition();
  const now = Date.now();

  const set = (t: Tile, isDone: boolean) => {
    setErr("");
    if (isDone) setHidden((h) => new Set(h).add(t.id));
    start(async () => {
      const r = t.kind === "prep" ? await prepSetDone(handoverId ?? "", t.id, isDone) : await setNoteDone(t.id, isDone);
      if (!r.ok) { setErr(r.error); setHidden((h) => { const n = new Set(h); n.delete(t.id); return n; }); }
      router.refresh();
    });
  };
  const shown = open.filter((t) => !hidden.has(t.id));

  return (
    <>
      {err && <div className="err" role="alert">{err}</div>}
      {shown.length === 0
        ? <div className="alert good"><div className="strong">All clear. Nothing outstanding.</div></div>
        : (
          <ul className="prep-report" aria-label="Outstanding">
            {shown.map((t) => (
              <li key={t.id} className={`${t.urgent ? "urgent" : ""}${t.info ? " info" : ""}`}>
                <div className="grow">
                  <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    {t.urgent && <span className="chip bad">Urgent</span>}
                    {t.carried && <span className="chip warn">Carried over</span>}
                    {t.info && <span className="chip">For info</span>}
                    <span className="muted">{t.label}</span>
                  </div>
                  <div className={t.kind === "note" ? "note-body" : "prep-name"}>{t.title}</div>
                  {t.detail && <div className="prep-note">{t.detail}</div>}
                  {t.meta && <div className="prep-note">{t.meta}</div>}
                </div>
                {canAct && !t.info && <button type="button" className="btn small" onClick={() => set(t, true)} aria-label={`Mark ${t.title} done`}>Done</button>}
              </li>
            ))}
          </ul>
        )}
      {done.length > 0 && (
        <details className="card" open={done.some((t) => canUndo(t.completedAt, now))}>
          <summary className="strong" style={{ cursor: "pointer" }}>Done ({done.length})</summary>
          <div className="log" style={{ marginTop: 8 }}>
            {done.map((t) => (
              <div key={t.id} style={{ alignItems: "center" }}>
                <time>{t.completedAt ? hm(t.completedAt) : ""}</time>
                <span className="grow">{t.title} <span className="muted">· {t.completedByName}</span></span>
                {canAct && canUndo(t.completedAt, now) && <button type="button" className="btn ghost small" onClick={() => set(t, false)}>Undo</button>}
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
