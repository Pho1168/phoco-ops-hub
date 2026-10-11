"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reportFault } from "@/app/actions";

/** Report a problem: not working at all, or working but needing attention. Managers are told straight away. */
export function ReportFault({ equipmentId, name, hint }: { equipmentId: string; name: string; hint?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [severity, setSeverity] = useState<"down" | "attention" | null>(null);
  const [body, setBody] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const send = () => start(async () => {
    setErr(""); setMsg("");
    if (!severity) { setErr("Is it working or not?"); return; }
    const r = await reportFault(equipmentId, { severity, body });
    if (!r.ok) { setErr(r.error); return; }
    setOpen(false); setSeverity(null); setBody("");
    setMsg("Reported. The managers have been told.");
    router.refresh();
  });

  if (!open) return (
    <div className="stack" style={{ gap: 8 }}>
      {msg && <div className="alert good" role="status"><div className="strong" style={{ fontSize: 14 }}>{msg}</div></div>}
      <button type="button" className="btn accent" onClick={() => { setOpen(true); setMsg(""); }}>Report a problem with {name}</button>
    </div>
  );
  return (
    <form className="card stack" aria-label="Report a problem" onSubmit={(e) => { e.preventDefault(); send(); }}>
      <h2 className="h-sec">Report a problem</h2>
      <div className="seg" role="group" aria-label="Is it working?">
        <button type="button" aria-pressed={severity === "down"} onClick={() => setSeverity("down")}>Not working</button>
        <button type="button" aria-pressed={severity === "attention"} onClick={() => setSeverity("attention")}>Working, needs attention</button>
      </div>
      {severity === "down" && hint && <div className="alert" style={{ padding: "10px 12px" }}><div style={{ fontSize: 14 }}>{hint}</div></div>}
      <textarea id="fault-body" className="txt wide" style={{ maxWidth: "none", height: 90, padding: 10 }} maxLength={500} placeholder="What's wrong? e.g. not cooling, display shows E4, door seal torn"
        value={body} onChange={(e) => setBody(e.target.value)} aria-label="What's wrong" />
      {err && <div className="err" role="alert">{err}</div>}
      <div className="row">
        <button type="button" className="btn ghost" onClick={() => { setOpen(false); setErr(""); }}>Cancel</button>
        <button className="btn accent grow" type="submit" disabled={pending}>{pending ? "Sending…" : "Send"}</button>
      </div>
    </form>
  );
}
