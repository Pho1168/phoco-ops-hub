"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelCover } from "@/app/actions";

/** Cancel an approved cover (the person covering drops out, or plans change): the shift goes back to the person who asked. */
export function CoverCancel({ id, name, coverer }: { id: string; name: string; coverer: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  if (!open) return <div><button type="button" className="btn ghost small" onClick={() => setOpen(true)}>Cancel this cover</button></div>;
  return (
    <form className="stack" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); start(async () => {
      setErr("");
      const r = await cancelCover(id, note);
      if (!r.ok) { setErr(r.error); return; }
      router.refresh();
    }); }}>
      <label className="stack" style={{ gap: 4 }}><span className="muted">The shift goes back to {name}, and {coverer} is told they&apos;re not covering it. Note (optional)</span>
        <textarea id={`cancel-${id}`} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className="btn ghost small" onClick={() => setOpen(false)}>Keep it</button>
        <button type="submit" className="btn bad small" disabled={pending}>Cancel cover</button>
      </div>
      {err && <div className="err" role="alert">{err}</div>}
    </form>
  );
}
