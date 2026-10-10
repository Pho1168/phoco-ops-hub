"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeMyPin } from "@/app/actions";

export function PinForm({ first }: { first: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 4);
  const field = (id: string, label: string, value: string, set: (v: string) => void, auto?: boolean) => (
    <label className="stack" style={{ gap: 6 }}>
      <span className="strong" style={{ fontSize: 15 }}>{label}</span>
      <input id={id} className="num" style={{ width: "100%" }} type="password" inputMode="numeric" autoComplete="off" maxLength={4}
        required autoFocus={auto} value={value} onChange={(e) => { setErr(""); set(digits(e.target.value)); }} />
    </label>
  );

  if (done) {
    return (
      <div className="stack">
        <div className="alert good" role="status"><div className="strong">PIN saved. Use it from now on.</div></div>
        <button className="btn accent" type="button" onClick={() => router.replace("/")}>Continue</button>
      </div>
    );
  }

  return (
    <form className="card stack" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await changeMyPin(cur, next, again);
        if (r.ok) setDone(true);
        else { setErr(r.error); if (r.error.includes("signed out")) router.replace("/login"); }
      });
    }}>
      {field("pin-current", first ? "Temporary PIN you were given" : "Current PIN", cur, setCur, true)}
      {field("pin-new", "New PIN", next, setNext)}
      {field("pin-again", "New PIN again", again, setAgain)}
      {err && <div className="err" role="alert">{err}</div>}
      <div className="row">
        {!first && <Link className="btn ghost" href="/">Cancel</Link>}
        <button className="btn accent grow" type="submit" disabled={pending || cur.length < 4 || next.length < 4 || again.length < 4}>Save PIN</button>
      </div>
    </form>
  );
}
