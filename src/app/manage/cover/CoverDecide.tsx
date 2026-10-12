"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideCover } from "@/app/actions";

/** Approve one of the offers, or decline the request with a note. */
export function CoverDecide({ id, name, offers }: { id: string; name: string; offers: { personId: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const send = (input: object) => start(async () => {
    setErr("");
    const r = await decideCover({ requestId: id, ...input });
    if (!r.ok) { setErr(r.error); return; }
    router.refresh();
  });
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row wrap" style={{ gap: 6 }}>
        {offers.map((o) => (
          <button key={o.personId} type="button" className="btn accent small" disabled={pending}
            onClick={() => { if (confirm(`${o.name} covers ${name}'s shift? Then move it in the rota sheet.`)) send({ decision: "approved", coveredBy: o.personId }); }}>
            Approve {o.name}
          </button>
        ))}
        {!declining && <button type="button" className="btn ghost small" disabled={pending} onClick={() => setDeclining(true)}>Decline</button>}
      </div>
      {declining && (
        <form className="stack" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); send({ decision: "declined", note: note || undefined }); }}>
          <label className="stack" style={{ gap: 4 }}><span className="muted">Note for {name} (optional)</span>
            <textarea id={`decline-${id}`} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn ghost small" onClick={() => setDeclining(false)}>Cancel</button>
            <button type="submit" className="btn bad small" disabled={pending}>Decline request</button>
          </div>
        </form>
      )}
      {err && <div className="err" role="alert">{err}</div>}
    </div>
  );
}
