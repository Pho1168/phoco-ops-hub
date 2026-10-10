"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ownerSignIn, pairDevice } from "@/app/actions";

export function SetupScreen({ removed }: { removed: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [code, setCode] = useState("");
  const [codeErr, setCodeErr] = useState("");
  const [staff, setStaff] = useState("");
  const [pin, setPin] = useState("");
  const [ownerErr, setOwnerErr] = useState("");

  return (
    <div className="login">
      <div>
        <div className="logo" style={{ color: "var(--brand)", fontSize: 28 }}>PHO &amp; CO</div>
        <h1 className="h-display" style={{ marginTop: 6 }}>Ops Hub</h1>
      </div>
      {removed && <div className="err">This device was removed by an owner. Ask an owner for a new set-up code.</div>}

      <form className="card stack" onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await pairDevice(code);
          if (r.ok) router.refresh(); else setCodeErr(r.error);
        });
      }}>
        <h2 className="h-sec">Set up this tablet</h2>
        <p className="muted" style={{ margin: 0 }}>Staff sign in on registered site tablets only. An owner creates a one-time code on the Owner screen (valid 15 minutes).</p>
        <label className="stack" style={{ gap: 6 }}>
          <span className="strong" style={{ fontSize: 15 }}>Set-up code</span>
          <input id="pair-code" className="num" style={{ width: "100%", letterSpacing: 4, textTransform: "uppercase" }} autoComplete="off" autoCapitalize="characters"
            maxLength={7} placeholder="ABC-234" value={code} onChange={(e) => { setCodeErr(""); setCode(e.target.value.toUpperCase()); }} />
        </label>
        {codeErr && <div className="err" role="alert">{codeErr}</div>}
        <button className="btn accent" type="submit" disabled={pending || code.replace(/[\s-]/g, "").length < 6}>Set up tablet</button>
      </form>

      <form className="card stack" onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await ownerSignIn(staff, pin);
          if (r.ok) router.replace("/"); else { setOwnerErr(r.error); setPin(""); }
        });
      }}>
        <h2 className="h-sec">Owner sign-in</h2>
        <p className="muted" style={{ margin: 0 }}>For owners on their own phone or computer.</p>
        <div className="row wrap">
          <label className="stack" style={{ gap: 6, flex: "1 1 140px" }}>
            <span className="strong" style={{ fontSize: 15 }}>Staff ID</span>
            <input id="owner-staff" className="txt" style={{ width: "100%", maxWidth: "none" }} autoComplete="username" autoCapitalize="characters" placeholder="PC-0000"
              maxLength={7} value={staff} onChange={(e) => { setOwnerErr(""); setStaff(e.target.value.toUpperCase()); }} />
          </label>
          <label className="stack" style={{ gap: 6, flex: "1 1 120px" }}>
            <span className="strong" style={{ fontSize: 15 }}>PIN</span>
            <input id="owner-pin" className="txt" style={{ width: "100%", maxWidth: "none" }} type="password" inputMode="numeric" autoComplete="current-password"
              maxLength={4} value={pin} onChange={(e) => { setOwnerErr(""); setPin(e.target.value.replace(/\D/g, "").slice(0, 4)); }} />
          </label>
        </div>
        {ownerErr && <div className="err" role="alert">{ownerErr}</div>}
        <button className="btn" type="submit" disabled={pending || staff.length < 7 || pin.length < 4}>Sign in</button>
      </form>
    </div>
  );
}
