"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cleaningAction } from "@/app/actions";
import type { BoardRow } from "@/lib/cleaning-service";

/**
 * The cleaning board: the weekly and monthly jobs that are done on no fixed day. What still needs doing stays at the
 * top for everyone (amber late in the week, orange on the last day); done jobs fold away. On the tablet anyone can
 * say "I'll do it", let go, or tick it done; elsewhere it's read-only.
 */
export function CleaningBoard({ site, rows, canAct, compact = false }: { site: string; rows: BoardRow[]; canAct: boolean; compact?: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState("");
  const open = rows.filter((r) => !r.complete);
  const done = rows.filter((r) => r.complete);
  const late = open.filter((r) => r.urgency === "late").length;
  const act = (id: string, action: "claimed" | "released" | "done") => start(async () => {
    setErr("");
    const r = await cleaningAction(id, action);
    if (!r.ok) setErr(r.error);
    router.refresh();
  });
  if (!rows.length) return null;
  return (
    <section className={`card stack clean-board${compact ? " compact" : ""}`} aria-label={`Cleaning at ${site}`} style={{ gap: 10 }}>
      <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
        <h2 className="h-sec grow" style={{ margin: 0 }}>Weekly cleaning <span className="muted" style={{ fontSize: 14, fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>{site}</span></h2>
        {open.length > 0 ? <span className={`chip ${late ? "late" : "warn"}`}>{open.length} to do{late ? ` · ${late} due now` : ""}</span> : <span className="chip done">All done</span>}
      </div>
      {!compact && <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        No set day: take one this week with &ldquo;I&apos;ll do it&rdquo;, then tick it done{canAct ? "" : " on the tablet"}. Anything not done by the end of its week (or month) counts as missed, and the managers are told.
      </p>}
      {err && <div className="err" role="alert">{err}</div>}
      {open.map((r) => (
        <div key={r.id} className={`clean-row ${r.urgency}`}>
          <span className="clean-dot" aria-hidden="true" />
          <span className="grow stack" style={{ gap: 2, minWidth: 0 }}>
            <span className="strong">{r.name}</span>
            {compact
              ? <span className={`clean-status ${r.urgency}`}>{r.often} · {r.status}{r.urgency === "late" ? " · due now" : r.urgency === "soon" ? " · due soon" : ""}{r.missedLast ? " · missed last time" : ""}</span>
              : <>
                <span className="muted" style={{ fontSize: 13 }}>{r.area} · {r.often}{r.missedLast ? " · missed last time" : ""}</span>
                <span className={`clean-status ${r.urgency}`}>{r.status}{r.urgency === "late" ? " · due now" : r.urgency === "soon" ? " · due soon" : ""}</span>
              </>}
            {r.last && <span className="clean-last">{r.last}</span>}
          </span>
          {canAct && (
            <span className="row wrap clean-btns" style={{ gap: 6 }}>
              {r.mine
                ? <button type="button" className="btn ghost small" disabled={busy} onClick={() => act(r.id, "released")}>Let go</button>
                : <button type="button" className="btn ghost small" disabled={busy} onClick={() => act(r.id, "claimed")}>I&apos;ll do it</button>}
              <button type="button" className="btn small" disabled={busy} onClick={() => act(r.id, "done")}>Done</button>
            </span>
          )}
        </div>
      ))}
      {done.length > 0 && (
        <details>
          <summary className="muted" style={{ cursor: "pointer", fontSize: 14 }}>Done for now ({done.length})</summary>
          <div className="stack" style={{ gap: 6, marginTop: 8 }}>
            {done.map((r) => (
              <div key={r.id} className="clean-row ok done">
                <span className="clean-dot" aria-hidden="true" />
                <span className="grow stack" style={{ gap: 2, minWidth: 0 }}>
                  <span className="strong">{r.name}</span>
                  <span className="muted" style={{ fontSize: 13 }}>{r.area} · {r.often} · {r.status}</span>
                  {r.last && <span className="clean-last">{r.last}</span>}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
