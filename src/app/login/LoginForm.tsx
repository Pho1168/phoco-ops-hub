"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/app/actions";
import { Avatar } from "@/components/Avatar";
import { Clock } from "@/components/Clock";
import { Icon } from "@/components/Icon";
import { Logo } from "@/components/Logo";
import type { LoginGroups, LoginPerson } from "@/lib/domain/login";
import { firstName } from "@/lib/domain/names";
import type { SiteId } from "@/lib/domain/types";

interface S { id: SiteId; name: string; closed: boolean; reason?: string }

export function LoginForm({ sites, groups, deviceLabel, returnTo, dateLine }: {
  sites: S[]; groups: Record<SiteId, LoginGroups>; deviceLabel?: string; returnTo?: string; dateLine: string;
}) {
  const router = useRouter();
  const [siteId, setSiteId] = useState<SiteId>(sites[0]?.id ?? "EAS");
  const [pick, setPick] = useState<LoginPerson | null>(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const site = sites.find((s) => s.id === siteId);
  const g = groups[siteId] ?? { onToday: [], others: [] };
  const empty = g.onToday.length + g.others.length === 0;

  function choose(p: LoginPerson | null) { setPick(p); setPin(""); setErr(""); }

  function press(d: string) {
    if (pending || !pick) return;
    setErr("");
    const next = d === "del" ? pin.slice(0, -1) : (pin + d).slice(0, 4);
    setPin(next);
    if (next.length === 4) {
      start(async () => {
        const r = await signIn(siteId, pick.id, next);
        if (r.ok) router.replace(returnTo ?? "/");
        else { setErr(r.error); setPin(""); }
      });
    }
  }

  const person = (p: LoginPerson, big: boolean) => (
    <button key={p.id} type="button" className={`person-btn person ${p.frozen ? "frozen" : ""} ${big ? "big" : ""}`} aria-pressed={pick?.id === p.id} onClick={() => choose(p)}>
      <Avatar name={p.name} tone={p.tone} size={42} />
      <span className="grow">
        <span className="person-name">{p.name}</span>
        <span className="muted">{p.label}</span>
      </span>
      {p.tone !== "lead" && !p.frozen && <span className={`sec ${p.tone}`}>{p.tone}</span>}
    </button>
  );

  return (
    <div className="login-shell">
      <aside className="login-aside">
        <Logo kind="stacked" className="login-logo" />
        <div className="login-title">
          <span className="login-eyebrow">Site tablet</span>
          <span className="login-site">{site?.name ?? "PHO & CO"}</span>
          <span className="login-date">{dateLine}</span>
          <Clock className="login-clock" />
        </div>
        <div className="login-facts">
          {deviceLabel && <div><Icon name="tablet" /><span>{deviceLabel}</span></div>}
          <div><Icon name="clock" /><span>{g.onToday.length ? `${g.onToday.length} on the rota today · first in at ${g.firstIn}` : "Nobody on today's rota yet"}</span></div>
          <div className="login-note">On your own phone, sign in with your staff ID instead.</div>
        </div>
      </aside>

      {pick ? (
        <main className="login-main pinpane" aria-live="polite">
          <button type="button" className="btn ghost small login-back" onClick={() => choose(null)}><Icon name="back" />Not you? Back</button>
          <Avatar name={pick.name} tone={pick.tone} size={84} />
          <div className="login-hi">
            <h1 className="h-display">Hi {firstName(pick.name)}</h1>
            <div className="muted">{pick.label}{pick.shift ? ` · on from ${pick.shift.start} today` : ""} · enter your PIN</div>
          </div>
          <div className="panel">
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
          <div className="muted">Forgotten it? The owner or operations manager can set you a new one.</div>
        </main>
      ) : (
        <main className="login-main">
          <div className="row wrap login-head">
            <h1 className="h-display grow">Who&apos;s working?</h1>
            <span className="muted">Tap your name, then your PIN</span>
          </div>
          {sites.length > 1 && <div className="seg" role="group" aria-label="Site">
            {sites.map((s) => (
              <button key={s.id} type="button" aria-pressed={s.id === siteId} onClick={() => { setSiteId(s.id); choose(null); }}>{s.name}</button>
            ))}
          </div>}
          {site?.closed && <div className="err"><strong>{site.name} is closed.</strong> {site.reason ? `${site.reason}. ` : ""}Staff sign-in is frozen until the owner reopens it.</div>}
          {empty && <div className="card muted">No staff at this site yet. The owner or operations manager adds people from the overview.</div>}
          {g.onToday.length > 0 && (
            <section className="stack panel">
              <h2 className="grp-h">On the rota today <span>{g.onToday.length} · in start order</span></h2>
              <div className="people-grid rota">{g.onToday.map((p) => person(p, true))}</div>
            </section>
          )}
          {g.others.length > 0 && (
            <section className="stack panel nude">
              <h2 className="grp-h">{g.onToday.length ? "Everyone else" : "Everyone"} at {site?.name} <span>{g.others.length}</span></h2>
              <div className="people-grid">{g.others.map((p) => person(p, false))}</div>
            </section>
          )}
          <div className="row wrap login-foot">
            <span className="muted grow">Can&apos;t see your name? The owner or operations manager adds people from the overview.</span>
            <span className="muted">PINs are never shown on screen</span>
          </div>
        </main>
      )}
    </div>
  );
}
