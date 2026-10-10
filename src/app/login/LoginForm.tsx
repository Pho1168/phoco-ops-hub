"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/app/actions";

interface P { id: string; name: string; frozen: boolean; sites: string[]; label: string }
interface S { id: string; name: string; closed: boolean; reason?: string }

export function LoginForm({ sites, people, deviceLabel }: { sites: S[]; people: P[]; deviceLabel?: string }) {
  const router = useRouter();
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "EAS");
  const [pick, setPick] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const site = sites.find((s) => s.id === siteId);
  const list = people.filter((p) => p.sites.includes(siteId));
  const chosen = people.find((p) => p.id === pick);

  function press(d: string) {
    if (pending) return;
    setErr("");
    const next = d === "del" ? pin.slice(0, -1) : (pin + d).slice(0, 4);
    setPin(next);
    if (next.length === 4 && pick) {
      start(async () => {
        const r = await signIn(siteId, pick, next);
        if (r.ok) router.replace("/");
        else { setErr(r.error); setPin(""); }
      });
    }
  }

  return (
    <div className="login">
      <div>
        <div className="logo" style={{ color: "var(--brand)", fontSize: 28 }}>PHO &amp; CO</div>
        <h1 className="h-display" style={{ marginTop: 6 }}>Who&apos;s working?</h1>
        {deviceLabel && <div className="muted" style={{ marginTop: 6 }}>{site?.name} · {deviceLabel}</div>}
      </div>
      {sites.length > 1 && <div className="seg" role="group" aria-label="Site">
        {sites.map((s) => (
          <button key={s.id} type="button" aria-pressed={s.id === siteId} onClick={() => { setSiteId(s.id); setPick(null); setPin(""); setErr(""); }}>{s.name}</button>
        ))}
      </div>}
      {site?.closed && <div className="err"><strong>{site.name} is closed.</strong> {site.reason ? `${site.reason}. ` : ""}Staff sign-in is frozen until the owner reopens it.</div>}
      {list.length === 0 && <div className="card muted">No staff at this site yet. An owner can add people from the Owner screen.</div>}
      <div className="people">
        {list.map((p) => (
          <button key={p.id} type="button" className="person" aria-pressed={pick === p.id} onClick={() => { setPick(p.id); setPin(""); setErr(""); }}>
            <span className="avatar">{p.name[0]}</span>
            <span className="strong">{p.name}</span>
            <span className="muted">{p.frozen ? "Frozen" : p.label}</span>
          </button>
        ))}
      </div>
      {chosen && (
        <div className="stack" style={{ alignItems: "center" }}>
          <div className="muted">Enter PIN for {chosen.name}</div>
          <div className="pin-dots" aria-live="polite" aria-label={`${pin.length} of 4 digits entered`}>
            {[0, 1, 2, 3].map((i) => <i key={i} className={i < pin.length ? "on" : ""} />)}
          </div>
          {err && <div className="err" role="alert">{err}</div>}
          <div className="pad">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((d, i) =>
              d === "" ? <span key={i} /> : (
                <button key={i} type="button" onClick={() => press(d)} aria-label={d === "del" ? "Delete" : d} disabled={pending}>{d === "del" ? "⌫" : d}</button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
