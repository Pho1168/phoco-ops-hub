"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendShiftRemindersNow } from "@/app/actions";
import { TeamToday } from "@/components/TeamToday";
import type { TeamRowView } from "@/lib/team-today";

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** The owner's master button: today's team at every site, and "Send reminders now". */
export function RemindersCard({ rows, active, pushOn, missing }: { rows: TeamRowView[]; active: number; pushOn: number; missing: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const toSend = rows.filter((r) => r.toRemind).length;
  const sites = Array.from(new Set(rows.map((r) => r.site)));

  const send = () => {
    if (!confirm(`Send ${n(toSend, "shift reminder")} now?`)) return;
    start(async () => {
      setErr(""); setMsg("");
      const r = await sendShiftRemindersNow();
      if (!r.ok) { setErr(r.error); return; }
      const sent = r.sent ?? 0, phones = r.phones ?? 0;
      setMsg(!sent ? "Nothing to send: everyone starting later today has had their reminder."
        : `Sent ${n(sent, "reminder")}. ${phones ? `${n(phones, "phone")} notified.` : "Nobody they went to has notifications on yet, so they're waiting in the app under My shifts."}`);
      router.refresh();
    });
  };

  return (
    <section className="card stack" aria-label="Shift reminders">
      <div className="row wrap">
        <h2 className="h-sec grow">Shift reminders</h2>
        <span className={`chip ${pushOn < active ? "warn" : "done"}`}>Notifications on: {pushOn} of {active}</span>
      </div>
      <p className="muted" style={{ margin: 0 }}>Each shift gets a reminder 2 hours before it starts, with what&apos;s waiting from handover. Staff reply On my way, Running late or Can&apos;t make it, and managers hear about late ones straight away.</p>
      {missing.length > 0 && (
        <details>
          <summary className="muted" style={{ cursor: "pointer" }}>{missing.length === 1 ? "1 person hasn't" : `${missing.length} people haven't`} turned notifications on</summary>
          <div className="muted" style={{ marginTop: 6 }}>{missing.join(", ")}. On their own phone: sign in with their staff ID, then tap Turn on under My shifts. iPhones need Share → Add to Home Screen first, then open the app from the home screen.</div>
        </details>
      )}
      {sites.map((site) => (
        <div key={site} className="stack" style={{ gap: 0 }}>
          <div className="strong" style={{ marginTop: 6 }}>{site} today</div>
          <TeamToday rows={rows.filter((r) => r.site === site)} />
        </div>
      ))}
      {!rows.length && <div className="muted">Nobody is on a published rota today.</div>}
      <div className="row wrap" style={{ gap: 10 }}>
        <button type="button" className="btn accent" disabled={pending || !toSend} onClick={send}>Send reminders now{toSend ? ` (${toSend})` : ""}</button>
        <span className="muted grow">{toSend
          ? `Sends now to everyone starting later today who hasn't had theirs. Nobody gets two for the same shift.`
          : rows.some((r) => !r.started) ? "Everyone starting later today has had their reminder." : "No more shifts start today."}</span>
      </div>
      {msg && <div className="alert good" role="status">{msg}</div>}
      {err && <div className="err" role="alert">{err}</div>}
    </section>
  );
}
