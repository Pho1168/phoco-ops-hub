"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closeSite, createSite, logOutEverywhere, reopenSite, resolveAlert, setFrozen, setKitchenClose, switchSite } from "@/app/actions";
import { Icon } from "@/components/Icon";
import { ReadyLight } from "@/components/ReadyLight";
import type { Ready } from "@/lib/domain/daily";

export interface SiteSummary {
  id: string; name: string; closed: boolean; reason?: string; lists: number; signed: number; overdue: number;
  alerts: { id: string; title: string; detail: string; critical: boolean }[];
  /** Ready to open today (only on days with published shifts). */
  ready?: Ready;
  /** The gas check: due, not done, or done (now, or at the last close). */
  gas?: { text: string; tone: "good" | "bad" | "" };
  /** Kitchen closes ("21:30"): the gas check is due then. Unset: when the last shift ends. */
  gasBy?: string;
  /** The weekly cleaning board at a glance (`cleaningSummary`). */
  cleaning?: { text: string; tone: "good" | "bad" | "" };
}
/** `canEdit`: whoever is looking may change this account (an operations manager: staff and managers at their sites only). */
export interface PersonRow { id: string; name: string; code: string; status: string; self: boolean; sites: string; canEdit: boolean }

type Modal = { type: "close"; site: SiteSummary } | { type: "resolve"; id: string } | null;

/** The overview. `lead`: an owner (every site, closing and reopening) or an operations manager (the sites they run). */
export function OwnerClient({ lead, rightNow, needs, tools, reminders, sites, people, log, currentSite, devices, rota }: { lead: "owner" | "ops"; rightNow: React.ReactNode; needs: React.ReactNode; tools: React.ReactNode; reminders: React.ReactNode; sites: SiteSummary[]; people: PersonRow[]; log: { at: string; site: string; who: string; action: string; detail: string }[]; currentSite: string; devices: React.ReactNode; rota: React.ReactNode }) {
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
    <main className="wide">
      {msg && <div className="alert good" role="status"><Icon name="check" /><div className="grow">{msg}</div></div>}

      {rightNow}

      <div className="cols two">
      <div className="stack" style={{ gap: 16 }}>
      <section className="stack" aria-label="Sites" style={{ gap: 8 }}>
      <h2 className="grp-h">Sites <span>{sites.filter((s) => !s.closed).length} open</span></h2>
      <div className="grid2">
        {sites.map((s) => (
          <section key={s.id} className="card stack" aria-label={s.name}>
            <div className="row"><h2 className="h-sec grow">{s.name}</h2><span className={`chip ${s.closed ? "bad" : "done"}`}>{s.closed ? "Closed · sign-in frozen" : "Open"}</span></div>
            {s.closed && s.reason && <div className="muted">{s.reason}</div>}
            {s.ready && <ReadyLight r={s.ready} />}
            {s.cleaning && (
              <div className={`alert ${s.cleaning.tone}`} style={{ padding: "10px 12px" }}>
                <Icon name="check" /><div className="grow" style={{ fontSize: 14 }}>{s.cleaning.text}</div>
              </div>
            )}
            {s.gas && (
              <div className={`alert ${s.gas.tone}`} style={{ padding: "10px 12px" }}>
                <Icon name="flame" /><div className="grow" style={{ fontSize: 14 }}>{s.gas.text}</div>
              </div>
            )}
            {lead === "owner" && !s.closed && <KitchenClose site={s} pending={pending} save={(v) => run(() => setKitchenClose(s.id, v), v ? `${s.name}: the kitchen closes at ${v}` : `${s.name}: the gas check follows the last shift again`)} />}
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
            {lead === "owner" && (s.closed
              ? <button type="button" className="btn" disabled={pending} onClick={() => run(() => reopenSite(s.id), `${s.name} reopened`)}>Reopen {s.name}</button>
              : <button type="button" className="btn bad" onClick={() => { setErr(""); setModal({ type: "close", site: s }); }}>Close site · log everyone out</button>)}
          </section>
        ))}
      </div>
      {lead === "owner" && <AddSite pending={pending} add={(v) => run(() => createSite(v), `${v.name} added. Give people access to it from their accounts.`)} />}
      </section>

      <section className="stack panel nude" aria-label="Needs you" style={{ gap: 8 }}>
        <h2 className="grp-h">Needs you <span>decisions and what&apos;s waiting at your sites</span></h2>
        {needs}
      </section>

      {tools}

      <section className="card stack" aria-label="Accounts" id="accounts">
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
              {p.canEdit && <Link className="btn ghost small" href={`/staff/${p.id}`}>Edit</Link>}
              {p.canEdit && !p.self && p.status !== "left" && (
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
        {lead === "ops" && <div className="muted">You can change staff and manager accounts at your sites. The owner changes owner and operations manager accounts, and anyone who also works at another site.</div>}
        {err && !modal && <div className="err" role="alert">{err}</div>}
      </section>

      {rota}

      {devices}

      <section className="card stack" aria-label="Activity" id="activity">
        <h2 className="h-sec">Activity</h2>
        <div className="log">
          {log.length === 0 && <div className="muted">Nothing yet today.</div>}
          {log.map((x, i) => <div key={i}><time>{x.at}</time><span><strong>{x.site}</strong> {x.who && <>{x.who} · </>}{x.detail}</span></div>)}
        </div>
      </section>
      </div>

      <aside className="aside panel">
        {reminders}
        <Link href="/manage/report" className="card stack" style={{ gap: 6, textDecoration: "none" }}>
          <div className="row"><span className="h-sec grow" style={{ fontSize: 17 }}>Weekly report</span><Icon name="report" /></div>
          <div className="muted">Checks, temperatures, handovers and hours per site. Monday&apos;s message goes to you and the managers at 06:00.</div>
        </Link>
        <div className="card stack" style={{ gap: 8 }}>
          <div className="eyebrow" style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, fontSize: 12 }}>{lead === "owner" ? "Owner only" : "On this screen"}</div>
          <div className="row wrap" style={{ gap: 6 }}>
            <a className="chip" href="#accounts">People &amp; access</a>
            <a className="chip" href="#rota-sheets">Rota sheets</a>
            <a className="chip" href="#tablets">Site tablets</a>
            <a className="chip" href="#activity">Activity log</a>
            {lead === "owner" && <Link className="chip" href="/manage/checklists">Checklists</Link>}
            {lead === "owner" && <Link className="chip" href="/manage/certificates">Right to work</Link>}
          </div>
        </div>
      </aside>
      </div>

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

/** The owner sets when the kitchen closes: the gas check is due then, for everyone still on shift. */
function KitchenClose({ site, pending, save }: { site: SiteSummary; pending: boolean; save: (v: string) => void }) {
  const [v, setV] = useState(site.gasBy ?? "");
  return (
    <form className="row wrap" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); save(v); }}>
      <label className="row" style={{ gap: 8 }} htmlFor={`gas-by-${site.id}`}><Icon name="flame" /><span className="strong" style={{ fontSize: 14 }}>Kitchen closes</span></label>
      <input id={`gas-by-${site.id}`} className="txt" type="time" step={900} value={v} onChange={(e) => setV(e.target.value)} style={{ width: 120 }} />
      <button type="submit" className="btn ghost small" disabled={pending || v === (site.gasBy ?? "")}>Save</button>
      <span className="muted" style={{ fontSize: 13, flexBasis: "100%" }}>{site.gasBy ? `The gas check is due at ${site.gasBy} every day, for everyone still on shift. Clear it to use the end of the last shift.` : "Not set: the gas check is due when the last shift on the rota ends."}</span>
    </form>
  );
}

/** The owner adds a site: a code (kept for good), a name and a kind. */
function AddSite({ pending, add }: { pending: boolean; add: (v: { id: string; name: string; kind: string; readyBy?: string; gasBy?: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ id: "", name: "", kind: "restaurant", readyBy: "", gasBy: "" });
  if (!open) return <button type="button" className="btn ghost" onClick={() => setOpen(true)}>Add a site</button>;
  return (
    <form className="card stack" aria-label="Add a site" onSubmit={(e) => { e.preventDefault(); add({ ...v, readyBy: v.readyBy || undefined, gasBy: v.gasBy || undefined }); }}>
      <h2 className="h-sec">Add a site</h2>
      <div className="row wrap" style={{ gap: 12 }}>
        <label className="stack" style={{ gap: 4, flex: "0 1 110px" }}><span className="strong">Code</span>
          <input className="txt" value={v.id} maxLength={5} placeholder="GRE" onChange={(e) => setV({ ...v, id: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} /></label>
        <label className="stack" style={{ gap: 4, flex: "1 1 200px" }}><span className="strong">Name</span>
          <input className="txt" value={v.name} maxLength={40} placeholder="Greenwich" onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
      </div>
      <div className="seg" role="group" aria-label="Kind">
        <button type="button" aria-pressed={v.kind === "restaurant"} onClick={() => setV({ ...v, kind: "restaurant" })}>Restaurant</button>
        <button type="button" aria-pressed={v.kind === "production"} onClick={() => setV({ ...v, kind: "production" })}>Production kitchen</button>
      </div>
      <div className="row wrap" style={{ gap: 12 }}>
        <label className="stack" style={{ gap: 4 }}><span className="strong">Ready to open by</span><input className="txt" type="time" step={900} value={v.readyBy} onChange={(e) => setV({ ...v, readyBy: e.target.value })} /></label>
        <label className="stack" style={{ gap: 4 }}><span className="strong">Kitchen closes</span><input className="txt" type="time" step={900} value={v.gasBy} onChange={(e) => setV({ ...v, gasBy: e.target.value })} /></label>
      </div>
      <p className="muted lead" style={{ margin: 0 }}>The code can&apos;t be changed later: records are kept under it. The site opens straight away; add its team from their accounts.</p>
      <div className="row" style={{ gap: 8 }}>
        <button type="submit" className="btn accent" disabled={pending || v.id.length < 2 || !v.name.trim()}>Add site</button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
