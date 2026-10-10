"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPairingCode, removeDevice } from "@/app/actions";

export interface DeviceRow { id: string; label: string; site: string; status: string; lastSeen: string; current: boolean }

export function DevicesCard({ devices, sites, demo }: { devices: DeviceRow[]; sites: { id: string; name: string }[]; demo: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "EAS");
  const [label, setLabel] = useState("");
  const [code, setCode] = useState<{ code: string; until: string; label: string } | null>(null);
  const [err, setErr] = useState("");

  return (
    <section className="card stack" aria-label="Devices">
      <h2 className="h-sec">Site tablets</h2>
      <p className="muted" style={{ margin: 0 }}>Staff can only sign in on these. Anywhere else shows no names, just owner sign-in by staff ID.</p>
      {demo && <div className="muted">Demo mode skips the device check, so every browser acts like a tablet.</div>}

      <ul className="accounts">
        {devices.length === 0 && <li className="muted">No tablets set up yet.</li>}
        {devices.map((d) => (
          <li key={d.id}>
            <div className="grow">
              <div className="strong">{d.label}{d.current ? " (this device)" : ""}</div>
              <div className="muted">{d.site} · last used {d.lastSeen}</div>
            </div>
            <span className={`chip ${d.status === "active" ? "done" : ""}`}>{d.status === "active" ? "Active" : "Removed"}</span>
            {d.status === "active" && (
              <span className="acct-actions">
                <button type="button" className="btn bad small" disabled={pending} onClick={() => {
                  if (!confirm(`Remove ${d.label}? Anyone signed in on it is signed out, and it can't be used until set up again.`)) return;
                  start(async () => { const r = await removeDevice(d.id); if (!r.ok) setErr(r.error); router.refresh(); });
                }}>Remove</button>
              </span>
            )}
          </li>
        ))}
      </ul>

      <form className="stack site-box" onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setErr(""); setCode(null);
          const r = await createPairingCode(siteId, label);
          if (!r.ok || !r.code) { setErr(r.ok ? "Something went wrong" : r.error); return; }
          setCode({ code: r.code, label: label.trim(), until: new Date(r.expiresAt!).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) });
          setLabel("");
        });
      }}>
        <span className="strong">Set up a new tablet</span>
        <div className="row wrap">
          <label className="stack" style={{ gap: 6, flex: "1 1 140px" }}><span className="muted">Site</span>
            <select id="dev-site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label className="stack" style={{ gap: 6, flex: "2 1 200px" }}><span className="muted">Name</span>
            <input id="dev-label" className="txt" style={{ width: "100%", maxWidth: "none" }} maxLength={40} placeholder="e.g. Kitchen tablet" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        </div>
        <button className="btn" type="submit" disabled={pending || !label.trim()}>Create set-up code</button>
        {code && (
          <div className="alert good" role="status">
            <div className="grow">
              <div className="muted" style={{ color: "inherit" }}>On the new tablet, open the app and enter:</div>
              <div className="stat" style={{ letterSpacing: 4, margin: "6px 0" }}>{code.code}</div>
              <div style={{ fontSize: 13 }}>For {code.label}. Works once, until {code.until}.</div>
            </div>
          </div>
        )}
      </form>
      {err && <div className="err" role="alert">{err}</div>}
    </section>
  );
}
