"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveAlert } from "@/app/actions";

/** Resolve an alert from the task centre, saying what was done. */
export function ResolveAlert({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  if (!open) return <div><button type="button" className="btn small" onClick={() => setOpen(true)}>Resolve</button></div>;
  return (
    <form className="stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); start(async () => {
      setErr("");
      const r = await resolveAlert(id, note);
      if (!r.ok) { setErr(r.error); return; }
      setOpen(false); router.refresh();
    }); }}>
      <input className="txt wide" style={{ maxWidth: "none" }} maxLength={500} placeholder="What was done, e.g. food moved, fridge back to 4°C" value={note} onChange={(e) => setNote(e.target.value)} aria-label="What was done" autoFocus />
      {err && <div className="err" role="alert">{err}</div>}
      <div className="row">
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn grow" type="submit" disabled={pending}>{pending ? "Saving…" : "Resolve"}</button>
      </div>
    </form>
  );
}
