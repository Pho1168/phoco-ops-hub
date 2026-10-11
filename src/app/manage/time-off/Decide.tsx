"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideTimeOff } from "@/app/actions";

/** Approve or decline, with an optional note the person sees. */
export function Decide({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const go = (d: "approved" | "declined") => start(async () => {
    setErr("");
    const r = await decideTimeOff(id, d, note);
    if (!r.ok) setErr(r.error);
    router.refresh();
  });
  return (
    <div className="stack" style={{ gap: 8 }}>
      <input className="txt wide" style={{ maxWidth: "none" }} maxLength={300} placeholder={`Note for ${name} (optional)`} value={note} onChange={(e) => setNote(e.target.value)} aria-label={`Note for ${name}`} />
      {err && <div className="err" role="alert">{err}</div>}
      <div className="row">
        <button type="button" className="btn ghost grow" disabled={pending} onClick={() => go("declined")}>Decline</button>
        <button type="button" className="btn accent grow" disabled={pending} onClick={() => go("approved")}>Approve</button>
      </div>
    </div>
  );
}
