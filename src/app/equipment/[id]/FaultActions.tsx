"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateFault } from "@/app/actions";

/** Add an update to a problem ("engineer booked for Tuesday") or mark it fixed, saying what was done. */
export function FaultActions({ equipmentId, faultId }: { equipmentId: string; faultId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const go = (fixed: boolean) => start(async () => {
    setErr("");
    if (!body.trim()) { setErr(fixed ? "Say what was done to fix it" : "Write the update first"); return; }
    const r = await updateFault(equipmentId, faultId, { body, fixed });
    if (!r.ok) { setErr(r.error); return; }
    setBody("");
    router.refresh();
  });
  return (
    <div className="stack" style={{ gap: 8 }}>
      <input className="txt wide" style={{ maxWidth: "none" }} maxLength={500} placeholder="Update, or what fixed it" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Update or fix" />
      {err && <div className="err" role="alert">{err}</div>}
      <div className="row">
        <button type="button" className="btn ghost grow" disabled={pending} onClick={() => go(false)}>Add update</button>
        <button type="button" className="btn grow" disabled={pending} onClick={() => go(true)}>Mark fixed</button>
      </div>
    </div>
  );
}
