"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveProductionTargets } from "@/app/actions";

type State = "make" | "ok" | "not_counted" | "no_target";
interface Row { id: string; name: string; size?: string; category?: string; onHand?: number; target?: number; toSend: number; make?: number; state: State }

const fmt = (n: number | undefined) => (n === undefined ? "–" : Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));
const parse = (v: string): number | null | "bad" => {
  if (v.trim() === "") return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : "bad";
};
const LABEL: Record<State, string> = { make: "Make", ok: "Enough", not_counted: "Not counted", no_target: "No target" };

/** The plan as a table, to make first. "Set targets" turns the target column into boxes; saving adds only what changed. */
export function PlanTable({ siteId, rows }: { siteId: string; rows: Row[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | undefined>();
  const [pending, start] = useTransition();

  const begin = () => { setDraft(Object.fromEntries(rows.map((r) => [r.id, r.target === undefined ? "" : fmt(r.target)]))); setEditing(true); setMsg(undefined); };
  const save = () => {
    const bad = rows.find((r) => parse(draft[r.id] ?? "") === "bad");
    if (bad) { setMsg({ ok: false, text: `${bad.name}: a number from 0, or leave it empty for no target` }); return; }
    start(async () => {
      const r = await saveProductionTargets(siteId, rows.map((x) => ({ productId: x.id, qty: parse(draft[x.id] ?? "") as number | null })));
      if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
      setEditing(false);
      setMsg({ ok: true, text: r.changed ? `${r.changed} target${r.changed === 1 ? "" : "s"} saved` : "No targets changed" });
      router.refresh();
    });
  };

  return (
    <section className="card stack" style={{ gap: 10 }} aria-label="What to make">
      <div className="row wrap" style={{ gap: 8 }}>
        <h2 className="grp-h grow">What to make</h2>
        {editing ? (
          <>
            <button type="button" className="btn ghost small" disabled={pending} onClick={() => { setEditing(false); setMsg(undefined); }}>Cancel</button>
            <button type="button" className="btn small" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save targets"}</button>
          </>
        ) : (
          <button type="button" className="btn ghost small" onClick={begin}>Set targets</button>
        )}
      </div>
      {msg && <div className={msg.ok ? "muted" : "err"} role={msg.ok ? "status" : "alert"}>{msg.text}</div>}
      {editing && <div className="muted lead">The level you want on the shelf after the van has gone, in each item&apos;s unit. Leave it empty for no target.</div>}
      <div className="plan-scroll">
        <table className="rec plan-table">
          <thead>
            <tr><th>Item</th><th className="plan-n">On shelf</th><th className="plan-n">Target</th><th className="plan-n">To send</th><th className="plan-n">To make</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.state === "make" ? "warn" : undefined}>
                <td><span className="strong">{r.name}</span>{r.size ? <span className="muted"> · {r.size}</span> : null}</td>
                <td className="plan-n">{fmt(r.onHand)}</td>
                <td className="plan-n">
                  {editing
                    ? <input className="txt plan-target" inputMode="decimal" aria-label={`Target for ${r.name}`} value={draft[r.id] ?? ""} placeholder="none" onChange={(e) => setDraft((d) => ({ ...d, [r.id]: e.target.value }))} />
                    : fmt(r.target)}
                </td>
                <td className="plan-n">{r.toSend ? fmt(r.toSend) : "–"}</td>
                <td className="plan-n">
                  {r.state === "make"
                    ? <span className="stock-qty">{fmt(r.make)}</span>
                    : <span className={`chip ${r.state === "not_counted" ? "warn" : r.state === "ok" ? "done" : ""}`}>{LABEL[r.state]}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <div className="muted">No production products in the catalogue for this kitchen yet.</div>}
    </section>
  );
}
