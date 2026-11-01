"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markMyTaskAction, pinMyTask, saveMyTask, stopMyTask } from "@/app/actions";

/** One task on My Day as the screen shows it (worked out on the server from `myDay`). */
export interface MyRowView {
  id: string; title: string; note?: string; priority: 1 | 2 | 3; due: string; dueWords: string; late: boolean; top: boolean;
  repeatWords: string; alertWords: string;
}

const PRI = { 1: "Urgent", 2: "This week", 3: "Can wait" } as const;

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => start(async () => {
    setErr("");
    const r = await fn();
    if (!r.ok) { setErr(r.error ?? "That didn't work"); return; }
    after?.(); router.refresh();
  });
  return { pending, err, run };
}

/** A task: its colour by urgency (orange urgent, amber this week, teal can wait), when it's due, and one big Done. */
export function MyRow({ r, full = false }: { r: MyRowView; full?: boolean }) {
  const { pending, err, run } = useRun();
  return (
    <li className={`my-row p${r.priority}${r.late ? " late" : ""}${full ? " full" : ""}`}>
      <span className="my-dot" aria-label={PRI[r.priority]} title={PRI[r.priority]} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="my-title">{r.title}</div>
        <div className="my-meta">
          <span className={r.late ? "my-late" : ""}>{r.dueWords}</span>
          {r.repeatWords && <span> · {r.repeatWords}</span>}
          {full && r.alertWords && <span> · {r.alertWords}</span>}
        </div>
        {full && r.note && <div className="muted">{r.note}</div>}
        {err && <div className="err" role="alert">{err}</div>}
      </div>
      <div className="my-btns row">
        {full && (
          <>
            <button type="button" className={`btn ghost small my-pin${r.top ? " on" : ""}`} disabled={pending} aria-pressed={r.top}
              onClick={() => run(() => pinMyTask(r.id, !r.top))} title={r.top ? "Take out of Top 3" : "Put in Top 3"}>{r.top ? "★" : "☆"}</button>
            {r.repeatWords && <button type="button" className="btn ghost small" disabled={pending} onClick={() => run(() => markMyTaskAction(r.id, "skipped", r.due))}>Skip</button>}
            <Link className="btn ghost small" href={`/owner/day?edit=${r.id}#form`}>Edit</Link>
          </>
        )}
        <button type="button" className="btn small" disabled={pending} onClick={() => run(() => markMyTaskAction(r.id, "done", r.due))} aria-label={`Done: ${r.title}`}>Done</button>
      </div>
    </li>
  );
}

/** Ticked today: crossed out, with Undo. */
export function DoneRow({ id, title, due, kind }: { id: string; title: string; due: string; kind: "done" | "skipped" }) {
  const { pending, err, run } = useRun();
  return (
    <li className="my-row done">
      <span className="my-dot" />
      <div className="grow"><div className="my-title">{title}</div><div className="my-meta">{kind === "done" ? "Done" : "Skipped"}</div>{err && <div className="err">{err}</div>}</div>
      <button type="button" className="btn ghost small" disabled={pending} onClick={() => run(() => markMyTaskAction(id, "undone", due))}>Undo</button>
    </li>
  );
}

/** Add something for today in one line (Urgent / This week / Can wait). More options on the full page. */
export function QuickAdd() {
  const { pending, err, run } = useRun();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<1 | 2 | 3>(2);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  return (
    <form className="stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); run(() => saveMyTask({ title, priority, repeat: "once", dueOn: today }), () => setTitle("")); }}>
      <div className="row" style={{ gap: 8 }}>
        <input className="txt grow" style={{ maxWidth: "none", width: "auto" }} maxLength={120} placeholder="Add for today…" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="New task for today" />
        <button className="btn small" type="submit" disabled={pending || !title.trim()}>Add</button>
      </div>
      <div className="seg my-seg" role="group" aria-label="How urgent">
        {([1, 2, 3] as const).map((p) => <button key={p} type="button" className={`p${p}`} aria-pressed={priority === p} onClick={() => setPriority(p)}>{PRI[p]}</button>)}
      </div>
      {err && <div className="err" role="alert">{err}</div>}
    </form>
  );
}

export interface FormTask { id?: string; title: string; note?: string; priority: 1 | 2 | 3; repeat: "once" | "weekly" | "monthly"; day?: number; dueOn?: string; alertDays?: number; top: boolean }
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Add or change a task: what, how urgent, when (a date, no date, every week, every month) and a phone reminder. */
export function MyTaskForm({ task, today }: { task?: FormTask; today: string }) {
  const router = useRouter();
  const { pending, err, run } = useRun();
  const [f, setF] = useState<FormTask>(task ?? { title: "", priority: 2, repeat: "once", dueOn: today, top: false });
  const when = f.repeat !== "once" ? f.repeat : f.dueOn ? "date" : "none";
  const set = (p: Partial<FormTask>) => setF((x) => ({ ...x, ...p }));
  const save = () => run(() => saveMyTask({ title: f.title, note: f.note, priority: f.priority, repeat: f.repeat, day: f.day, dueOn: f.repeat === "once" ? f.dueOn : undefined, alertDays: f.alertDays, top: f.top }, f.id), () => {
    if (f.id) router.push("/owner/day"); else setF({ title: "", priority: 2, repeat: "once", dueOn: today, top: false });
  });
  const canAlert = f.repeat !== "once" || !!f.dueOn;
  return (
    <form id="form" className="card stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <h2 className="h-sec">{f.id ? "Change task" : "Add a task"}</h2>
      <input className="txt wide" style={{ maxWidth: "none", width: "100%" }} maxLength={120} placeholder="What needs doing? e.g. Pay Eastcote rent £5,625" value={f.title} onChange={(e) => set({ title: e.target.value })} aria-label="Task" />
      <div className="seg my-seg" role="group" aria-label="How urgent">
        {([1, 2, 3] as const).map((p) => <button key={p} type="button" className={`p${p}`} aria-pressed={f.priority === p} onClick={() => set({ priority: p })}>{PRI[p]}</button>)}
      </div>
      <div className="seg" role="group" aria-label="When">
        <button type="button" aria-pressed={when === "date"} onClick={() => set({ repeat: "once", day: undefined, dueOn: f.dueOn ?? today })}>On a date</button>
        <button type="button" aria-pressed={when === "none"} onClick={() => set({ repeat: "once", day: undefined, dueOn: undefined, alertDays: undefined })}>No date</button>
        <button type="button" aria-pressed={when === "weekly"} onClick={() => set({ repeat: "weekly", day: f.repeat === "weekly" ? f.day : 1, dueOn: undefined })}>Every week</button>
        <button type="button" aria-pressed={when === "monthly"} onClick={() => set({ repeat: "monthly", day: f.repeat === "monthly" ? f.day : 1, dueOn: undefined })}>Every month</button>
      </div>
      {when === "date" && <input type="date" className="txt" value={f.dueOn} min="2020-01-01" onChange={(e) => set({ dueOn: e.target.value || today })} aria-label="Date" />}
      {when === "weekly" && (
        <div className="seg" role="group" aria-label="Day of the week">
          {WEEKDAYS.map((d, i) => <button key={d} type="button" aria-pressed={f.day === i + 1} onClick={() => set({ day: i + 1 })}>{d}</button>)}
        </div>
      )}
      {when === "monthly" && (
        <label className="row">Day of the month
          <input type="number" className="txt" style={{ width: 90 }} min={1} max={31} value={f.day ?? 1} onChange={(e) => set({ day: Number(e.target.value) })} />
          {(f.day ?? 1) > 28 && <span className="muted">Last day in shorter months</span>}
        </label>
      )}
      {canAlert && (
        <label className="row">Phone reminder
          <select className="txt" style={{ width: "auto" }} value={f.alertDays ?? ""} onChange={(e) => set({ alertDays: e.target.value === "" ? undefined : Number(e.target.value) })}>
            <option value="">None</option>
            <option value="0">On the day</option>
            <option value="1">1 day before (and on the day)</option>
            <option value="2">2 days before (and on the day)</option>
            <option value="3">3 days before (and on the day)</option>
          </select>
        </label>
      )}
      <label className="row"><input type="checkbox" checked={f.top} onChange={(e) => set({ top: e.target.checked })} /> Pin to Top 3</label>
      <textarea className="txt" style={{ width: "100%", maxWidth: "none", height: 70, padding: 10 }} maxLength={500} placeholder="Note (optional)" value={f.note ?? ""} onChange={(e) => set({ note: e.target.value })} aria-label="Note" />
      {err && <div className="err" role="alert">{err}</div>}
      <div className="row">
        {f.id && <Link className="btn ghost" href="/owner/day">Cancel</Link>}
        {f.id && <button type="button" className="btn ghost" disabled={pending} onClick={() => { if (confirm("Stop this task? It comes off your list; what you ticked is kept.")) run(() => stopMyTask(f.id!), () => router.push("/owner/day")); }}>Stop task</button>}
        <button className="btn grow" type="submit" disabled={pending || !f.title.trim()}>{pending ? "Saving…" : f.id ? "Save" : "Add task"}</button>
      </div>
    </form>
  );
}
