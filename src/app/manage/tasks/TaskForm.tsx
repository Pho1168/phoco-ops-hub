"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addTask } from "@/app/actions";
import { PRIORITIES, TASK_CATEGORIES, type Priority, type TaskCategory } from "@/lib/domain/tasks";
import type { Area, SiteId } from "@/lib/domain/types";

export interface SiteChoice { id: SiteId; name: string; sections: Area[]; people: { id: string; name: string }[] }

/** A new task: what, how urgent, for whom, by when. */
export function TaskForm({ sites, today }: { sites: SiteChoice[]; today: string }) {
  const router = useRouter();
  const [siteId, setSiteId] = useState<SiteId>(sites[0].id);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [priority, setPriority] = useState<Priority>(3);
  const [category, setCategory] = useState<TaskCategory>("cleaning");
  const [who, setWho] = useState("anyone"); // "anyone" | "section:FOH" | "person:<id>"
  const [dueOn, setDueOn] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const site = sites.find((s) => s.id === siteId) ?? sites[0];

  const save = () => start(async () => {
    setErr(""); setMsg("");
    const r = await addTask(siteId, {
      title, detail, priority, category, dueOn,
      section: who.startsWith("section:") ? who.slice(8) : undefined,
      assigneeId: who.startsWith("person:") ? who.slice(7) : undefined,
    });
    if (!r.ok) { setErr(r.error); return; }
    setMsg(`Added: ${title}`); setTitle(""); setDetail(""); setDueOn(""); setWho("anyone"); setPriority(3);
    router.refresh();
  });

  return (
    <form className="card stack" aria-label="New task" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <h2 className="h-sec">New task</h2>
      {sites.length > 1 && (
        <div className="seg" role="group" aria-label="Site">
          {sites.map((s) => <button key={s.id} type="button" aria-pressed={s.id === siteId} onClick={() => { setSiteId(s.id); setWho("anyone"); }}>{s.name}</button>)}
        </div>
      )}
      <input id="task-title" className="txt wide" style={{ maxWidth: "none" }} maxLength={120} placeholder="What needs doing? e.g. Deep clean the extraction filters" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Task" required />
      <textarea className="txt wide" style={{ maxWidth: "none", height: 70, padding: 10 }} maxLength={1000} placeholder="Details (optional)" value={detail} onChange={(e) => setDetail(e.target.value)} aria-label="Details" />
      <div className="seg" role="group" aria-label="Priority">
        {PRIORITIES.map((p) => <button key={p.id} type="button" aria-pressed={priority === p.id} title={p.hint} onClick={() => setPriority(p.id)}>{p.code} {p.label}</button>)}
      </div>
      <div className="muted" style={{ fontSize: 13 }}>{PRIORITIES.find((p) => p.id === priority)!.hint}.{priority === 1 ? " Everyone it's for gets a message." : ""}</div>
      <div className="row wrap" style={{ gap: 10 }}>
        <label className="stack" style={{ gap: 4 }}><span className="muted">For</span>
          <select id="task-who" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="anyone">Anyone at {site.name}</option>
            {site.sections.map((s) => <option key={s} value={`section:${s}`}>{s} team</option>)}
            {site.people.map((p) => <option key={p.id} value={`person:${p.id}`}>{p.name}</option>)}
          </select></label>
        <label className="stack" style={{ gap: 4 }}><span className="muted">Kind</span>
          <select id="task-cat" value={category} onChange={(e) => setCategory(e.target.value as TaskCategory)}>
            {TASK_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select></label>
        <label className="stack" style={{ gap: 4 }}><span className="muted">Due by (optional)</span>
          <input id="task-due" className="txt" type="date" min={today} value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></label>
      </div>
      {err && <div className="err" role="alert">{err}</div>}
      {msg && <div className="alert good" role="status"><div className="strong" style={{ fontSize: 14 }}>{msg}</div></div>}
      <button className="btn accent" type="submit" disabled={pending}>{pending ? "Adding…" : "Add task"}</button>
    </form>
  );
}
