"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelTimeOff, requestTimeOff } from "@/app/actions";
import { TIME_OFF_KINDS, type TimeOffKind } from "@/lib/domain/timeoff";

export interface MyTimeOff { id: string; range: string; kind: string; status: "pending" | "approved" | "declined" | "cancelled"; note?: string; decision?: string; canCancel: boolean }

const STATUS = { pending: ["Waiting", "warn"], approved: ["Approved", "done"], declined: ["Declined", "bad"], cancelled: ["Withdrawn", ""] } as const;

/** Ask for time off and see your requests. Whoever decides (`decider`: "your manager", or "the owner" for an operations manager) is told straight away. */
export function TimeOffCard({ requests, today, shiftDays, decider = "your manager" }: { requests: MyTimeOff[]; today: string; shiftDays: string[]; decider?: string }) {
  const Decider = decider.charAt(0).toUpperCase() + decider.slice(1);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [kind, setKind] = useState<TimeOffKind>("holiday");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const end = to || from;
  const onRota = from ? shiftDays.filter((d) => d >= from && d <= end).length : 0;

  const send = () => start(async () => {
    setErr(""); setMsg("");
    if (!from) { setErr("Choose the first day"); return; }
    const r = await requestTimeOff({ startsOn: from, endsOn: end, kind, note: note || undefined });
    if (!r.ok) { setErr(r.error); return; }
    setOpen(false); setFrom(""); setTo(""); setNote(""); setMsg(`Sent. ${Decider} has been told, and you'll get a message when they decide.`);
    router.refresh();
  });
  const withdraw = (id: string) => start(async () => {
    setErr(""); setMsg("");
    const r = await cancelTimeOff(id);
    if (!r.ok) setErr(r.error); else setMsg("Withdrawn.");
    router.refresh();
  });

  return (
    <section className="card stack" aria-label="Time off">
      <div className="row"><h2 className="h-sec grow">Time off</h2>{!open && <button type="button" className="btn small" onClick={() => { setOpen(true); setMsg(""); }}>Ask for time off</button>}</div>
      {open && (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <div className="row wrap" style={{ gap: 10 }}>
            <label className="stack" style={{ gap: 4 }}><span className="muted">First day</span><input id="to-from" className="txt" type="date" min={today} value={from} onChange={(e) => { setFrom(e.target.value); if (to && to < e.target.value) setTo(""); }} /></label>
            <label className="stack" style={{ gap: 4 }}><span className="muted">Last day</span><input id="to-to" className="txt" type="date" min={from || today} value={to} onChange={(e) => setTo(e.target.value)} placeholder="Same day" /></label>
          </div>
          <div className="seg" role="group" aria-label="Type">
            {TIME_OFF_KINDS.map((k) => <button key={k.id} type="button" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>{k.label.split(" (")[0]}</button>)}
          </div>
          <input className="txt wide" style={{ maxWidth: "none" }} maxLength={300} placeholder={`Note for ${decider} (optional)`} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
          {onRota > 0 && <div className="alert" style={{ padding: "10px 12px" }}><div style={{ fontSize: 14 }}>You&apos;re on the rota for {onRota} of these days. {Decider} will see that.</div></div>}
          {err && <div className="err" role="alert">{err}</div>}
          <div className="row"><button type="button" className="btn ghost" onClick={() => { setOpen(false); setErr(""); }}>Cancel</button><button className="btn accent grow" type="submit" disabled={pending}>{pending ? "Sending…" : "Send request"}</button></div>
        </form>
      )}
      {msg && <div className="alert good" role="status"><div className="strong" style={{ fontSize: 14 }}>{msg}</div></div>}
      {!open && err && <div className="err" role="alert">{err}</div>}
      {requests.length === 0 && !open && <div className="muted">No time off booked. Ask here and {decider} approves it in the app.</div>}
      {requests.map((r) => (
        <div key={r.id} className="row wrap timeoff-row" style={{ gap: 8 }}>
          <div className="grow">
            <div className="strong" style={{ fontSize: 15 }}>{r.range}</div>
            <div className="muted">{r.kind}{r.note ? ` · "${r.note}"` : ""}{r.decision ? ` · ${r.decision}` : ""}</div>
          </div>
          <span className={`chip ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span>
          {r.canCancel && <button type="button" className="btn ghost small" disabled={pending} onClick={() => { if (confirm("Withdraw this request?")) withdraw(r.id); }}>Withdraw</button>}
        </div>
      ))}
    </section>
  );
}
