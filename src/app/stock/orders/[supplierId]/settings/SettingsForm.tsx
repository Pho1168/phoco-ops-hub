"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveSupplierOrderSettings } from "@/app/actions";

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
interface Day { cutDow: number; cutHm: string; delDow: number; delHm: string }

/** Order days (cut-off → delivery), the kitchen it delivers to and who orders: saved together. */
export function SettingsForm({ supplierId, supplierName, kitchens, people, start }: {
  supplierId: string; supplierName: string; kitchens: { id: string; name: string; open: boolean }[];
  people: { id: string; name: string; purchaser: boolean; roles: string }[]; start: { deliversTo: string; days: Day[]; orderers: string[] };
}) {
  const router = useRouter();
  const [deliversTo, setDeliversTo] = useState(start.deliversTo);
  const [days, setDays] = useState<Day[]>(start.days);
  const [orderers, setOrderers] = useState<string[]>(start.orderers);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | undefined>();
  const [pending, run] = useTransition();
  const setDay = (i: number, patch: Partial<Day>) => setDays((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const free = [0, 1, 2, 3, 4, 5, 6].find((n) => !days.some((d) => d.cutDow === n));

  const save = () => run(async () => {
    setMsg(undefined);
    const r = await saveSupplierOrderSettings(supplierId, { deliversTo: deliversTo || null, days, orderers });
    setMsg(r.ok ? { ok: true, text: "Saved" } : { ok: false, text: r.error });
    if (r.ok) router.refresh();
  });

  return (
    <div className="cols two">
      <section className="card stack" style={{ gap: 14 }} aria-label="Order days">
        <h2 className="grp-h">Order days</h2>
        <span className="muted lead">UK time. The app works out British Summer Time by itself.</span>
        {days.map((d, i) => (
          <div key={i} className="row wrap" style={{ gap: 8, background: "var(--bg)", borderRadius: 14, padding: "12px 14px" }}>
            <label className="muted" htmlFor={`cut${i}`} style={{ fontWeight: 600 }}>Order by</label>
            <select id={`cut${i}`} className="txt" value={d.cutDow} onChange={(e) => setDay(i, { cutDow: Number(e.target.value) })}>
              {DOW.map((n, k) => <option key={k} value={k}>{n}</option>)}
            </select>
            <input className="txt" style={{ width: 96 }} type="time" aria-label="Cut-off time" value={d.cutHm} onChange={(e) => setDay(i, { cutHm: e.target.value })} />
            <span className="strong">→ delivered</span>
            <select className="txt" aria-label="Delivery day" value={d.delDow} onChange={(e) => setDay(i, { delDow: Number(e.target.value) })}>
              {DOW.map((n, k) => <option key={k} value={k}>{n}</option>)}
            </select>
            <input className="txt" style={{ width: 96 }} type="time" aria-label="Delivery time" value={d.delHm} onChange={(e) => setDay(i, { delHm: e.target.value })} />
            <button type="button" className="btn ghost small" style={{ marginLeft: "auto" }} onClick={() => setDays((ds) => ds.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        {free !== undefined && <button type="button" className="btn ghost small" style={{ alignSelf: "flex-start" }}
          onClick={() => setDays((ds) => [...ds, { cutDow: free, cutHm: "20:00", delDow: (free + 1) % 7, delHm: "08:00" }])}>+ Add an order day</button>}
        <label className="stack" style={{ gap: 6 }}>
          <span className="strong">Delivers to</span>
          <select className="txt" value={deliversTo} onChange={(e) => setDeliversTo(e.target.value)}>
            <option value="">Each restaurant (no order days)</option>
            {kitchens.map((k) => <option key={k.id} value={k.id}>{k.name} production kitchen{k.open ? "" : " (closed)"}</option>)}
          </select>
          <span className="muted">Delivered to a kitchen: the restaurants ask the kitchen for its products, and only those marked “restaurants can order it” show at the restaurants.</span>
        </label>
        <span className="muted">The count is due at the kitchen&apos;s close on each order day, on the closers&apos; shift screen.</span>
      </section>
      <aside className="aside panel stack" aria-label="Who orders">
        <h2 className="grp-h">Who orders from {supplierName}</h2>
        <span className="muted lead">They see the order, set par levels, generate and place it. Owners always can.</span>
        <div className="stack" style={{ gap: 6 }}>
          {people.map((p) => (
            <label key={p.id} className="row" style={{ gap: 10, background: "var(--surface)", borderRadius: 12, padding: "10px 12px" }}>
              <input type="checkbox" checked={orderers.includes(p.id)} onChange={(e) => setOrderers((o) => (e.target.checked ? [...o, p.id] : o.filter((x) => x !== p.id)))} />
              <span className="grow"><b>{p.name}</b> <span className="muted">· {p.roles}{p.purchaser ? " · purchaser" : ""}</span></span>
            </label>
          ))}
        </div>
        {msg && <div className={msg.ok ? "muted" : "err"} role={msg.ok ? "status" : "alert"}>{msg.text}</div>}
        <div className="row wrap" style={{ gap: 8 }}>
          <button type="button" className="btn" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save"}</button>
          {start.days.length > 0 && start.deliversTo && <Link className="btn ghost" href={`/stock/orders/${supplierId}`}>Open the order</Link>}
        </div>
      </aside>
    </div>
  );
}
