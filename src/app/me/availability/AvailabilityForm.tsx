"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveAvailability } from "@/app/actions";
import { AVAIL_LABEL, AVAIL_NOTE_MAX, AVAILS, type Avail, type AvailDay } from "@/lib/domain/availability";

/** Seven days, four taps each (all day, morning, evening, off) and an optional note, then Send. */
export function AvailabilityForm({ week, days, current }: { week: string; days: { date: string; label: string }[]; current?: AvailDay[] }) {
  const router = useRouter();
  const [vals, setVals] = useState<{ a?: Avail; note: string; open: boolean }[]>(() =>
    days.map((_, i) => ({ a: current?.[i]?.a, note: current?.[i]?.note ?? "", open: !!current?.[i]?.note })));
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [busy, start] = useTransition();
  const set = (i: number, patch: Partial<(typeof vals)[number]>) => { setMsg(undefined); setVals((v) => v.map((x, j) => (j === i ? { ...x, ...patch } : x))); };
  const missing = vals.filter((v) => !v.a).length;

  const send = () => start(async () => {
    const r = await saveAvailability(week, vals.map((v) => ({ a: v.a ?? "", note: v.note || undefined })));
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
    setMsg({ ok: true, text: "Sent. Your manager sees it on the rota page. You can change it any time before the week starts." });
    router.refresh();
  });

  return (
    <section className="stack" aria-label="Your availability" style={{ gap: 8 }}>
      <div className="row wrap" style={{ gap: 6 }}>
        <span className="muted" style={{ fontSize: 14 }}>Same every day:</span>
        {AVAILS.map((a) => <button key={a} type="button" className="chip" onClick={() => { setMsg(undefined); setVals((v) => v.map((x) => ({ ...x, a }))); }}>{AVAIL_LABEL[a]}</button>)}
      </div>
      {days.map((d, i) => (
        <div key={d.date} className={`card stack avail-day${vals[i].a ? ` is-${vals[i].a}` : ""}`} style={{ gap: 8 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="strong grow">{d.label}</span>
            {!vals[i].open && <button type="button" className="btn ghost small" onClick={() => set(i, { open: true })}>Add note</button>}
          </div>
          <div className="avail-opts" role="radiogroup" aria-label={`${d.label}: when can you work`}>
            {AVAILS.map((a) => (
              <button key={a} type="button" role="radio" aria-checked={vals[i].a === a} className={`avail-opt ${a}${vals[i].a === a ? " on" : ""}`} onClick={() => set(i, { a })}>{AVAIL_LABEL[a]}</button>
            ))}
          </div>
          {vals[i].open && (
            <input className="txt" style={{ width: "100%", maxWidth: "none" }} maxLength={AVAIL_NOTE_MAX} placeholder="Note (optional), e.g. from 12:00 only"
              aria-label={`Note for ${d.label}`} value={vals[i].note} onChange={(e) => set(i, { note: e.target.value })} />
          )}
        </div>
      ))}
      <div className="avail-bar">
        <span className="grow strong">{missing ? `${missing} day${missing === 1 ? "" : "s"} still to answer` : "Every day answered"}</span>
        <button type="button" className="btn" disabled={busy || missing > 0} onClick={send}>{busy ? "Sending…" : current ? "Send changes" : "Send"}</button>
      </div>
      {msg && <div className={msg.ok ? "alert good" : "err"} role={msg.ok ? "status" : "alert"}>{msg.text}</div>}
    </section>
  );
}
