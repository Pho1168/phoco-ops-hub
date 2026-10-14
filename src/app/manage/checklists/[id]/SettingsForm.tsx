"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checklistSettings } from "@/app/actions";
import { AREA_TEXT, CHECKLIST_AREAS, NAME_MAX, WHEN_MAX } from "@/lib/domain/checklist-edit";
import type { Area } from "@/lib/domain/types";

export function SettingsForm(p: { id: string; name: string; area: Area; when: string; due: string; active: boolean; published: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(p.name);
  const [area, setArea] = useState<Area>(p.area);
  const [when, setWhen] = useState(p.when);
  const [due, setDue] = useState(p.due);
  const [active, setActive] = useState(p.active);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const changed = name !== p.name || area !== p.area || when !== p.when || due !== p.due || active !== p.active;
  return (
    <form className="stack" style={{ gap: 10 }} onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        setErr(""); setMsg("");
        const r = await checklistSettings(p.id, { name, area, when, due, active });
        if (r.ok) { setMsg("Saved"); router.refresh(); } else setErr(r.error);
      });
    }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <label className="stack" style={{ gap: 6, flex: "2 1 220px" }}><span className="strong" style={{ fontSize: 14 }}>Name</span>
          <input className="txt" style={{ width: "100%", maxWidth: "none" }} required maxLength={NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="stack" style={{ gap: 6, flex: "2 1 220px" }}><span className="strong" style={{ fontSize: 14 }}>When</span>
          <input className="txt" style={{ width: "100%", maxWidth: "none" }} required maxLength={WHEN_MAX} value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
        <label className="stack" style={{ gap: 6, flex: "1 1 140px" }}><span className="strong" style={{ fontSize: 14 }}>Due by</span>
          <input className="txt" type="time" style={{ width: "100%", maxWidth: "none" }} value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
      </div>
      <div className="stack" style={{ gap: 6 }}><span className="strong" style={{ fontSize: 14 }}>Who does it</span>
        <div className="seg" role="group" aria-label="Who does it">
          {CHECKLIST_AREAS.map((a) => <button key={a} type="button" aria-pressed={area === a} onClick={() => setArea(a)}>{AREA_TEXT[a]}</button>)}
        </div>
        <span className="muted" style={{ fontSize: 13 }}>Which lane it sits in on the Shift screen and Today, and whose section can run it. Past runs keep their records whichever lane it moves to.</span>
      </div>
      <div className="row wrap" style={{ gap: 10 }}>
        {p.published && (
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" className="check" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>{active ? "On: asked every day it's due" : "Off: nobody is asked, the history stays"}</span>
          </label>
        )}
        <span className="grow" />
        {msg && <span className="muted">{msg}</span>}
        <button className="btn small" type="submit" disabled={pending || !changed}>Save settings</button>
      </div>
      <div className="muted" style={{ fontSize: 13 }}>No due time means it&apos;s done as needed and never shows late. Signed-off runs are judged on time or late against the due time as it is now.</div>
      {err && <div className="err" role="alert">{err}</div>}
    </form>
  );
}
