"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addEquipment, retireEquipment, updateEquipment } from "@/app/actions";
import { EQUIPMENT_KINDS, type EquipmentKind } from "@/lib/domain/equipment";
import type { SiteId } from "@/lib/domain/types";

export interface EquipmentFields { id?: string; name: string; kind: EquipmentKind; location: string; makeModel: string; serial: string; serviceEveryMonths: number | null; serviceContact: string; instructions: string }

const EMPTY: EquipmentFields = { name: "", kind: "fridge", location: "", makeModel: "", serial: "", serviceEveryMonths: null, serviceContact: "", instructions: "" };

/** Add a piece of kit to the register, or change its details. Managers of the site. */
export function EquipmentForm({ siteId, item, today }: { siteId: SiteId; item?: EquipmentFields; today?: string }) {
  const router = useRouter();
  const [f, setF] = useState<EquipmentFields>(item ?? EMPTY);
  const [lastService, setLastService] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [confirmRetire, setConfirmRetire] = useState(false);
  const [pending, start] = useTransition();
  const set = <K extends keyof EquipmentFields>(k: K, v: EquipmentFields[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = () => start(async () => {
    setErr(""); setMsg("");
    const input = { name: f.name, kind: f.kind, location: f.location, makeModel: f.makeModel, serial: f.serial, serviceEveryMonths: f.serviceEveryMonths, serviceContact: f.serviceContact, instructions: f.instructions };
    const r = item?.id ? await updateEquipment(item.id, input) : await addEquipment(siteId, input, lastService || undefined);
    if (!r.ok) { setErr(r.error); return; }
    if (!item?.id) { setF(EMPTY); setLastService(""); setMsg(`${f.name} added.`); } else setMsg("Saved.");
    router.refresh();
  });
  const retire = () => start(async () => {
    const r = await retireEquipment(item!.id!);
    if (!r.ok) { setErr(r.error); return; }
    router.refresh();
  });

  return (
    <form className="stack" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); save(); }} aria-label={item?.id ? "Edit equipment" : "Add equipment"}>
      <div className="row wrap" style={{ gap: 10 }}>
        <label className="stack grow" style={{ gap: 4 }}><span className="muted">Name</span>
          <input id="eq-name" className="txt wide" maxLength={60} placeholder="e.g. Walk-in fridge, Fryer 2" value={f.name} onChange={(e) => set("name", e.target.value)} required /></label>
        <label className="stack" style={{ gap: 4 }}><span className="muted">Kind</span>
          <select id="eq-kind" value={f.kind} onChange={(e) => set("kind", e.target.value as EquipmentKind)}>
            {EQUIPMENT_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select></label>
      </div>
      <div className="row wrap" style={{ gap: 10 }}>
        <input className="txt wide" maxLength={60} placeholder="Where it is, e.g. Kitchen, back wall" value={f.location} onChange={(e) => set("location", e.target.value)} aria-label="Location" />
        <input className="txt wide" maxLength={80} placeholder="Make and model (optional)" value={f.makeModel} onChange={(e) => set("makeModel", e.target.value)} aria-label="Make and model" />
        <input className="txt wide" maxLength={60} placeholder="Serial number (optional)" value={f.serial} onChange={(e) => set("serial", e.target.value)} aria-label="Serial number" />
      </div>
      <div className="row wrap" style={{ gap: 10, alignItems: "flex-end" }}>
        <label className="stack" style={{ gap: 4 }}><span className="muted">Service every (months)</span>
          <input id="eq-every" className="txt" style={{ width: 120 }} type="number" min={1} max={60} inputMode="numeric" placeholder="e.g. 6" value={f.serviceEveryMonths ?? ""}
            onChange={(e) => set("serviceEveryMonths", e.target.value ? Number(e.target.value) : null)} /></label>
        {!item?.id && (
          <label className="stack" style={{ gap: 4 }}><span className="muted">Last serviced (if known)</span>
            <input id="eq-last" className="txt" type="date" max={today} value={lastService} onChange={(e) => setLastService(e.target.value)} /></label>
        )}
        <input className="txt wide grow" maxLength={200} placeholder="Who services it: company and phone" value={f.serviceContact} onChange={(e) => set("serviceContact", e.target.value)} aria-label="Service contact" />
      </div>
      <textarea className="txt wide" style={{ maxWidth: "none", height: 80, padding: 10 }} maxLength={1000} placeholder="How to use or clean it (shown when someone scans the label). Optional"
        value={f.instructions} onChange={(e) => set("instructions", e.target.value)} aria-label="Instructions" />
      {err && <div className="err" role="alert">{err}</div>}
      {msg && <div className="alert good" role="status"><div className="strong" style={{ fontSize: 14 }}>{msg}</div></div>}
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn accent grow" type="submit" disabled={pending}>{pending ? "Saving…" : item?.id ? "Save changes" : "Add equipment"}</button>
        {item?.id && !confirmRetire && <button type="button" className="btn ghost" onClick={() => setConfirmRetire(true)}>Take off the register</button>}
        {item?.id && confirmRetire && (
          <span className="row wrap" style={{ gap: 6 }}>
            <span className="muted">Sold, replaced or scrapped? Its history is kept.</span>
            <button type="button" className="btn ghost small" onClick={() => setConfirmRetire(false)}>Keep</button>
            <button type="button" className="btn small" style={{ background: "var(--bad)", color: "var(--bad-ink-on)" }} disabled={pending} onClick={retire}>Take it off</button>
          </span>
        )}
      </div>
    </form>
  );
}
