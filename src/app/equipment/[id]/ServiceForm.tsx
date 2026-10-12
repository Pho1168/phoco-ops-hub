"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { logService } from "@/app/actions";

/** Managers log a service visit: the date and what was done. */
export function ServiceForm({ equipmentId, today }: { equipmentId: string; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [doneOn, setDoneOn] = useState(today);
  const [body, setBody] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const save = () => start(async () => {
    setErr(""); setMsg("");
    const r = await logService(equipmentId, { doneOn, body });
    if (!r.ok) { setErr(r.error); return; }
    setOpen(false); setBody(""); setMsg("Service logged.");
    router.refresh();
  });
  if (!open) return (
    <div className="row wrap" style={{ gap: 8 }}>
      <button type="button" className="btn ghost small" onClick={() => { setOpen(true); setMsg(""); }}>Log a service</button>
      {msg && <span className="chip done">{msg}</span>}
    </div>
  );
  return (
    <form className="stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); save(); }}>
      <label className="stack" style={{ gap: 4 }}><span className="muted">Date of the service</span>
        <input id="svc-date" className="txt" type="date" max={today} value={doneOn} onChange={(e) => setDoneOn(e.target.value)} required /></label>
      <input id="svc-body" className="txt wide" style={{ maxWidth: "none" }} maxLength={500} placeholder="Who serviced it and what was done" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Service note" />
      {err && <div className="err" role="alert">{err}</div>}
      <div className="row">
        <button type="button" className="btn ghost" onClick={() => { setOpen(false); setErr(""); }}>Cancel</button>
        <button className="btn grow" type="submit" disabled={pending}>{pending ? "Saving…" : "Save service"}</button>
      </div>
    </form>
  );
}
