"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmGasOff } from "@/app/actions";
import { Icon } from "@/components/Icon";

/** The gas check at close: a button until someone confirms, then who did it and when. */
export function GasCheck({ siteId, siteName, state, closeAt, done }: { siteId: string; siteName: string; state: "due" | "overdue" | "done"; closeAt: string; done?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  if (state === "done") {
    return (
      <div className="alert good" role="status" aria-label="Gas check">
        <Icon name="flame" />
        <div className="grow"><div className="strong">Gas off · {siteName}</div><div style={{ fontSize: 13 }}>{done}</div></div>
      </div>
    );
  }
  const confirm = () => {
    if (!window.confirm("Is every gas appliance and the gas supply off?")) return;
    start(async () => {
      setErr("");
      const r = await confirmGasOff(siteId);
      if (!r.ok) { setErr(r.error); return; }
      router.refresh();
    });
  };
  return (
    <section className={`alert ${state === "overdue" ? "bad" : ""}`} aria-label="Gas check" style={{ flexWrap: "wrap" }}>
      <Icon name="flame" />
      <div className="grow stack" style={{ gap: 4, minWidth: 200 }}>
        <div className="strong">{state === "overdue" ? `Gas check not done · last shift ended ${closeAt}` : `Gas check before you leave · ${siteName}`}</div>
        <div style={{ fontSize: 13 }}>Make sure every gas appliance and the gas supply are off, then tap the button.</div>
        {err && <div className="err" role="alert">{err}</div>}
      </div>
      <button type="button" className="btn accent" disabled={pending} onClick={confirm}>All gas is off</button>
    </section>
  );
}
