"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmGasOff } from "@/app/actions";
import { Icon } from "@/components/Icon";

/**
 * The gas check at close: a button until someone confirms, then who did it and when. On the shop tablet the person
 * enters their PIN (the record is kept for good, so it must be the right name); on their own phone they confirm.
 */
export function GasCheck({ siteId, siteName, state, closeAt, done, needsPin = false }:
  { siteId: string; siteName: string; state: "due" | "overdue" | "done"; closeAt: string; done?: string; needsPin?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [asking, setAsking] = useState(false);
  const [pin, setPin] = useState("");

  if (state === "done") {
    return (
      <div className="alert good" role="status" aria-label="Gas check">
        <Icon name="flame" />
        <div className="grow"><div className="strong">Gas off · {siteName}</div><div style={{ fontSize: 13 }}>{done}</div></div>
      </div>
    );
  }
  const send = (p?: string) => start(async () => {
    setErr("");
    const r = await confirmGasOff(siteId, p);
    if (!r.ok) { setErr(r.error); return; }
    setAsking(false); setPin("");
    router.refresh();
  });
  const tap = () => {
    if (needsPin) { setErr(""); setAsking(true); return; }
    if (window.confirm("Is every gas appliance and the gas supply off?")) send();
  };
  return (
    <>
      <section className={`alert ${state === "overdue" ? "bad" : ""}`} aria-label="Gas check" style={{ flexWrap: "wrap" }}>
        <Icon name="flame" />
        <div className="grow stack" style={{ gap: 4, minWidth: 200 }}>
          <div className="strong">{state === "overdue" ? `Gas check not done · due at ${closeAt}` : `Gas check before you leave · ${siteName}`}</div>
          <div style={{ fontSize: 13 }}>Make sure every gas appliance and the gas supply are off, then tap the button.</div>
          {err && !asking && <div className="err" role="alert">{err}</div>}
        </div>
        <button type="button" className="btn accent" disabled={pending} onClick={tap}>All gas is off</button>
      </section>
      {asking && (
        <div className="modal-back" onKeyDown={(e) => { if (e.key === "Escape") setAsking(false); }}>
          <form className="modal" role="dialog" aria-label="Gas check" onSubmit={(e) => { e.preventDefault(); send(pin); }}>
            <h2 className="h-sec">Gas off at {siteName}</h2>
            <p style={{ margin: 0 }}>Every gas appliance and the gas supply are off. This is kept with your name.</p>
            <label className="stack" style={{ gap: 6 }}>
              <span className="muted">Enter your PIN to confirm</span>
              <input id="gas-pin" className="num" style={{ width: "100%" }} type="password" inputMode="numeric" maxLength={4} autoComplete="off" autoFocus required value={pin} onChange={(e) => setPin(e.target.value)} />
            </label>
            {err && <div className="err" role="alert">{err}</div>}
            <div className="row">
              <button type="button" className="btn ghost" onClick={() => setAsking(false)}>Cancel</button>
              <button className="btn accent grow" type="submit" disabled={pending}>Confirm</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
