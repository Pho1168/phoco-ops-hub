"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { driverTickAction, driverUntickAction } from "@/app/actions";
import { Icon } from "@/components/Icon";

export interface DriverStop {
  taskId: string; shop: string; note?: string;
  items: { lineId: string; qty: number; name: string; pack?: string; to: string; note?: string; end?: "got" | "missing";
    /** Ticked this working day: can be unticked (a mistaken tap) until 05:00. */ canUntick?: boolean;
    /** Where it was bought, when not at this shop. */ boughtAt?: string;
    /** Other shops that also sell it, to tick it as bought there instead. */ alsoAt: { id: string; name: string }[] }[];
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));

/**
 * A driver's checklist: tick what's bought (it's then done), or say it couldn't be got (it goes back to the owner). An
 * item other shops also sell can be ticked as bought at one of them, if that suits the run better. A tick is saved at
 * once and stays on the list, crossed out; Untick puts it back (a mistaken tap) until 05:00.
 */
export function DriverList({ stops }: { stops: DriverStop[] }) {
  const router = useRouter();
  const [err, setErr] = useState("");
  /** Ticks and unticks on their way (shown at once, before the page refreshes). */
  const [mark, setMark] = useState<Record<string, "got" | "missing" | "back">>({});
  const [atName, setAtName] = useState<Record<string, string>>({});
  const [, start] = useTransition();
  // Fresh data from the server: forget what it now shows (a tick still on its way stays marked).
  useEffect(() => {
    const items = new Map(stops.flatMap((s) => s.items.map((i) => [i.lineId, i] as const)));
    setMark((m) => Object.fromEntries(Object.entries(m).filter(([id, v]) => { const i = items.get(id); return !!i && (v === "back" || !i.end); })));
  }, [stops]);
  const forget = (lineId: string) => setMark((m) => { const n = { ...m }; delete n[lineId]; return n; });
  const act = (lineId: string, got: boolean, at?: { id: string; name: string }) => {
    setErr("");
    setMark((m) => ({ ...m, [lineId]: got ? "got" : "missing" }));
    setAtName((a) => { const n = { ...a }; if (at) n[lineId] = at.name; else delete n[lineId]; return n; });
    start(async () => {
      const r = await driverTickAction(lineId, got, at?.id);
      if (!r.ok) { setErr(r.error); forget(lineId); }
      router.refresh();
    });
  };
  const untick = (lineId: string) => {
    setErr("");
    setMark((m) => ({ ...m, [lineId]: "back" }));
    start(async () => {
      const r = await driverUntickAction(lineId);
      if (!r.ok) { setErr(r.error); forget(lineId); }
      router.refresh();
    });
  };
  return (
    <div className="stack">
      {err && <div className="fix" role="alert" style={{ margin: 0 }}>{err}</div>}
      {stops.map((s) => {
        const endOf = (i: DriverStop["items"][number]) => (mark[i.lineId] === "back" ? undefined : mark[i.lineId] ?? i.end);
        const left = s.items.filter((i) => !endOf(i)).length;
        return (
          <section key={s.taskId} className="stock-group" aria-label={s.shop}>
            <div className="stock-group-head">
              <h3 className="grow">{s.shop}</h3>
              <span className={`chip ${left ? "late" : ""}`}>{left ? `${left} to get` : "All done"}</span>
            </div>
            {s.note && <div className="muted" style={{ fontSize: 14 }}>{s.note}</div>}
            {s.items.map((i) => {
              const end = endOf(i);
              const saving = !!mark[i.lineId];
              return (
                <div key={i.lineId} className={`stock-row${end ? " done" : ""}`}>
                  <div className="stock-row-head">
                    <button type="button" className="tick" aria-pressed={end === "got"} aria-label={`Got ${i.name}`} disabled={!!end} onClick={() => act(i.lineId, true)}>
                      {end === "got" && <Icon name="check" />}
                    </button>
                    <span className="stock-qty">{fmt(i.qty)}</span>
                    <span className="grow stack" style={{ gap: 2, minWidth: 0 }}>
                      <span className="strong" style={end ? { textDecoration: "line-through", color: "var(--ink-2)" } : undefined}>{i.name}</span>
                      <span className="muted" style={{ fontSize: 13 }}>{[i.pack, i.to && `for ${i.to}`].filter(Boolean).join(" · ")}</span>
                    </span>
                    {end === "missing" && <span className="chip bad">Couldn&apos;t get</span>}
                    {end === "got" && (i.boughtAt ?? atName[i.lineId]) && <span className="chip">at {i.boughtAt ?? atName[i.lineId]}</span>}
                    {saving && <span className="muted" style={{ fontSize: 13 }}>Saving…</span>}
                    {end && !saving && i.canUntick && <button type="button" className="btn ghost small" aria-label={`Untick ${i.name}`} onClick={() => untick(i.lineId)}>Untick</button>}
                    {!end && <button type="button" className="btn ghost small" onClick={() => act(i.lineId, false)}>Couldn&apos;t get</button>}
                  </div>
                  {!end && i.alsoAt.length > 0 && (
                    <div className="stock-site">
                      <span className="muted">Also sold at {i.alsoAt.map((x) => x.name).join(", ")}</span>
                      <select className="txt" style={{ width: "auto" }} aria-label={`Got ${i.name} at another shop`} value=""
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
