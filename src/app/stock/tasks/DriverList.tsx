"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { driverTickAction } from "@/app/actions";
import { Icon } from "@/components/Icon";

export interface DriverStop {
  taskId: string; shop: string; note?: string;
  items: { lineId: string; qty: number; name: string; pack?: string; to: string; note?: string; end?: "got" | "missing";
    /** Where it was bought, when not at this shop. */ boughtAt?: string;
    /** Other shops that also sell it, to tick it as bought there instead. */ alsoAt: { id: string; name: string }[] }[];
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));

/**
 * A driver's checklist: tick what's bought (it's then done), or say it couldn't be got (it goes back to the owner). An
 * item other shops also sell can be ticked as bought at one of them, if that suits the run better.
 */
export function DriverList({ stops }: { stops: DriverStop[] }) {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [mark, setMark] = useState<Record<string, "got" | "missing">>({});
  const [waiting, setWaiting] = useState<Set<string>>(new Set());
  const [atName, setAtName] = useState<Record<string, string>>({});
  const [busy, start] = useTransition();
  const timers = useRef<Record<string, { got: boolean; at?: string; t: ReturnType<typeof setTimeout> }>>({});
  const clear = (lineId: string) => {
    delete timers.current[lineId];
    setWaiting((w) => { const n = new Set(w); n.delete(lineId); return n; });
  };
  const save = (lineId: string, got: boolean, at?: string) => {
    clear(lineId);
    start(async () => {
      const r = await driverTickAction(lineId, got, at);
      if (!r.ok) { setErr(r.error); setMark((m) => { const n = { ...m }; delete n[lineId]; return n; }); }
      router.refresh();
    });
  };
  // A tick waits a few seconds with Undo, then is saved (once saved it can't be changed).
  const act = (lineId: string, got: boolean, at?: { id: string; name: string }) => {
    setErr("");
    setMark((m) => ({ ...m, [lineId]: got ? "got" : "missing" }));
    setAtName((a) => { const n = { ...a }; if (at) n[lineId] = at.name; else delete n[lineId]; return n; });
    setWaiting((w) => new Set([...w, lineId]));
    timers.current[lineId] = { got, at: at?.id, t: setTimeout(() => save(lineId, got, at?.id), 4000) };
  };
  const undo = (lineId: string) => {
    clearTimeout(timers.current[lineId]?.t);
    clear(lineId);
    setMark((m) => { const n = { ...m }; delete n[lineId]; return n; });
    setAtName((a) => { const n = { ...a }; delete n[lineId]; return n; });
  };
  // Leaving the page saves what's still waiting.
  useEffect(() => () => { for (const [id, x] of Object.entries(timers.current)) { clearTimeout(x.t); void driverTickAction(id, x.got, x.at); } }, []);
  return (
    <div className="stack">
      {err && <div className="fix" role="alert" style={{ margin: 0 }}>{err}</div>}
      {stops.map((s) => {
        const left = s.items.filter((i) => !(i.end ?? mark[i.lineId])).length;
        return (
          <section key={s.taskId} className="stock-group" aria-label={s.shop}>
            <div className="stock-group-head">
              <h3 className="grow">{s.shop}</h3>
              <span className={`chip ${left ? "late" : ""}`}>{left ? `${left} to get` : "All done"}</span>
            </div>
            {s.note && <div className="muted" style={{ fontSize: 14 }}>{s.note}</div>}
            {s.items.map((i) => {
              const end = i.end ?? mark[i.lineId];
              return (
                <div key={i.lineId} className={`stock-row${end ? " done" : ""}`}>
                  <div className="stock-row-head">
                    <button type="button" className="tick" aria-pressed={end === "got"} aria-label={`Got ${i.name}`} disabled={!!end || busy} onClick={() => act(i.lineId, true)}>
                      {end === "got" && <Icon name="check" />}
                    </button>
                    <span className="stock-qty">{fmt(i.qty)}</span>
                    <span className="grow stack" style={{ gap: 2, minWidth: 0 }}>
                      <span className="strong" style={end ? { textDecoration: "line-through", color: "var(--ink-2)" } : undefined}>{i.name}</span>
                      <span className="muted" style={{ fontSize: 13 }}>{[i.pack, i.to && `for ${i.to}`].filter(Boolean).join(" · ")}</span>
                    </span>
                    {end === "missing" && <span className="chip bad">Couldn&apos;t get</span>}
                    {end === "got" && (i.boughtAt ?? atName[i.lineId]) && <span className="chip">at {i.boughtAt ?? atName[i.lineId]}</span>}
                    {waiting.has(i.lineId) && <button type="button" className="btn ghost small" onClick={() => undo(i.lineId)}>Undo</button>}
                    {!end && <button type="button" className="btn ghost small" disabled={busy} onClick={() => act(i.lineId, false)}>Couldn&apos;t get</button>}
                  </div>
                  {!end && i.alsoAt.length > 0 && (
                    <div className="stock-site">
                      <span className="muted">Also sold at {i.alsoAt.map((x) => x.name).join(", ")}</span>
                      <select className="txt" style={{ width: "auto" }} aria-label={`Got ${i.name} at another shop`} value="" disabled={busy}
                        onChange={(e) => { const at = i.alsoAt.find((x) => x.id === e.target.value); if (at) act(i.lineId, true, at); }}>
                        <option value="">Got it at…</option>
                        {i.alsoAt.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                    </div>
                  )}
                  {i.note && <div style={{ fontSize: 14 }}>&ldquo;{i.note}&rdquo;</div>}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
