"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { clearAlerts } from "@/app/actions";

/**
 * One button to clear every open alert (at one site, or at all of a manager's sites). Two taps, so it can't happen
 * by accident. The alerts are kept in the records, resolved with "Cleared by <name>".
 */
export function ClearAlerts({ siteId, count }: { siteId?: string; count: number }) {
  const router = useRouter();
  const [sure, setSure] = useState(false);
  const [err, setErr] = useState("");
  const [busy, start] = useTransition();
  if (count < 1) return null;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <button type="button" className={`btn small ${sure ? "" : "ghost"}`} disabled={busy} onClick={() => {
          if (!sure) { setSure(true); return; }
          start(async () => {
            setErr("");
            const r = await clearAlerts(siteId);
            setSure(false);
            if (!r.ok) setErr(r.error);
            router.refresh();
          });
        }}>{busy ? "Clearing…" : sure ? `Tap again to clear ${count}` : `Clear all ${count} alert${count === 1 ? "" : "s"}`}</button>
        {sure && !busy && <button type="button" className="btn ghost small" onClick={() => setSure(false)}>Cancel</button>}
      </div>
      {err && <div className="err" role="alert">{err}</div>}
    </div>
  );
}
