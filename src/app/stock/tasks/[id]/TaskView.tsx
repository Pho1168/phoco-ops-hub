"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelPurchaseTask, cancelTaskLine, recordStockLine, recordStockTask, updatePurchaseTask } from "@/app/actions";
import { upload } from "@/app/library/fields";
import { Icon } from "@/components/Icon";

export interface TaskLineItem {
  id: string; requestId: string; product: string; link?: string; site: string; qty: number; note?: string;
  end?: { kind: string; qty: number; text?: string; ref?: string }; picked?: number; packed?: number;
  substitute?: string; substituteAnswer?: { ok: boolean; text?: string };
}
interface Task {
  id: string; code: string; method: "shop" | "online" | "delivery" | "production"; state: string; cancelled: boolean; cancelReason?: string; requiredBy?: string; priority: string; note?: string;
  assigneeId?: string; assigneeName?: string; driverId?: string; driverName?: string; link?: string; supplierNote?: string; acknowledged: boolean; ordered?: string;
}
interface LogItem { at: string; who: string; kind: string; qty?: number; pence?: number; text?: string; ref?: string; on?: string; mediaId?: string; product?: string }

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));
const END: Record<string, string> = { bought: "Bought", unavailable: "Not available", dispatched: "Dispatched", line_cancelled: "Taken off" };

/**
 * A task, for whoever has it. Shop trips: each item Bought / Some / Not available, a substitute suggested, receipts
 * and costs. Online and supplier orders: Order placed (with its reference), then what it cost. Production: picked,
 * packed, dispatched with batch and use-by. Being bought is never the end: the restaurant confirms what arrived.
 */
export function TaskView({ task, lines, log, summary, me, people }: {
  task: Task; lines: TaskLineItem[]; log: LogItem[]; summary: string;
  me: { owner: boolean; assignee: boolean; driver: boolean; team: boolean }; people: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const [form, setForm] = useState<{ line: string; kind: string } | undefined>();
  const [val, setVal] = useState({ qty: "", text: "", ref: "", on: "", pounds: "" });
  const [photo, setPhoto] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const production = task.method === "production";
  const acts = !task.cancelled && (me.assignee || me.driver || me.team || me.owner);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) => start(async () => {
    setErr(""); setMsg("");
    const r = await fn();
    if (!r.ok) { setErr(r.error ?? "Something went wrong"); return; }
    setForm(undefined); setVal({ qty: "", text: "", ref: "", on: "", pounds: "" }); setPhoto(undefined);
    if (done) setMsg(done);
    router.refresh();
  });
  const line = (l: TaskLineItem, kind: string, extra: Record<string, unknown> = {}) => run(() => recordStockLine(l.id, { kind, ...extra }));
  const openForm = (l: TaskLineItem, kind: string) => { setForm({ line: l.id, kind }); setVal({ qty: fmt(l.qty), text: "", ref: "", on: "", pounds: "" }); };
  const pickPhoto = async (f?: File) => {
    if (!f) return;
    setUploading(true);
    try { setPhoto((await upload(f, "stock")).id); } catch (x) { setErr((x as Error).message); }
    setUploading(false);
  };
  const open = lines.filter((l) => !l.end);

  return (
    <main className="stack">
      {task.cancelled && <div className="alert bad">Cancelled{task.cancelReason ? `: ${task.cancelReason}` : ""}</div>}
      <section className="card stack" aria-label="The task">
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="strong grow">{task.code} · {task.state}</span>
          {task.priority === "urgent" && <span className="chip bad">Urgent</span>}
          {task.requiredBy && <span className="chip late">Needed by {new Date(`${task.requiredBy}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</span>}
        </div>
        <div className="muted">{task.assigneeName ? `${task.assigneeName}` : production ? "The production team" : "Nobody yet"}{task.driverName ? ` · driver ${task.driverName}` : ""}</div>
        {task.note && <div className="alert" style={{ padding: "10px 12px" }}>{task.note}</div>}
        {task.supplierNote && <div className="muted" style={{ fontSize: 13 }}>{task.supplierNote}</div>}
        {acts && (me.assignee || me.driver) && !task.acknowledged && (
          <button type="button" className="btn accent" disabled={pending} onClick={() => run(() => recordStockTask(task.id, { kind: "acknowledged" }), "Thanks: the owner can see you've got it")}>Got it</button>
        )}
        {(task.method === "online" || task.method === "delivery") && (
          <div className="row wrap" style={{ gap: 8 }}>
            {task.link && <a className="btn ghost small" href={task.link} target="_blank" rel="noopener noreferrer">Open the website ↗</a>}
            <button type="button" className="btn ghost small" onClick={() => { navigator.clipboard?.writeText(summary).then(() => setMsg("Order list copied"), () => setErr("Couldn't copy: select the list below instead")); }}>Copy the order list</button>
          </div>
        )}
        {(task.method === "online" || task.method === "delivery") && <pre className="script-box" style={{ whiteSpace: "pre-wrap", fontSize: 13, margin: 0 }}>{summary}</pre>}
      </section>

      {acts && !production && (task.method === "online" || task.method === "delivery") && task.ordered === undefined && open.length > 0 && (me.assignee || me.owner) && (
        <section className="card stack" aria-label="Order placed">
          <h2 className="h-sec">Order placed?</h2>
          <p className="muted" style={{ margin: 0 }}>Only once the order has really gone through. Opening the website doesn&apos;t count.</p>
          <div className="row wrap" style={{ gap: 8 }}>
            <input className="txt grow" maxLength={80} placeholder="Order reference" value={val.ref} onChange={(e) => setVal({ ...val, ref: e.target.value })} />
            <label className="row" style={{ gap: 6 }}><span>Expected</span><input className="txt" type="date" value={val.on} onChange={(e) => setVal({ ...val, on: e.target.value })} /></label>
          </div>
          <button type="button" className="btn accent" disabled={pending} onClick={() => run(() => recordStockTask(task.id, { kind: "ordered", ref: val.ref || undefined, on: val.on || undefined, allBought: true }), "Order recorded. Each restaurant confirms when it arrives")}>Order placed: all {open.length} item{open.length === 1 ? "" : "s"}</button>
          <div className="muted" style={{ fontSize: 13 }}>Ordered less of something? Record that item first with Some, then place the order.</div>
        </section>
      )}

      <section className="stack" aria-label="Items" style={{ gap: 8 }}>
        <h2 className="h-sec">Items ({open.length} to do)</h2>
        {lines.map((l) => (
          <div key={l.id} className={`stock-line ${l.end ? "done" : ""}`}>
            <div className="row wrap" style={{ gap: 10 }}>
              <span className="stock-qty">{fmt(l.qty)}</span>
              <span className="grow"><span className="strong">{l.product}</span><span className="muted"> → {l.site}</span>{l.note ? <span className="muted"> · {l.note}</span> : null}</span>
              {l.end && <span className={`chip ${l.end.kind === "unavailable" ? "bad" : l.end.kind === "line_cancelled" ? "" : "done"}`}>{END[l.end.kind]}{l.end.kind === "bought" || l.end.kind === "dispatched" ? ` ${fmt(l.end.qty)}` : ""}</span>}
              {l.link && !l.end && <a className="muted" href={l.link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13 }}>product page ↗</a>}
            </div>
            {l.end?.text && <div className="muted" style={{ fontSize: 13 }}>{l.end.text}{l.end.ref ? ` · batch ${l.end.ref}` : ""}</div>}
            {l.end && (l.end.kind === "bought" || l.end.kind === "dispatched") && l.end.qty < l.qty && <div className="muted" style={{ fontSize: 13 }}>{fmt(l.qty - l.end.qty)} still needed: it&apos;s back with the owner for {l.site}.</div>}
            {(l.picked !== undefined || l.packed !== undefined) && !l.end && <div className="muted" style={{ fontSize: 13 }}>{l.picked !== undefined ? `Picked ${fmt(l.picked)}` : ""}{l.packed !== undefined ? ` · packed ${fmt(l.packed)}` : ""}</div>}
            {l.substitute && (
              <div className="alert" style={{ padding: "8px 12px" }}>
                <div className="grow">Substitute suggested: <span className="strong">{l.substitute}</span>{l.substituteAnswer ? ` · ${l.substituteAnswer.ok ? "approved" : "not approved"}${l.substituteAnswer.text ? `: ${l.substituteAnswer.text}` : ""}` : " · waiting for the owner"}</div>
                {me.owner && !l.substituteAnswer && !l.end && (
                  <div className="row" style={{ gap: 6 }}>
                    <button type="button" className="btn small" disabled={pending} onClick={() => line(l, "substitute_ok", { text: "Approved" })}>Approve</button>
                    <button type="button" className="btn ghost small" disabled={pending} onClick={() => line(l, "substitute_no", { text: "Not approved" })}>No</button>
                  </div>
                )}
              </div>
            )}
            {acts && !l.end && form?.line !== l.id && (
              <div className="stock-acts">
                {production ? (
                  <>
                    <button type="button" className="btn ghost" disabled={pending} onClick={() => line(l, "picked", { qty: l.qty })}>{l.picked !== undefined ? "Picked again" : "Picked"}</button>
                    <button type="button" className="btn ghost" disabled={pending} onClick={() => line(l, "packed", { qty: l.picked ?? l.qty })}>Packed</button>
                    <button type="button" className="btn accent" onClick={() => openForm(l, "dispatched")}>Dispatch</button>
                    <button type="button" className="btn ghost" onClick={() => openForm(l, "unavailable")}>Can&apos;t make it</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="btn accent" disabled={pending} onClick={() => line(l, "bought", { qty: l.qty })}>Bought all</button>
                    <button type="button" className="btn ghost" onClick={() => openForm(l, "bought")}>Some</button>
                    <button type="button" className="btn ghost" onClick={() => openForm(l, "unavailable")}>Not available</button>
                    {!l.substitute && <button type="button" className="btn ghost" onClick={() => openForm(l, "substitute")}>Suggest another</button>}
                  </>
                )}
                {me.owner && <button type="button" className="btn ghost" disabled={pending} onClick={() => run(() => cancelTaskLine(l.id, "Taken off by the owner"), "Taken off: it's back to give to someone")}>Take off</button>}
              </div>
            )}
            {form?.line === l.id && (
              <form className="stack" style={{ gap: 8 }} onSubmit={(e) => {
                e.preventDefault();
                const extra: Record<string, unknown> = { text: val.text || undefined };
                if (form.kind === "bought" || form.kind === "dispatched") extra.qty = Number(val.qty.replace(",", "."));
                if (form.kind === "dispatched") { extra.ref = val.ref || undefined; extra.on = val.on || undefined; }
                line(l, form.kind, extra);
              }}>
                {(form.kind === "bought" || form.kind === "dispatched") && (
                  <label className="row wrap" style={{ gap: 8 }}><span className="strong">{form.kind === "bought" ? "How many did you get?" : "How many went out?"}</span>
                    <input className="txt" inputMode="decimal" value={val.qty} onChange={(e) => setVal({ ...val, qty: e.target.value })} style={{ width: 90 }} autoFocus />
                    <span className="muted">of {fmt(l.qty)}</span></label>
                )}
                {form.kind === "dispatched" && (
                  <div className="row wrap" style={{ gap: 8 }}>
                    <input className="txt" maxLength={80} placeholder="Batch (optional)" value={val.ref} onChange={(e) => setVal({ ...val, ref: e.target.value })} />
                    <label className="row" style={{ gap: 6 }}><span>Use by</span><input className="txt" type="date" value={val.on} onChange={(e) => setVal({ ...val, on: e.target.value })} /></label>
                  </div>
                )}
                <input className="txt" maxLength={500} value={val.text} onChange={(e) => setVal({ ...val, text: e.target.value })}
                  placeholder={form.kind === "substitute" ? "What instead? e.g. Lee Kum Kee hoisin 2.27kg" : form.kind === "unavailable" ? "Why? e.g. none on the shelf" : form.kind === "dispatched" ? "Temperature or note (optional), e.g. 3°C" : "Note (optional)"} required={form.kind === "substitute"} />
                {form.kind === "substitute" && <div className="muted" style={{ fontSize: 13 }}>The owner approves it first. Never swap something with different allergens.</div>}
                <div className="row" style={{ gap: 8 }}>
                  <button type="submit" className="btn accent grow" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
                  <button type="button" className="btn ghost" onClick={() => setForm(undefined)}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        ))}
      </section>

      {acts && !production && (me.assignee || me.driver || me.owner) && (
        <section className="card stack" aria-label="Receipt and cost">
          <h2 className="h-sec">Receipt and cost</h2>
          <div className="row wrap" style={{ gap: 8 }}>
            <label className="row" style={{ gap: 6 }}><span>£</span><input className="txt" inputMode="decimal" placeholder="0.00" value={val.pounds} onChange={(e) => setVal({ ...val, pounds: e.target.value })} style={{ width: 110 }} aria-label="What it cost" /></label>
            <label className="btn ghost small" style={{ cursor: uploading ? "progress" : "pointer" }}>
              <Icon name="camera" />{uploading ? "Uploading…" : photo ? "Receipt added · change" : "Photo of the receipt"}
              <input type="file" accept="image/*" capture="environment" hidden disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void pickPhoto(f); }} />
            </label>
            <button type="button" className="btn small" disabled={pending || !val.pounds.trim()} onClick={() => run(() => recordStockTask(task.id, { kind: "cost", pounds: val.pounds, mediaId: photo, text: val.text || undefined }), "Cost recorded")}>Save cost</button>
          </div>
        </section>
      )}

      {acts && (me.driver || me.assignee) && !production && task.method !== "delivery" && (
        <div className="row wrap" style={{ gap: 8 }}>
          {task.method === "online" && me.driver && <button type="button" className="btn ghost" disabled={pending} onClick={() => run(() => recordStockTask(task.id, { kind: "collected" }), "Collected")}>Collected</button>}
          <button type="button" className="btn ghost" disabled={pending} onClick={() => run(() => recordStockTask(task.id, { kind: "delivered" }), "Recorded: the restaurants confirm what arrived")}>Dropped off at the restaurants</button>
        </div>
      )}
      {acts && production && (me.team || me.driver) && open.length === 0 && lines.some((l) => l.end?.kind === "dispatched") && (
        <button type="button" className="btn ghost" disabled={pending} onClick={() => run(() => recordStockTask(task.id, { kind: "delivered" }), "Recorded: the restaurant confirms what arrived")}>Delivered to the restaurant</button>
      )}

      {me.owner && !task.cancelled && <OwnerPanel task={task} people={people} pending={pending} run={run} />}

      {err && <div className="err" role="alert">{err}</div>}
      {msg && <div className="alert good" role="status"><Icon name="check" /><div className="grow">{msg}</div></div>}

      <section className="card stack" aria-label="Log">
        <h2 className="h-sec">Log</h2>
        {!log.length && <div className="muted">Nothing recorded yet.</div>}
        <ul className="stock-timeline">
          {log.map((e, i) => (
            <li key={i}><time>{e.at}</time><span>{e.who} · {e.kind.replace("_", " ")}{e.product ? ` · ${e.product}` : ""}{e.qty !== undefined ? ` · ${fmt(e.qty)}` : ""}{e.pence !== undefined ? ` · £${(e.pence / 100).toFixed(2)}` : ""}{e.ref ? ` · ${e.ref}` : ""}{e.on ? ` · ${e.on}` : ""}{e.text ? ` · ${e.text}` : ""}
              {e.mediaId && <> · <a href={`/api/media/${e.mediaId}`} target="_blank" rel="noreferrer">photo</a></>}</span></li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function OwnerPanel({ task, people, pending, run }: { task: Task; people: { id: string; name: string }[]; pending: boolean; run: (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) => void }) {
  const [person, setPerson] = useState(task.assigneeId ?? "");
  const [driver, setDriver] = useState(task.driverId ?? "");
  const [by, setBy] = useState(task.requiredBy ?? "");
  const [urgent, setUrgent] = useState(task.priority === "urgent");
  const [why, setWhy] = useState("");
  return (
    <section className="card stack" aria-label="Owner">
      <h2 className="h-sec">Reassign or change</h2>
      <div className="row wrap" style={{ gap: 10 }}>
        <label className="stack" style={{ gap: 4, flex: "1 1 160px" }}><span className="strong">{task.method === "shop" ? "Driver" : task.method === "online" ? "Buyer" : task.method === "delivery" ? "Orders it" : "Production lead"}</span>
          <select className="txt" value={person} onChange={(e) => setPerson(e.target.value)}><option value="">Nobody</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        {(task.method === "online" || task.method === "production") && (
          <label className="stack" style={{ gap: 4, flex: "1 1 160px" }}><span className="strong">Driver</span>
            <select className="txt" value={driver} onChange={(e) => setDriver(e.target.value)}><option value="">Nobody</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        )}
        <label className="stack" style={{ gap: 4 }}><span className="strong">Needed by</span><input className="txt" type="date" value={by} onChange={(e) => setBy(e.target.value)} /></label>
      </div>
      <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} style={{ width: 22, height: 22 }} /><span>Urgent</span></label>
      <button type="button" className="btn" disabled={pending} onClick={() => run(() => updatePurchaseTask(task.id, { assigneeId: person || null, driverId: driver || null, requiredBy: by || null, priority: urgent ? "urgent" : "normal" }), "Saved")}>Save changes</button>
      <div className="row wrap" style={{ gap: 8 }}>
        <input className="txt grow" maxLength={200} placeholder="Why cancel the whole task?" value={why} onChange={(e) => setWhy(e.target.value)} aria-label="Reason" />
        <button type="button" className="btn bad small" disabled={pending || !why.trim()} onClick={() => run(() => cancelPurchaseTask(task.id, why), "Cancelled: what wasn't bought is back to give to someone")}>Cancel task</button>
      </div>
    </section>
  );
}
