"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveSkill, retireSkill, savePathway } from "@/app/actions";

/** ↑ ↓: a skill's place in its pathway. */
export function MoveButtons({ skillId, title, first, last }: { skillId: string; title: string; first: boolean; last: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const move = (dir: -1 | 1) => start(async () => {
    setErr("");
    const r = await moveSkill(skillId, dir);
    if (!r.ok) setErr(r.error); else router.refresh();
  });
  return (
    <span className="row" style={{ gap: 4 }}>
      <button type="button" className="btn ghost small" aria-label={`Move ${title} up`} disabled={pending || first} onClick={() => move(-1)}>↑</button>
      <button type="button" className="btn ghost small" aria-label={`Move ${title} down`} disabled={pending || last} onClick={() => move(1)}>↓</button>
      {err && <span className="err" role="alert">{err}</span>}
    </span>
  );
}

/** Retire a skill (it leaves everyone's training; their records stay) or bring it back. */
export function RetireSkill({ skillId, retired }: { skillId: string; retired: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const [err, setErr] = useState("");
  const run = () => start(async () => {
    setErr("");
    const r = await retireSkill(skillId, !retired);
    if (!r.ok) setErr(r.error); else { setAsking(false); router.refresh(); }
  });
  return (
    <>
      {retired
        ? <button type="button" className="btn ghost small" disabled={pending} onClick={run}>Bring it back</button>
        : <button type="button" className="btn ghost small" onClick={() => setAsking(true)}>Retire this skill</button>}
      {asking && (
        <div className="modal-back">
          <div className="modal" role="dialog" aria-label="Retire this skill">
            <h2 className="h-sec">Retire this skill?</h2>
            <p style={{ margin: 0 }}>It leaves everyone&apos;s training. What people have done stays on their record, and you can bring it back.</p>
            {err && <div className="err" role="alert">{err}</div>}
            <div className="row"><button type="button" className="btn ghost" onClick={() => setAsking(false)}>Cancel</button>
              <button type="button" className="btn bad grow" disabled={pending} onClick={run}>Retire</button></div>
          </div>
        </div>
      )}
      {!asking && err && <div className="err" role="alert">{err}</div>}
    </>
  );
}

/** A pathway's deadlines: induction within so many days of starting, everything within so many. */
export function PathwayForm({ section, inductionDays, allDays }: { section: string; inductionDays: number; allDays: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const [ind, setInd] = useState(String(inductionDays));
  const [all, setAll] = useState(String(allDays));
  return (
    <form className="card stack" style={{ gap: 10 }} aria-label="Deadlines" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        setErr(""); setSaved(false);
        const r = await savePathway(section, Number(ind), Number(all));
        if (!r.ok) setErr(r.error); else { setSaved(true); router.refresh(); }
      });
    }}>
      <span className="strong">Deadlines, from the day someone starts in this section</span>
      <div className="row wrap" style={{ gap: 10 }}>
        <label className="stack grow" style={{ gap: 6 }}><span className="muted">Induction within (days)</span>
          <input id="pathway-induction" className="txt" type="number" min={1} max={60} value={ind} onChange={(e) => { setInd(e.target.value); setSaved(false); }} /></label>
        <label className="stack grow" style={{ gap: 6 }}><span className="muted">Everything within (days)</span>
          <input id="pathway-all" className="txt" type="number" min={1} max={365} value={all} onChange={(e) => { setAll(e.target.value); setSaved(false); }} /></label>
      </div>
      {err && <div className="err" role="alert">{err}</div>}
      <div className="row wrap" style={{ gap: 10 }}>
        <button className="btn ghost small" type="submit" disabled={pending}>{pending ? "Saving…" : "Save deadlines"}</button>
        {saved && <span className="chip done" role="status">Saved</span>}
      </div>
    </form>
  );
}
