"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { giveNeededToDriver, setNeededAmount, takeBackFromDriver, tickNeededAction } from "@/app/actions";
import { Icon } from "@/components/Icon";

export interface BoardRow {
  productId: string; name: string; pack?: string; qty: number; urgent: boolean; notes: string[]; photoIds: string[];
  sites: { name: string; qty: number }[];
  /** Requests sent without an amount: one is set first. */
  unknown: { requestId: string; site?: string }[];
}
export interface BoardGroup {
  key: string; name: string; method: string; methodLabel: string; production: boolean; pdf: boolean;
  rows: BoardRow[];
  drivers: { taskId: string; name: string; items: { name: string; qty: number }[]; open: number; done: number }[];
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));
/** How long a tick waits (with Undo) before it's saved. */
const UNDO_MS = 4000;

/**
 * The Stock needed checklist. One card per supplier; tick a row when it's ordered or bought (production: sent). A
 * tick waits a few seconds with Undo, then is saved. Shops can be given to a driver; a delivery supplier downloads a PDF.
 */
export function NeededBoard({ groups, drivers }: { groups: BoardGroup[]; drivers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<Record<string, string[]>>({});
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");
  const [busy, start] = useTransition();
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const commit = (key: string) => {
    const ids = pendingRef.current[key] ?? [];
    delete timers.current[key];
    if (!ids.length) return;
    setPending((p) => ({ ...p, [key]: [] }));
    setSaved((s) => new Set([...s, ...ids.map((id) => `${key}|${id}`)]));
    start(async () => {
      const r = await tickNeededAction(key, ids);
      if (!r.ok) {
        setErr(r.error);
        setSaved((s) => new Set([...s].filter((x) => !ids.some((id) => x === `${key}|${id}`))));
      }
      router.refresh();
    });
  };
  const tick = (key: string, ids: string[]) => {
    setErr("");
    setPending((p) => ({ ...p, [key]: [...new Set([...(p[key] ?? []), ...ids])] }));
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => commit(key), UNDO_MS);
  };
  const undo = (key: string, id: string) => setPending((p) => {
    const left = (p[key] ?? []).filter((x) => x !== id);
    if (!left.length) { clearTimeout(timers.current[key]); delete timers.current[key]; }
    return { ...p, [key]: left };
  });
  // Leaving the page saves the ticks still waiting.
  useEffect(() => () => { for (const k of Object.keys(timers.current)) { clearTimeout(timers.current[k]); commit(k); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Fresh data from the server: forget what was saved (those rows have gone).
  useEffect(() => { setSaved(new Set()); }, [groups]);

  const run = (f: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setErr("");
    start(async () => {
      const r = await f();
      if (!r.ok) setErr(r.error);
      router.refresh();
    });
  };

  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  if (!groups.length) {
    return <div className="card muted">Nothing needed right now. When a restaurant sends its stock report, what it asked for shows here, under its supplier.</div>;
  }
  return (
    <div className="stack">
      <p className="muted lead" style={{ margin: 0 }}>
        {total} item{total === 1 ? "" : "s"} asked for, by supplier. Tick each one once it&apos;s ordered or bought; it&apos;s then done. Production items: tick when sent.
      </p>
      {err && <div className="fix" role="alert" style={{ margin: 0 }}>{err}</div>}
      {groups.map((g) => {
        const waiting = pending[g.key] ?? [];
        const tickable = g.rows.filter((r) => r.qty > 0 && !saved.has(`${g.key}|${r.productId}`));
        const notTicked = tickable.filter((r) => !waiting.includes(r.productId));
        return (
          <section key={g.key || "none"} className="stock-group" aria-label={g.name}>
            <div className="stock-group-head">
              <h3 className="grow">{g.name}</h3>
              <span className="chip">{g.production ? "Production" : g.methodLabel}</span>
              {g.rows.length > 0 && <span className="chip late">{g.rows.length}</span>}
            </div>
            {g.rows.length > 0 && (
              <div className="row wrap no-print" style={{ gap: 8 }}>
                {notTicked.length > 1 && <button type="button" className="btn ghost small" disabled={busy} onClick={() => tick(g.key, notTicked.map((r) => r.productId))}>Tick all</button>}
                {g.pdf && tickable.length > 0 && <a className="btn small" href={`/stock/needed/pdf?supplier=${encodeURIComponent(g.key)}`} download><Icon name="print" /> Download PDF</a>}
                {!g.production && g.method === "shop" && tickable.length > 0 && <DriverPick drivers={drivers} busy={busy} onGive={(id) => run(() => giveNeededToDriver(g.key, id))} />}
              </div>
            )}
            {g.rows.map((r) => {
              const id = `${g.key}|${r.productId}`;
              const isWaiting = waiting.includes(r.productId);
              const done = isWaiting || saved.has(id);
              return (
                <div key={r.productId} className={`stock-row${done ? " done" : ""}`}>
                  <div className="stock-row-head">
                    {r.qty > 0 && (
                      <button type="button" className="tick" aria-pressed={done} aria-label={`${done ? "Ticked" : "Tick"} ${r.name}`} disabled={saved.has(id)}
                        onClick={() => (isWaiting ? undo(g.key, r.productId) : tick(g.key, [r.productId]))}>
                        {done && <Icon name="check" />}
                      </button>
                    )}
                    {r.qty > 0 && <span className="stock-qty">{fmt(r.qty)}</span>}
                    <span className="grow stack" style={{ gap: 2, minWidth: 0 }}>
                      <span className="strong" style={done ? { textDecoration: "line-through", color: "var(--ink-2)" } : undefined}>{r.name}</span>
                      {r.pack && <span className="muted" style={{ fontSize: 13 }}>{r.pack}</span>}
                    </span>
                    {r.urgent && !done && <span className="chip bad">Urgent</span>}
                    {isWaiting && <button type="button" className="btn ghost small" onClick={() => undo(g.key, r.productId)}>Undo</button>}
                  </div>
                  {r.sites.length > 0 && <div className="muted" style={{ fontSize: 14 }}>{r.sites.length === 1 ? `For ${r.sites[0].name}` : r.sites.map((s) => `${s.name} ${fmt(s.qty)}`).join(" · ")}</div>}
                  {r.notes.length > 0 && <div style={{ fontSize: 14 }}>&ldquo;{r.notes.join("” · “")}&rdquo;</div>}
                  {r.photoIds.length > 0 && (
                    <div className="row wrap" style={{ gap: 6 }}>
                      {r.photoIds.map((p, i) => <a key={p} className="btn ghost small" href={`/api/media/${p}`} target="_blank" rel="noreferrer"><Icon name="camera" /> Photo{r.photoIds.length > 1 ? ` ${i + 1}` : ""}</a>)}
                    </div>
                  )}
                  {r.unknown.map((u) => <AmountAsk key={u.requestId} site={u.site} busy={busy} onSet={(qty) => run(() => setNeededAmount(u.requestId, qty))} />)}
                </div>
              );
            })}
            {g.drivers.map((d) => (
              <div key={d.taskId} className="stock-row">
                <div className="stock-row-head">
                  <span className="tile-ico" style={{ width: 36, height: 36 }}><Icon name="truck" /></span>
                  <span className="grow strong">With {d.name.split(" ")[0]}: {d.open} item{d.open === 1 ? "" : "s"} to get{d.done ? ` (${d.done} done)` : ""}</span>
                  <button type="button" className="btn ghost small" disabled={busy} onClick={() => run(() => takeBackFromDriver(d.taskId))}>Take back</button>
                </div>
                <div className="muted" style={{ fontSize: 14 }}>{d.items.map((x) => `${fmt(x.qty)} × ${x.name}`).join(" · ")}</div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/** Choose a driver for a shop's list. */
function DriverPick({ drivers, busy, onGive }: { drivers: { id: string; name: string }[]; busy: boolean; onGive: (id: string) => void }) {
  const [id, setId] = useState("");
  if (!drivers.length) return <span className="muted" style={{ fontSize: 13 }}>No drivers yet: add them in the catalogue</span>;
  return (
    <span className="row stock-filter" style={{ gap: 6 }}>
      <select aria-label="Driver" value={id} onChange={(e) => setId(e.target.value)}>
        <option value="">Give to a driver…</option>
        {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <button type="button" className="btn small" disabled={!id || busy} onClick={() => { onGive(id); setId(""); }}>Give list</button>
    </span>
  );
}

/** A request sent without an amount (before amounts were asked for): say how many first. */
function AmountAsk({ site, busy, onSet }: { site?: string; busy: boolean; onSet: (qty: number) => void }) {
  const [v, setV] = useState("");
  const n = Number(v);
  const ok = v.trim() !== "" && Number.isFinite(n) && n > 0 && n <= 9999;
  return (
    <div className="stock-site">
      <span className="chip warn">Amount needed</span>
      <span>{site ? `${site} didn't say how many` : "No amount given"}</span>
      <input className="txt" inputMode="decimal" aria-label="How many" placeholder="How many" value={v} onChange={(e) => setV(e.target.value)} />
      <button type="button" className="btn small" disabled={!ok || busy} onClick={() => onSet(n)}>Set</button>
    </div>
  );
}
