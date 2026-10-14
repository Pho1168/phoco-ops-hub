"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checklistCreate } from "@/app/actions";
import { AREA_TEXT, CHECKLIST_AREAS, NAME_MAX, WHEN_MAX } from "@/lib/domain/checklist-edit";
import type { Area, SiteId } from "@/lib/domain/types";

export function NewChecklistForm({ sites, siteId: initialSite }: { sites: { id: SiteId; name: string }[]; siteId: SiteId }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [siteId, setSiteId] = useState<SiteId>(initialSite);
  const [name, setName] = useState("");
  const [area, setArea] = useState<Area>("FOH");
  const [when, setWhen] = useState("");
  const [due, setDue] = useState("");
  const [err, setErr] = useState("");
  return (
    <form className="card stack" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        setErr("");
        const r = await checklistCreate({ siteId, name, area, when, due, items: [] });
        if (r.ok && r.id) router.push(`/manage/checklists/${r.id}`);
        else setErr(r.ok ? "Saved, but it couldn't be opened" : r.error);
      });
    }}>
      {sites.length > 1 && (
        <label className="stack" style={{ gap: 6 }}><span className="strong">Site</span>
          <select value={siteId} onChange={(e) => setSiteId(e.target.value as SiteId)}>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </label>
      )}
      <label className="stack" style={{ gap: 6 }}><span className="strong">Name</span>
        <input className="txt wide" required maxLength={NAME_MAX} placeholder="e.g. Bar Opening" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="stack" style={{ gap: 6 }}><span className="strong">Who does it</span>
        <div className="seg" role="group" aria-label="Who does it">
          {CHECKLIST_AREAS.map((a) => <button key={a} type="button" aria-pressed={area === a} onClick={() => setArea(a)}>{AREA_TEXT[a]}</button>)}
        </div>
        <span className="muted" style={{ fontSize: 13 }}>Staff see the checklists of their own section; managers see them all.</span>
      </div>
      <label className="stack" style={{ gap: 6 }}><span className="strong">When</span>
        <input className="txt wide" required maxLength={WHEN_MAX} placeholder="e.g. Before doors open" value={when} onChange={(e) => setWhen(e.target.value)} />
      </label>
      <label className="stack" style={{ gap: 6 }}><span className="strong">Due by</span>
        <input className="txt" type="time" style={{ width: 160 }} value={due} onChange={(e) => setDue(e.target.value)} />
        <span className="muted" style={{ fontSize: 13 }}>With a due time it&apos;s expected every day and shows late after it. Leave it empty for things done as needed (deliveries, a toilet check).</span>
      </label>
      {err && <div className="err" role="alert">{err}</div>}
      <button className="btn accent" type="submit" disabled={pending}>Next: the checks</button>
    </form>
  );
}
