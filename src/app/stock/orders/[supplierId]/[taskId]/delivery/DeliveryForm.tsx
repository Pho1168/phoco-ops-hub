"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { confirmSupplierDeliveryNow } from "@/app/actions";

type Outcome = "arrived" | "short" | "missing" | "wrong";
interface Line { id: string; name: string; size?: string; qty: number }

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));
const LABEL: Record<Exclude<Outcome, "arrived">, string> = { short: "Short", missing: "Not delivered", wrong: "Wrong or damaged" };

/**
 * What arrived: every line starts at what was ordered; change only what's different and say why. Confirmed once, all
 * lines together. What didn't come goes back to waiting and whoever orders is told.
 */
export function DeliveryForm({ taskId, back, code, lines }: { taskId: string; back: string; code: string; lines: Line[] }) {
  const [arrived, setArrived] = useState<Record<string, string>>(Object.fromEntries(lines.map((l) => [l.id, fmt(l.qty)])));
  const [why, setWhy] = useState<Record<string, Outcome>>({});
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState<number | undefined>();
  const [pending, start] = useTransition();

  const num = (id: string) => { const n = Number((arrived[id] ?? "").replace(",", ".")); return Number.isFinite(n) ? n : NaN; };
  const problem = (l: Line) => num(l.id) < l.qty;
  const problems = lines.filter(problem).length;
  const set = (id: string, v: string) => { setArrived((a) => ({ ...a, [id]: v })); setErr(""); };
  const step = (l: Line, d: number) => set(l.id, fmt(Math.min(l.qty, Math.max(0, (Number.isFinite(num(l.id)) ? num(l.id) : l.qty) + d))));
  const outcome = (l: Line, o: Outcome) => { setWhy((w) => ({ ...w, [l.id]: o })); if (o === "missing") set(l.id, "0"); if (o === "arrived") set(l.id, fmt(l.qty)); };

  const confirm = () => {
    const bad = lines.find((l) => !Number.isFinite(num(l.id)) || num(l.id) < 0 || num(l.id) > l.qty);
    if (bad) { setErr(`${bad.name}: arrived is from 0 to ${fmt(bad.qty)}`); return; }
    start(async () => {
      const r = await confirmSupplierDeliveryNow(taskId, { note: note.trim() || undefined,
        lines: lines.map((l) => ({ lineId: l.id, arrived: num(l.id), outcome: problem(l) ? why[l.id] ?? (num(l.id) === 0 ? "missing" : "short") : "arrived" })) });
      if (!r.ok) { setErr(r.error); return; }
      setDone(r.problems ?? 0);
      window.scrollTo({ top: 0 });
    });
  };

  if (done !== undefined) {
    return (
      <main className="stack">
        <div className="card stack" role="status" style={{ gap: 10 }}>
          <div className="strong" style={{ fontSize: 20 }}>Delivery confirmed</div>
          <div>{done ? `${done} problem${done === 1 ? "" : "s"} recorded. Whoever orders has been told, and it goes back on the next order.` : "Everything arrived."}</div>
          <div className="muted">Temperatures and anything rejected still go on the Goods in checklist.</div>
          <Link className="btn ghost" href={back} style={{ alignSelf: "flex-start" }}>See the order</Link>
        </div>
      </main>
    );
  }

  return (
    <>
      <main className="stack" style={{ paddingBottom: 120 }}>
        <div className="row wrap" style={{ gap: 10 }}>
          <span className="grow">{code} · <b>{lines.length} products</b> ordered</span>
          <button type="button" className="btn ghost small" onClick={() => { setArrived(Object.fromEntries(lines.map((l) => [l.id, fmt(l.qty)]))); setWhy({}); }}>All arrived</button>
        </div>
        <span className="muted lead">Each line starts at what was ordered. Change only what&apos;s different, then put it away: chilled and frozen first.</span>
        {lines.map((l) => {
          const n = num(l.id);
          const short = problem(l);
          const o = why[l.id] ?? (n === 0 ? "missing" : "short");
          return (
            <div key={l.id} className={`del-line ${!short ? "ok" : o === "missing" ? "missing" : "short"}`}>
              <div className="row" style={{ gap: 10 }}>
                <span className="grow"><b>{l.name}</b>{l.size ? <span className="muted"> · {l.size}</span> : null}</span>
                <span className={`chip ${!short ? "done" : o === "missing" ? "bad" : "late"}`}>{Number.isFinite(n) ? fmt(n) : "?"} of {fmt(l.qty)}</span>
              </div>
              <div className="row wrap" style={{ gap: 8 }}>
                <span className="strong">Arrived</span>
                <div className="stepper" role="group" aria-label={`${l.name}: how many arrived`}>
                  <button type="button" aria-label={`One less ${l.name}`} onClick={() => step(l, -1)}>−</button>
                  <input className="txt" inputMode="decimal" aria-label={`${l.name} arrived`} value={arrived[l.id] ?? ""} onChange={(e) => set(l.id, e.target.value)} />
                  <button type="button" aria-label={`One more ${l.name}`} onClick={() => step(l, 1)}>+</button>
                </div>
              </div>
              {short && (
                <div className="row wrap" style={{ gap: 6 }} role="group" aria-label={`${l.name}: what happened`}>
                  {(["short", "missing", "wrong"] as const).map((k) => (
                    <button key={k} type="button" className={`chip ${o === k ? (k === "missing" ? "bad" : "late") : ""}`} aria-pressed={o === k} onClick={() => outcome(l, k)}>{LABEL[k]}</button>
                  ))}
                  <span className="muted">{fmt(l.qty - (Number.isFinite(n) ? n : 0))} didn&apos;t come: back on the next order.</span>
                </div>
              )}
            </div>
          );
        })}
        <label className="stack" style={{ gap: 6 }}>
          <span className="strong">Note for whoever orders (optional)</span>
          <input className="txt" style={{ width: "100%" }} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. driver said brisket comes Monday" />
        </label>
        <span className="muted">Temperatures and anything rejected still go on the Goods in checklist, as now.</span>
      </main>
      <div className="sticky-foot">
        <div className="inner">
          <span className="grow" style={{ fontSize: 13 }}>{err ? <span className="err-text" role="alert">{err}</span> : <span className="muted"><b style={{ color: "var(--ink)" }}>{problems ? `${problems} problem${problems === 1 ? "" : "s"}` : "Everything arrived"}</b></span>}</span>
          <button type="button" className="btn" disabled={pending} onClick={confirm}>{pending ? "Saving…" : "Confirm delivery"}</button>
        </div>
      </div>
    </>
  );
}
