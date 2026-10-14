"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { pairDevice, staffIdSignIn } from "@/app/actions";
import { Icon } from "@/components/Icon";
import { Logo } from "@/components/Logo";

/**
 * An unregistered device: a tablet pairs with a one-time code; owners and operations managers (and staff, on their
 * own phones) sign in with their staff ID. On a phone the staff-ID form comes first; on a tablet the set-up code does.
 */
export function SetupScreen({ removed, returnTo }: { removed: boolean; returnTo?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [code, setCode] = useState("");
  const [codeErr, setCodeErr] = useState("");
  const [staff, setStaff] = useState("");
  const [pin, setPin] = useState("");
  const [ownerErr, setOwnerErr] = useState("");

  return (
    <div className="login-shell setup">
      <aside className="login-aside">
        <Logo kind="stacked" className="login-logo" />
        <div className="login-title">
          <span className="login-eyebrow">Ops Hub</span>
          <span className="login-site">Sign in</span>
          <span className="login-date">This device isn&apos;t registered to a site, so no names are shown.</span>
        </div>
        <ol className="login-steps">
          <li><span className="avatar tone-amber">1</span><span>The owner or operations manager opens <strong>Site tablets</strong> on the overview and creates a one-time code.</span></li>
          <li><span className="avatar tone-amber">2</span><span>Type the code into the tablet within 15 minutes.</span></li>
          <li><span className="avatar tone-amber">3</span><span>The tablet shows that site&apos;s team from then on.</span></li>
        </ol>
      </aside>

      <main className="login-main setup-main">
        {removed && <div className="err">This device was removed. Ask the owner or operations manager for a new set-up code.</div>}

        <form className="card stack setup-staff" onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await staffIdSignIn(staff, pin);
            if (r.ok) router.replace(returnTo ?? "/"); else { setOwnerErr(r.error); setPin(""); }
          });
        }}>
          <div className="row wrap"><h2 className="h-sec grow">Sign in with your staff ID</h2><span className="chip done">Your own device</span></div>
          <p className="muted" style={{ margin: 0 }}>Staff see their shifts, the rota, handover and allergens. Owners and operations managers get the full app.</p>
          <div className="row wrap">
            <label className="stack" style={{ gap: 6, flex: "1 1 140px" }}>
              <span className="strong" style={{ fontSize: 15 }}>Staff ID</span>
              <input id="owner-staff" className="txt wide big-id" autoComplete="username" inputMode="numeric" placeholder="e.g. 004"
                maxLength={3} value={staff} onChange={(e) => { setOwnerErr(""); setStaff(e.target.value.replace(/\D/g, "")); }} />
            </label>
            <label className="stack" style={{ gap: 6, flex: "1 1 120px" }}>
              <span className="strong" style={{ fontSize: 15 }}>PIN</span>
              <input id="owner-pin" className="txt wide big-id" type="password" inputMode="numeric" autoComplete="current-password"
                maxLength={4} value={pin} onChange={(e) => { setOwnerErr(""); setPin(e.target.value.replace(/\D/g, "").slice(0, 4)); }} />
            </label>
          </div>
          {ownerErr && <div className="err" role="alert">{ownerErr}</div>}
          <button className="btn accent" type="submit" disabled={pending || staff.length < 1 || pin.length < 4}>Sign in</button>
          <p className="muted" style={{ margin: 0 }}>Your staff ID is on your rota line. Forgotten your PIN? The owner or operations manager sets a new one.</p>
        </form>

        <div className="card soft row setup-nudge">
          <Icon name="bell" />
          <div className="grow"><div className="strong">Shift reminders</div><div className="muted">After signing in on your phone, turn on notifications to get a nudge 2 hours before each shift.</div></div>
        </div>

        <form className="card stack setup-code" onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await pairDevice(code);
            if (r.ok) router.refresh(); else setCodeErr(r.error);
          });
        }}>
          <div className="row wrap"><h2 className="h-sec grow">Set up this tablet</h2><span className="chip">Site tablets</span></div>
          <p className="muted" style={{ margin: 0 }}>Staff sign in on registered site tablets only. Enter the set-up code from the overview.</p>
          <label className="stack" style={{ gap: 6 }}>
            <span className="strong" style={{ fontSize: 15 }}>Set-up code</span>
            <input id="pair-code" className="num code" autoComplete="off" autoCapitalize="characters"
              maxLength={7} placeholder="ABC-234" value={code} onChange={(e) => { setCodeErr(""); setCode(e.target.value.toUpperCase()); }} />
          </label>
          {codeErr && <div className="err" role="alert">{codeErr}</div>}
          <div className="row wrap">
            <button className="btn" type="submit" disabled={pending || code.replace(/[\s-]/g, "").length < 6}>Set up tablet</button>
            <span className="muted">Codes expire after 15 minutes; ask for a fresh one if this fails.</span>
          </div>
        </form>
      </main>
    </div>
  );
}
