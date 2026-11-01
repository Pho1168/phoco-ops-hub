"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { giveNeededToDriver, moveNeededAction, setNeededAmount, takeBackFromDriver, tickNeededAction, untickNeededAction } from "@/app/actions";
import { Icon } from "@/components/Icon";

export interface BoardRow {
  productId: string; name: string; pack?: string; qty: number; urgent: boolean; notes: string[]; photoIds: string[];
  sites: { name: string; qty: number }[];
  /** Requests sent without an amount: one is set first. */
  unknown: { requestId: string; site?: string }[];
  /** Other suppliers that also sell it (it can be moved to one of them). */
  buyFrom: { id: string; name: string }[];
  /** Every shop that sells it, this card's first ("Loon Fung/Lidl/Aldi/Asda"), when there's more than one. */
  shops?: string;
  /** The latest change of amount today (someone at the restaurant, or the owner), ready to show. */
  changed?: string;
}
export interface BoardGroup {
  key: string; name: string; method: string; methodLabel: string; production: boolean; pdf: boolean;
  rows: BoardRow[];
  drivers: { taskId: string; name: string; items: { name: string; qty: number }[]; open: number; done: number }[];
  /** Ticked off this working day: crossed out, with Untick, until 05:00. */
  ticked: { productId: string; name: string; pack?: string; qty: number; sites: { name: string; qty: number }[]; who: string }[];
  /** Taken off today by someone at a restaurant, ready to show. */
  removed: string[];
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));
const forSites = (sites: { name: string; qty: number }[]) => (sites.length === 1 ? `For ${sites[0].name}` : sites.map((s) => `${s.name} ${fmt(s.qty)}`).join(" · "));

/**
 * The Stock needed checklist. One card per supplier; tick a row when it's ordered or bought (production: sent). A tick
 * is saved at once and the item moves to "Ticked today" on the same card, crossed out, where Untick puts it back (a
 * mistaken tap) until 05:00. Shops can be given to a driver; a delivery supplier downloads a PDF.
 */
export function NeededBoard({ groups, drivers, round }: { groups: BoardGroup[]; drivers: { id: string; name: string }[]; /** The round order page: just the items to tick (no intro, method chip or "Ticked today"). */ round?: boolean }) {
  const router = useRouter();
  /** Rows being ticked or unticked right now (shown at once, before the page refreshes). */
  const [ticking, setTicking] = useState<Set<string>>(new Set());
  const [unticking, setUnticking] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");
  const [busy, start] = useTransition();
  // Fresh data from the server: forget what it now shows (a tick still on its way stays marked).
  useEffect(() => {
    const rows = new Set(groups.flatMap((g) => g.rows.map((r) => `${g.key}|${r.productId}`)));
    const ticked = new Set(groups.flatMap((g) => g.ticked.map((r) => `${g.key}|${r.productId}`)));
    setTicking((s) => new Set([...s].filter((k) => rows.has(k))));
    setUnticking((s) => new Set([...s].filter((k) => ticked.has(k))));
  }, [groups]);

  const tick = (key: string, ids: string[]) => {
    setErr("");
    const keys = ids.map((id) => `${key}|${id}`);
    setTicking((s) => new Set([...s, ...keys]));
    start(async () => {
      const r = await tickNeededAction(key, ids);
      if (!r.ok) { setErr(r.error); setTicking((s) => new Set([...s].filter((x) => !keys.includes(x)))); }
      router.refresh();
    });
  };
  const untick = (key: string, id: string) => {
    setErr("");
    setUnticking((s) => new Set([...s, `${key}|${id}`]));
    start(async () => {
      const r = await untickNeededAction(key, id);
      if (!r.ok) { setErr(r.error); setUnticking((s) => new Set([...s].filter((x) => x !== `${key}|${id}`))); }
      router.refresh();
    });
  };

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
      {!round && <p className="muted lead" style={{ margin: 0 }}>
        {total} item{total === 1 ? "" : "s"} asked for, by supplier. Tick each one once it&apos;s ordered or bought (production: when sent). Ticked items stay at the bottom of the card, crossed out, until 5am: tap Untick if you ticked one by mistake.
      </p>}
      {err && <div className="fix" role="alert" style={{ margin: 0 }}>{err}</div>}
      {groups.map((g) => {
        const tickable = g.rows.filter((r) => r.qty > 0 && !ticking.has(`${g.key}|${r.productId}`));
        const ticked = g.ticked.filter((t) => !unticking.has(`${g.key}|${t.productId}`));
        const count = g.rows.filter((r) => !ticking.has(`${g.key}|${r.productId}`)).length;
        return (
          <section key={g.key || "none"} className="stock-group" aria-label={g.name}>
            <div className="stock-group-head">
              <h3 className="grow">{g.name}</h3>
              {!round && <span className="chip">{g.production ? "Production" : g.methodLabel}</span>}
              {count > 0 && <span className="chip late">{count}</span>}
            </div>
            {tickable.length > 0 && (
              <div className="row wrap no-print" style={{ gap: 8 }}>
                {tickable.length > 1 && <button type="button" className="btn ghost small" disabled={busy} onClick={() => tick(g.key, tickable.map((r) => r.productId))}>Tick all</button>}
                {g.pdf && <a className="btn small" href={`/stock/needed/pdf?supplier=${encodeURIComponent(g.key)}`} download><Icon name="print" /> Download PDF</a>}
                {!g.production && g.method === "shop" && <DriverPick drivers={drivers} busy={busy} onGive={(id) => run(() => giveNeededToDriver(g.key, id))} />}
              </div>
            )}
            {g.rows.map((r) => {
              const done = ticking.has(`${g.key}|${r.productId}`);
              return (
                <div key={r.productId} className={`stock-row${done ? " done" : ""}`}>
                  <div className="stock-row-head">
                    {r.qty > 0 && (
                      <button type="button" className="tick" aria-pressed={done} aria-label={`${done ? "Ticked" : "Tick"} ${r.name}`} disabled={done}
                        onClick={() => tick(g.key, [r.productId])}>
                        {done && <Icon name="check" />}
                      </button>
                    )}
                    {r.qty > 0 && <span className="stock-qty">{fmt(r.qty)}</span>}
                    <span className="grow stack" style={{ gap: 2, minWidth: 0 }}>
                      <span className="strong" style={done ? { textDecoration: "line-through", color: "var(--ink-2)" } : undefined}>{r.name}</span>
                      {r.pack && <span className="muted" style={{ fontSize: 13 }}>{r.pack}</span>}
                      {r.shops && <span className="stock-shops">{r.shops}</span>}
                    </span>
                    {r.urgent && !done && <span className="chip bad">Urgent</span>}
                    {done && <span className="muted" style={{ fontSize: 13 }}>Saving…</span>}
                  </div>
                  {r.sites.length > 0 && <div className="muted" style={{ fontSize: 14 }}>{forSites(r.sites)}</div>}
                  {r.changed && <div className="muted" style={{ fontSize: 13 }}>{r.changed}</div>}
                  {r.notes.length > 0 && <div style={{ fontSize: 14 }}>&ldquo;{r.notes.join("” · “")}&rdquo;</div>}
                  {r.photoIds.length > 0 && (
                    <div className="row wrap" style={{ gap: 6 }}>
                      {r.photoIds.map((p, i) => <a key={p} className="btn ghost small" href={`/api/media/${p}`} target="_blank" rel="noreferrer"><Icon name="camera" /> Photo{r.photoIds.length > 1 ? ` ${i + 1}` : ""}</a>)}
                    </div>
                  )}
                  {r.buyFrom.length > 0 && !done && (
                    <div className="stock-site no-print">
                      <span className="muted">Buying it somewhere else?</span>
                      <select className="txt" style={{ width: "auto" }} aria-label={`Buy ${r.name} from`} value="" disabled={busy}
                        onChange={(e) => { const to = e.target.value; if (to) run(() => moveNeededAction(g.key, r.productId, to)); }}>
                        <option value="">Buy from…</option>
                        {r.buyFrom.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
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
            {g.removed.length > 0 && <div className="muted" style={{ fontSize: 13 }}>{g.removed.join(" · ")}</div>}
            {!round && ticked.length > 0 && (
              <>
                <div className="stock-ticked-head muted">{g.production ? "Sent today" : "Ticked today"}</div>
                {ticked.map((t) => (
                  <div key={t.productId} className="stock-row done">
                    <div className="stock-row-head">
                      <span className="tick on" aria-hidden><Icon name="check" /></span>
                      <span className="stock-qty">{fmt(t.qty)}</span>
                      <span className="grow stack" style={{ gap: 2, minWidth: 0 }}>
                        <span className="strong" style={{ textDecoration: "line-through", color: "var(--ink-2)" }}>{t.name}</span>
                        <span className="muted" style={{ fontSize: 13 }}>{[t.pack, forSites(t.sites), t.who].filter(Boolean).join(" · ")}</span>
                      </span>
                      <button type="button" className="btn ghost small no-print" aria-label={`Untick ${t.name}`} onClick={() => untick(g.key, t.productId)}>Untick</button>
                    </div>
                  </div>
                ))}
              </>
            )}
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
