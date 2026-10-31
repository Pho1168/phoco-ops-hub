"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveCleaningJob, setCleaningJobActiveAction } from "@/app/actions";

type Area = "FOH" | "BOH" | "PROD";
type Per = "week" | "month" | "every";
interface Job { id: string; name: string; area: Area; per: Per; times: number; everyMonths?: number; firstDue?: string; active: boolean }
interface Draft { name: string; area: Area; per: Per; times: number; everyMonths: number; firstDue: string }

const AREA: Record<Area, string> = { FOH: "Front of house", BOH: "Kitchen", PROD: "Production" };
const often = (j: Pick<Job, "per" | "times" | "everyMonths" | "firstDue">) =>
  j.per === "every" ? `Every ${j.everyMonths} months${j.firstDue ? ` · first due ${new Date(`${j.firstDue}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}`
    : `${j.times === 1 ? "Once" : j.times === 2 ? "Twice" : `${j.times} times`} a ${j.per}`;
const toDraft = (j?: Job, area?: Area): Draft => ({ name: j?.name ?? "", area: j?.area ?? area ?? "BOH", per: j?.per ?? "week", times: j?.times ?? 1, everyMonths: j?.everyMonths ?? 6, firstDue: j?.firstDue ?? "" });

/** The owner's table of cleaning jobs at one site: add, change, take off, put back. */
export function CleaningEditor({ siteId, siteName, areas, jobs }: { siteId: string; siteName: string; areas: Area[]; jobs: Job[] }) {
  const router = useRouter();
  const [edit, setEdit] = useState<string | null>(null); // a job's id, "new", or nothing
  const [draft, setDraft] = useState<Draft>(toDraft(undefined, areas[0]));
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [busy, start] = useTransition();
  const on = jobs.filter((j) => j.active), off = jobs.filter((j) => !j.active);

  const open = (j?: Job) => { setMsg(undefined); setEdit(j ? j.id : "new"); setDraft(toDraft(j, areas[0])); };
  const save = () => start(async () => {
    const r = await saveCleaningJob(edit === "new" ? null : edit, siteId, { ...draft, everyMonths: draft.per === "every" ? draft.everyMonths : null, firstDue: draft.per === "every" ? draft.firstDue : null });
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
    setMsg({ ok: true, text: edit === "new" ? `Added "${draft.name.trim()}" to ${siteName}'s board.` : "Saved." });
    setEdit(null); router.refresh();
  });
  const toggle = (j: Job) => start(async () => {
    const r = await setCleaningJobActiveAction(j.id, !j.active);
    setMsg(r.ok ? { ok: true, text: j.active ? `"${j.name}" taken off the board.` : `"${j.name}" is back on the board.` } : { ok: false, text: r.error });
    router.refresh();
  });

  const form = (
    <tr className="clean-edit">
      <td><input className="txt" style={{ width: "100%", maxWidth: "none" }} aria-label="Job" placeholder="e.g. Grease traps" maxLength={120} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus /></td>
      <td>
        <select aria-label="Who does it" value={draft.area} onChange={(e) => setDraft({ ...draft, area: e.target.value as Area })}>
          {areas.map((a) => <option key={a} value={a}>{AREA[a]}</option>)}
        </select>
      </td>
      <td>
        <div className="row wrap" style={{ gap: 6 }}>
          <select aria-label="How often" value={draft.per} onChange={(e) => setDraft({ ...draft, per: e.target.value as Per })}>
            <option value="week">A week</option><option value="month">A month</option><option value="every">Every few months</option>
          </select>
          {draft.per !== "every"
            ? <label className="row" style={{ gap: 4 }}><input className="txt" type="number" min={1} max={7} style={{ width: 64 }} aria-label="Times" value={draft.times} onChange={(e) => setDraft({ ...draft, times: Number(e.target.value) })} /><span className="muted">time{draft.times === 1 ? "" : "s"}</span></label>
            : <>
                <label className="row" style={{ gap: 4 }}><span className="muted">every</span><input className="txt" type="number" min={1} max={24} style={{ width: 64 }} aria-label="Months" value={draft.everyMonths} onChange={(e) => setDraft({ ...draft, everyMonths: Number(e.target.value) })} /><span className="muted">months, first due</span></label>
                <input className="txt" type="date" aria-label="First due" style={{ width: 160 }} value={draft.firstDue} onChange={(e) => setDraft({ ...draft, firstDue: e.target.value })} />
              </>}
        </div>
      </td>
      <td className="clean-actions">
        <button type="button" className="btn small" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className="btn ghost small" disabled={busy} onClick={() => setEdit(null)}>Cancel</button>
      </td>
    </tr>
  );

  const row = (j: Job) => edit === j.id ? <FormRow key={j.id}>{form}</FormRow> : (
    <tr key={j.id} className={j.active ? "" : "clean-off"}>
      <th scope="row" className="strong">{j.name}</th>
      <td>{AREA[j.area]}</td>
      <td>{often(j)}</td>
      <td className="clean-actions">
        {j.active && <button type="button" className="btn ghost small" disabled={busy} onClick={() => open(j)}>Edit</button>}
        <button type="button" className={`btn small ${j.active ? "ghost" : ""}`} disabled={busy} onClick={() => toggle(j)}>{j.active ? "Take off" : "Put back"}</button>
      </td>
    </tr>
  );

  return (
    <section className="card stack" aria-label={`${siteName} cleaning jobs`}>
      <div className="row wrap" style={{ gap: 8 }}>
        <h2 className="h-sec grow" style={{ margin: 0 }}>On the board ({on.length})</h2>
        <button type="button" className="btn accent small" disabled={busy || edit === "new"} onClick={() => open()}>Add a job</button>
      </div>
      {msg && <div className={msg.ok ? "alert good" : "err"} role={msg.ok ? "status" : "alert"}>{msg.text}</div>}
      <div className="clean-wrap">
        <table className="clean-table">
          <thead><tr><th scope="col">Job</th><th scope="col">Who does it</th><th scope="col">How often</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {edit === "new" && form}
            {on.map(row)}
            {on.length === 0 && edit !== "new" && <tr><td colSpan={4} className="muted">No jobs on {siteName}&apos;s board. Add one, or put one back from below.</td></tr>}
          </tbody>
        </table>
      </div>
      {off.length > 0 && (
        <details>
          <summary className="strong" style={{ cursor: "pointer" }}>Taken off ({off.length})</summary>
          <div className="clean-wrap" style={{ marginTop: 8 }}>
            <table className="clean-table"><tbody>{off.map(row)}</tbody></table>
          </div>
        </details>
      )}
    </section>
  );
}

function FormRow({ children }: { children: React.ReactNode }) { return <>{children}</>; }
