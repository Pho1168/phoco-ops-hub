"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelTask, completeTask, reopenTask } from "@/app/actions";

/** Tick a task done (with an optional note), and for managers take it off. */
export function TaskDone({ id, title, canCancel = false }: { id: string; title: string; canCancel?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => {
    setErr("");
    const r = await fn();
    if (!r.ok) { setErr(r.error ?? "That didn't work"); return; }
    setOpen(false); router.refresh();
  });

  if (!open) return (
    <div className="row wrap" style={{ gap: 8 }}>
      <button type="button" className="btn small" onClick={() => setOpen(true)} aria-label={`Done: ${title}`}>Done</button>
      {canCancel && <button type="button" className="btn ghost small" disabled={pending} onClick={() => { if (confirm("Take this task off? It's kept as cancelled.")) run(() => cancelTask(id)); }}>Take off</button>}
      {err && <span className="err" role="alert">{err}</span>}
    </div>
  );
  return (
    <form className="stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); run(() => completeTask(id, note)); }}>
      <input className="txt wide" style={{ maxWidth: "none" }} maxLength={300} placeholder="Note (optional), e.g. done, filters soaked overnight" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" autoFocus />
      {err && <div className="err" role="alert">{err}</div>}
      <div className="row">
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn grow" type="submit" disabled={pending}>{pending ? "Saving…" : "Mark done"}</button>
      </div>
    </form>
  );
}

/** Put back a task ticked by mistake (the person who ticked it, within 10 minutes). */
export function UndoTask({ id }: { id: string }) {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  return (
    <span className="row" style={{ gap: 6 }}>
      <button type="button" className="btn ghost small" disabled={pending} onClick={() => start(async () => {
        const r = await reopenTask(id);
        if (!r.ok) setErr(r.error); else router.refresh();
      })}>Undo</button>
      {err && <span className="err" role="alert">{err}</span>}
    </span>
  );
}
