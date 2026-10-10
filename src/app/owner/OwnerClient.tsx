"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closeSite, logOutEverywhere, reopenSite, resolveAlert, setFrozen, switchSite } from "@/app/actions";
import { Icon } from "@/components/Icon";

export interface SiteSummary {
  id: string; name: string; closed: boolean; reason?: string; lists: number; signed: number; overdue: number;
  alerts: { id: string; title: string; detail: string; critical: boolean }[];
}
export interface PersonRow { id: string; name: string; code: string; status: string; self: boolean; sites: string }

type Modal = { type: "close"; site: SiteSummary } | { type: "resolve"; id: string } | null;

export function OwnerClient({ sites, people, log, currentSite, devices, rota }: { sites: SiteSummary[]; people: PersonRow[]; log: { at: string; site: string; who: string; action: string; detail: string }[]; currentSite: string; devices: React.ReactNode; rota: React.ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [modal, setModal] = useState<Modal>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string } | void>, done?: string) => start(async () => {
    setErr("");
    const r = await fn();
    if (r && !r.ok) { setErr(r.error ?? "Something went wrong"); return; }
    setModal(null);
    if (done) setMsg(done);
    router.refresh();
  });

  return (
    <main>
      <div><div className="eyebrow">All sites · owner control</div><h1 className="h-display">Group overview</h1></div>
      {msg && <div className="alert good" role="status"><Icon name="check" /><div className="grow">{msg}</div></div>}

      <div className="grid2">
        {sites.map((s) => (
          <section key={s.id} className="card stack" aria-label={s.name}>
            <div className="row"><h2 className="h-sec grow">{s.name}</h2><span className={`chip ${s.closed ? "bad" : "done"}`}>{s.closed ? "Closed · sign-in frozen" : "Open"}</span></div>
            {s.closed && s.reason && <div className="muted">{s.reason}</div>}
            <div className="row wrap" style={{ gap: 22 }}>
              <div><div className="stat">{s.signed}/{s.lists}</div><div className="muted">signed off</div></div>
              <div><div className="stat" style={{ color: s.overdue ? "var(--accent)" : undefined }}>{s.overdue}</div><div className="muted">overdue</div></div>
              <div><div className="stat" style={{ color: s.alerts.length ? "var(--bad)" : undefined }}>{s.alerts.length}</div><div className="muted">open alerts</div></div>
            </div>
            {s.alerts.map((a) => (
              <div key={a.id} className={`alert ${a.critical ? "bad" : ""}`} style={{ padding: "10px 12px" }}>
                <Icon name="alert" />
                <div className="grow"><div className="strong" style={{ fontSize: 14 }}>{a.title}</div><div style={{ fontSize: 12 }}>{a.detail}</div></div>
                <button type="button" className="btn ghost small" onClick={() => { setErr(""); setModal({ type: "resolve", id: a.id }); }}>Resolve</button>
              </div>
            ))}
            {!s.closed && s.id !== currentSite && <button type="button" className="btn ghost" disabled={pending} onClick={() => start(() => switchSite(s.id))}>Work at {s.name}</button>}
            {s.closed
              ? <button type="button" className="btn" disabled={pending} onClick={() => run(() => reopenSite(s.id), `${s.name} reopened`)}>Reopen {s.name}</button>
              : <button type="button" className="btn bad" onClick={() => { setErr(""); setModal({ type: "close", site: s }); }}>Close site · log everyone out</button>}
          </section>
        ))}
      </div>

      <section className="card stack" aria-label="Accounts">
        <div className="row"><h2 className="h-sec grow">Staff accounts</h2><Link className="btn accent small" href="/staff/new">Add person</Link></div>
        <ul className="accounts">
          {people.map((p) => (
            <li key={p.id}>
              <div className="grow">
                <div className="strong">{p.name}{p.self ? " (you)" : ""}</div>
                <div className="muted">{p.code} · {p.sites}</div>
              </div>
              <span className={`chip ${p.status === "active" ? "done" : p.status === "left" ? "" : "bad"}`}>{p.status === "active" ? "Active" : p.status === "left" ? "Left" : "Frozen"}</span>
              <span className="acct-actions">
                <Link className="btn ghost small" href={`/staff/${p.id}`}>Edit</Link>
              {!p.self && p.status !== "left" && (
                <>
                  <button type="button" className="btn ghost small" disabled={pending} onClick={() => run(() => logOutEverywhere(p.id), `${p.name} logged out on all devices`)}>Log out</button>
                  {p.status === "active"
                    ? <button type="button" className="btn bad small" disabled={pending} onClick={() => run(() => setFrozen(p.id, true), `${p.name} frozen`)}>Freeze</button>
                    : <button type="button" className="btn small" disabled={pending} onClick={() => run(() => setFrozen(p.id, false), `${p.name} unfrozen`)}>Unfreeze</button>}
                </>
              )}
              </span>
            </li>
          ))}
        </ul>
        {err && !modal && <div className="err" role="alert">{err}</div>}
      </section>

      {rota}

      {devices}

      <section className="card stack" aria-label="Activity">
        <h2 className="h-sec">Activity</h2>
        <div className="log">
          {log.length === 0 && <div className="muted">Nothing yet today.</div>}
          {log.map((x, i) => <div key={i}><time>{x.at}</time><span><strong>{x.site}</strong> {x.who && <>{x.who} · </>}{x.detail}</span></div>)}
        </div>
      </section>

      {modal?.type === "close" && <CloseSiteModal site={modal.site} err={err} pending={pending} onCancel={() => setModal(null)}
        onConfirm={(name, reason) => run(() => closeSite(modal.site.id, name, reason), `${modal.site.name} closed. Staff there are logged out and frozen`)} />}
      {modal?.type === "resolve" && <ResolveModal err={err} pending={pending} onCancel={() => setModal(null)} onConfirm={(note) => run(() => resolveAlert(modal.id, note), "Alert resolved")} />}
      <div className="foot-links"><Link href="/me">My shifts</Link><Link href="/pin">Change my PIN</Link></div>
    </main>
  );
}

function CloseSiteModal({ site, err, pending, onCancel, onConfirm }: { site: SiteSummary; err: string; pending: boolean; onCancel: () => void; onConfirm: (name: string, reason: string) => void }) {
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  return (
    <div className="modal-back">
      <form className="modal" role="dialog" aria-label={`Close ${site.name}`} onSubmit={(e) => { e.preventDefault(); onConfirm(name, reason); }}>
        <h2 className="h-sec">Close {site.name}?</h2>
        <p style={{ margin: 0 }}>Everyone working only at {site.name} is logged out and frozen. People who also work at another site keep that access. Records are kept, and you can reopen at any time.</p>
        <label className="stack" style={{ gap: 6 }}><span className="muted">Type <strong>{site.name}</strong> to confirm</span>
          <input id="close-name" className="txt" style={{ width: "100%", maxWidth: "none" }} autoFocus required autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="stack" style={{ gap: 6 }}><span className="muted">Reason</span>
          <input id="close-reason" className="txt" style={{ width: "100%", maxWidth: "none" }} required placeholder="e.g. closed for refit" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        {err && <div className="err" role="alert">{err}</div>}
        <div className="row"><button type="button" className="btn ghost" onClick={onCancel}>Cancel</button><button className="btn bad grow" type="submit" disabled={pending}>Close site</button></div>
      </form>
    </div>
  );
}

function ResolveModal({ err, pending, onCancel, onConfirm }: { err: string; pending: boolean; onCancel: () => void; onConfirm: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <div className="modal-back">
      <form className="modal" role="dialog" aria-label="Resolve alert" onSubmit={(e) => { e.preventDefault(); onConfirm(note); }}>
        <h2 className="h-sec">Resolve alert</h2>
        <label className="stack" style={{ gap: 6 }}><span className="muted">What was done? (required)</span>
          <textarea id="res-note" autoFocus required value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {err && <div className="err" role="alert">{err}</div>}
        <div className="row"><button type="button" className="btn ghost" onClick={onCancel}>Cancel</button><button className="btn grow" type="submit" disabled={pending}>Resolve</button></div>
      </form>
    </div>
  );
}
