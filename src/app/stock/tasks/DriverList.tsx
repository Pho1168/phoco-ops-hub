"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { driverTickAction } from "@/app/actions";
import { Icon } from "@/components/Icon";

export interface DriverStop {
  taskId: string; shop: string; note?: string;
  items: { lineId: string; qty: number; name: string; pack?: string; to: string; note?: string; end?: "got" | "missing" }[];
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));

/** A driver's checklist: tick what's bought (it's then done), or say it couldn't be got (it goes back to the owner). */
export function DriverList({ stops }: { stops: DriverStop[] }) {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [mark, setMark] = useState<Record<string, "got" | "missing">>({});
  const [waiting, setWaiting] = useState<Set<string>>(new Set());
  const [busy, start] = useTransition();
  const timers = useRef<Record<string, { got: boolean; t: ReturnType<typeof setTimeout> }>>({});
  const clear = (lineId: string) => {
    delete timers.current[lineId];
    setWaiting((w) => { const n = new Set(w); n.delete(lineId); return n; });
  };
  const save = (lineId: string, got: boolean) => {
    clear(lineId);
    start(async () => {
      const r = await driverTickAction(lineId, got);
      if (!r.ok) { setErr(r.error); setMark((m) => { const n = { ...m }; delete n[lineId]; return n; }); }
      router.refresh();
    });
  };
  // A tick waits a few seconds with Undo, then is saved (once saved it can't be changed).
  const act = (lineId: string, got: boolean) => {
    setErr("");
    setMark((m) => ({ ...m, [lineId]: got ? "got" : "missing" }));
    setWaiting((w) => new Set([...w, lineId]));
    timers.current[lineId] = { got, t: setTimeout(() => save(lineId, got), 4000) };
  };
  const undo = (lineId: string) => {
    clearTimeout(timers.current[lineId]?.t);
    clear(lineId);
    setMark((m) => { const n = { ...m }; delete n[lineId]; return n; });
  };
  // Leaving the page saves what's still waiting.
  useEffect(() => () => { for (const [id, x] of Object.entries(timers.current)) { clearTimeout(x.t); void driverTickAction(id, x.got); } }, []);
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
                    {waiting.has(i.lineId) && <button type="button" className="btn ghost small" onClick={() => undo(i.lineId)}>Undo</button>}
                    {!end && <button type="button" className="btn ghost small" disabled={busy} onClick={() => act(i.lineId, false)}>Couldn&apos;t get</button>}
                  </div>
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
