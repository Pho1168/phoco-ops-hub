"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmSkill, takeBackSkill } from "@/app/actions";

/** A manager confirms a hands-on skill after watching the person do it. */
export function ConfirmButton({ personId, skillId, name, skill }: { personId: string; skillId: string; name: string; skill: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  return (
    <>
      <button type="button" className="btn accent small" disabled={pending} aria-label={`Confirm ${name} on ${skill}`} onClick={() => start(async () => {
        setErr("");
        const r = await confirmSkill(personId, skillId);
        if (!r.ok) setErr(r.error); else router.refresh();
      })}>{pending ? "Saving…" : "Confirm"}</button>
      {err && <div className="err" role="alert">{err}</div>}
    </>
  );
}

/**
 * A manager takes a skill back (done or ready to be checked), saying why: it has to be done again. `wasDone`: it had
 * been done (it goes back on their list for two weeks); otherwise only their readiness goes.
 */
export function TakeBackButton({ personId, skillId, name, skill, wasDone }: { personId: string; skillId: string; name: string; skill: string; wasDone: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  return (
    <>
      <button type="button" className="btn ghost small" aria-label={`Ask ${name} to do ${skill} again`} onClick={() => { setErr(""); setAsking(true); }}>Do it again</button>
      {asking && (
        <div className="modal-back">
          <form className="modal" role="dialog" aria-label={`${skill}: do it again`} onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setErr("");
              const r = await takeBackSkill(personId, skillId, note);
              if (!r.ok) setErr(r.error); else { setAsking(false); setNote(""); router.refresh(); }
            });
          }}>
            <h2 className="h-sec">Ask {name} to do it again?</h2>
            <p style={{ margin: 0 }}>{wasDone
              ? `${skill} goes back on their list, due within two weeks. What they did before stays on their record.`
              : `${skill} goes back to in training: they pass the quiz again (or say they're ready) before you can confirm it. They have at least two weeks.`}</p>
            <label className="stack" style={{ gap: 6 }}><span className="muted">Why (they&apos;ll see this)</span>
              <textarea id="take-back-note" autoFocus required minLength={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Portions were over spec: practise with the scales" /></label>
            {err && <div className="err" role="alert">{err}</div>}
            <div className="row"><button type="button" className="btn ghost" onClick={() => setAsking(false)}>Cancel</button>
              <button className="btn bad grow" type="submit" disabled={pending}>{pending ? "Saving…" : "Do it again"}</button></div>
          </form>
        </div>
      )}
      {!asking && err && <div className="err" role="alert">{err}</div>}
    </>
  );
}
