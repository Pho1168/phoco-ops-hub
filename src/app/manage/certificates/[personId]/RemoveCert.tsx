"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeCertificate } from "@/app/actions";

/** For a record added by mistake. Asks once more, and it's kept in the database marked removed. */
export function RemoveCert({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [ask, setAsk] = useState(false);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const go = () => start(async () => {
    const r = await removeCertificate(id);
    if (!r.ok) { setErr(r.error); return; }
    setAsk(false);
    router.refresh();
  });
  if (!ask) return <button type="button" className="btn ghost small" onClick={() => setAsk(true)} aria-label={`Remove this ${label} record`}>Remove</button>;
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      <span className="muted" style={{ fontSize: 13 }}>Added by mistake?</span>
      <button type="button" className="btn ghost small" onClick={() => setAsk(false)}>Keep</button>
      <button type="button" className="btn small" style={{ background: "var(--bad)", color: "var(--bad-ink-on)" }} disabled={pending} onClick={go}>Remove</button>
      {err && <div className="err" role="alert">{err}</div>}
    </div>
  );
}
