"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { clearNeededAction } from "@/app/actions";

/**
 * Clears Stock needed without ordering anything (for a test, or a list that's been dealt with another way). Asks once
 * more first. Everything cleared is kept in the history as cancelled.
 */
export function ClearNeeded({ count, brand }: { count: number; brand?: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, start] = useTransition();
  const clear = () => start(async () => {
    const r = await clearNeededAction(brand);
    setAsking(false);
    if (!r.ok) { setMsg(r.error); return; }
    setMsg(r.kept ? `Cleared. ${r.kept} partly bought item${r.kept === 1 ? " is" : "s are"} still on the list.` : "Cleared.");
    router.refresh();
  });
  return (
    <div className="card stack no-print" style={{ gap: 10 }}>
      {asking ? (
        <>
          <div className="strong">Clear all {count} item{count === 1 ? "" : "s"} from Stock needed?</div>
          <div className="muted" style={{ fontSize: 14 }}>Nothing is ordered. Lists given to drivers are taken back. The items stay in Stock history as cancelled, and the restaurants can ask again.</div>
          <div className="row wrap" style={{ gap: 8 }}>
            <button type="button" className="btn accent" disabled={busy} onClick={clear}>{busy ? "Clearing…" : "Yes, clear the list"}</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setAsking(false)}>Keep it</button>
          </div>
        </>
      ) : (
        <div className="row wrap" style={{ gap: 10, alignItems: "center" }}>
          <span className="muted grow" style={{ fontSize: 14 }}>Already dealt with, or just testing?</span>
          <button type="button" className="btn ghost small" onClick={() => { setMsg(""); setAsking(true); }}>Clear the whole list</button>
        </div>
      )}
      {msg && <div role="status" style={{ fontSize: 14 }}>{msg}</div>}
    </div>
  );
}
