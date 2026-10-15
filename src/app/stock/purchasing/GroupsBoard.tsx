"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createPurchaseTask } from "@/app/actions";
import { METHODS, type SupplyMethod } from "@/lib/domain/stock";

export interface BoardGroup {
  key: string;
  supplier?: { id: string; name: string; method: SupplyMethod; note?: string; siteId?: string };
  urgent: boolean; estimate: number; unpriced: number;
  team: { id: string; name: string }[];
  rows: {
    productId: string; name: string; size?: string; toPlan: number; urgent: boolean; unavailableAt?: number; estimate?: number;
    price?: { text: string; old: boolean };
    sites: { siteId: string; siteName: string; requests: { id: string; toPlan: number; needsQty: boolean; urgent: boolean; note?: string }[] }[];
  }[];
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));

/**
 * What's waiting, one card per supplier. Every restaurant's request is its own line (ticked, with its quantity), so a
 * combined buy still shows who it's for. "Give to" makes one task of the ticked lines.
 */
export function GroupsBoard({ groups, people, tomorrow }: { groups: BoardGroup[]; people: { id: string; name: string }[]; tomorrow: string }) {
  return <div className="stack" style={{ gap: 14 }}>{groups.map((g) => <Group key={g.key} g={g} people={people} tomorrow={tomorrow} />)}</div>;
}

function Group({ g, people, tomorrow }: { g: BoardGroup; people: { id: string; name: string }[]; tomorrow: string }) {
  const router = useRouter();
  const all = g.rows.flatMap((r) => r.sites.flatMap((s) => s.requests)).filter((x) => !x.needsQty);
  const [pick, setPick] = useState<Record<string, string>>(Object.fromEntries(all.map((x) => [x.id, fmt(x.toPlan)])));
  const [method, setMethod] = useState<SupplyMethod>(g.supplier?.method ?? "shop");
  const [person, setPerson] = useState("");
  const [driver, setDriver] = useState("");
  const [by, setBy] = useState(tomorrow);
  const [urgent, setUrgent] = useState(g.urgent);
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const production = method === "production";
  const chosen = Object.entries(pick).filter(([, v]) => v !== "");
  const who = production ? g.team : people;
  const m = METHODS.find((x) => x.id === method)!;

  const create = () => start(async () => {
    setErr("");
    const r = await createPurchaseTask({ supplierId: g.supplier?.id ?? null, method, assigneeId: person || null, driverId: driver || null, requiredBy: by || null,
      priority: urgent ? "urgent" : "normal", note: note.trim() || undefined, lines: chosen.map(([requestId, qty]) => ({ requestId, qty: Number(qty.replace(",", ".")) })) });
    if (!r.ok) { setErr(r.error); return; }
    setOpen(false);
    router.refresh();
  });

  return (
    <section className="stock-group" aria-label={g.supplier?.name ?? "No supplier"}>
      <div className="stock-group-head">
        <h3 className="grow">{g.supplier?.name ?? "No supplier yet"}</h3>
        {g.urgent && <span className="chip bad">Urgent</span>}
        <span className="chip">{METHODS.find((x) => x.id === g.supplier?.method)?.label ?? "Choose a supplier"}</span>
        {g.estimate > 0 && <span className="chip done">≈ £{(g.estimate / 100).toFixed(2)}{g.unpriced ? ` + ${g.unpriced} unpriced` : ""}</span>}
      </div>
      {g.supplier?.note && <div className="muted" style={{ fontSize: 13 }}>{g.supplier.note}</div>}
      {g.rows.map((r) => (
        <div key={r.productId} className="stock-row">
          <div className="stock-row-head">
            <span className="strong grow">{r.name}{r.size ? ` · ${r.size}` : ""}</span>
            {r.urgent && <span className="chip bad">Out</span>}
            {r.unavailableAt && <span className="chip warn">Wasn&apos;t available last time</span>}
            <span className="stock-qty">{fmt(r.toPlan)}</span>
          </div>
          {r.price && <div className="muted" style={{ fontSize: 12 }}>Last price {r.price.text}{r.price.old ? " (old: check it)" : ""}</div>}
          {r.sites.map((s) => s.requests.map((x) => (
            <div key={x.id} className="stock-site">
              {x.needsQty ? (
                <>
                  <span className="grow">{s.siteName}: <span className="chip warn">quantity not sure</span>{x.note ? ` · ${x.note}` : ""}</span>
                  <Link className="btn ghost small" href={`/stock/request/${x.id}`}>Set quantity</Link>
                </>
              ) : (
                <>
                  <input type="checkbox" aria-label={`Include ${s.siteName}`} checked={pick[x.id] !== undefined && pick[x.id] !== ""}
                    onChange={(e) => setPick({ ...pick, [x.id]: e.target.checked ? fmt(x.toPlan) : "" })} />
                  <span className="grow">{s.siteName}{x.urgent ? " · out" : ""}{x.note ? ` · ${x.note}` : ""}</span>
                  <input className="txt" inputMode="decimal" aria-label={`${s.siteName} quantity`} value={pick[x.id] ?? ""} onChange={(e) => setPick({ ...pick, [x.id]: e.target.value })} />
                  <Link className="muted" href={`/stock/request/${x.id}`} style={{ fontSize: 13 }}>details</Link>
                </>
              )}
            </div>
          )))}
        </div>
      ))}
      {!all.length ? <div className="muted" style={{ fontSize: 13 }}>Set a quantity first, then give it to someone.</div> : !open ? (
        <button type="button" className="btn accent" disabled={!chosen.length} onClick={() => setOpen(true)}>Give {chosen.length} line{chosen.length === 1 ? "" : "s"} to someone</button>
      ) : (
        <div className="card stack" style={{ background: "var(--bg)" }}>
          <div className="seg" role="group" aria-label="How it's got">
            {METHODS.filter((x) => (g.supplier?.method === "production") === (x.id === "production")).map((x) => (
              <button key={x.id} type="button" aria-pressed={method === x.id} onClick={() => { setMethod(x.id); setPerson(""); }}>{x.label}</button>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>{m.hint}</div>
          <div className="row wrap" style={{ gap: 10 }}>
            <label className="stack" style={{ gap: 4, flex: "1 1 180px" }}><span className="strong">{method === "shop" ? "Assign driver" : method === "online" ? "Assign buyer" : method === "delivery" ? "Who orders it" : "Production lead"}</span>
              <select className="txt" value={person} onChange={(e) => setPerson(e.target.value)}><option value="">{production ? "The production team" : "Choose…"}</option>{who.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            {(method === "online" || production) && (
              <label className="stack" style={{ gap: 4, flex: "1 1 180px" }}><span className="strong">{production ? "Driver (optional)" : "Collected by (optional)"}</span>
                <select className="txt" value={driver} onChange={(e) => setDriver(e.target.value)}><option value="">{production ? "Not needed" : "Delivered: nobody"}</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            )}
            <label className="stack" style={{ gap: 4 }}><span className="strong">Needed by</span><input className="txt" type="date" value={by} onChange={(e) => setBy(e.target.value)} /></label>
          </div>
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} style={{ width: 22, height: 22 }} /><span>Urgent</span></label>
          <input className="txt" maxLength={500} placeholder="Instructions (optional), e.g. get the 725ml bottles" value={note} onChange={(e) => setNote(e.target.value)} />
          {!person && !production && <div className="muted" style={{ fontSize: 13 }}>Nobody chosen: the task waits under Needs attention until you give it to someone.</div>}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn accent grow" disabled={pending || !chosen.length} onClick={create}>{pending ? "Saving…" : "Create task"}</button>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
      {err && <div className="err" role="alert">{err}</div>}
    </section>
  );
}
