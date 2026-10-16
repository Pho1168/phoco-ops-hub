"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { generateSupplierOrderNow, saveSupplierPars } from "@/app/actions";

type Group = "Meat" | "Vegetables" | "Other";
type RowState = "order" | "enough" | "not_counted" | "no_par";
interface Row {
  id: string; name: string; size?: string; group: Group; onHand?: number; par?: number; toSend: number;
  reported: { qty: number; unsure: number; names: string[] }; suggested?: number; state: RowState; start?: number;
}

const GROUPS: Group[] = ["Meat", "Vegetables", "Other"];
const fmt = (n: number | undefined) => (n === undefined ? "–" : Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));
const parse = (v: string | undefined): number | null | "bad" => {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : "bad";
};
function load(key: string): Record<string, string> | undefined {
  try { const raw = sessionStorage.getItem(key); return raw ? (JSON.parse(raw) as Record<string, string>) : undefined; } catch { return undefined; }
}
function keep(key: string, v: Record<string, string>) { try { sessionStorage.setItem(key, JSON.stringify(v)); } catch { /* storage blocked: kept on screen only */ } }
function forget(key: string) { try { sessionStorage.removeItem(key); } catch { /* nothing kept */ } }

/**
 * The order: every product of the supplier in meat / vegetables / other, with the order box starting at the
 * suggestion. "Set par levels" turns the par column into boxes. Generate makes the order for this delivery, once.
 */
export function OrderBoard({ supplierId, siteName, roundAt, storeKey, rows }: { supplierId: string; siteName: string; roundAt?: number; storeKey: string; rows: Row[] }) {
  const router = useRouter();
  const start = useMemo(() => Object.fromEntries(rows.map((r) => [r.id, r.start === undefined ? "" : fmt(r.start)])), [rows]);
  const [qty, setQty] = useState<Record<string, string>>(start);
  const [all, setAll] = useState(false);
  const [parEdit, setParEdit] = useState<Record<string, string> | undefined>();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | undefined>();
  const [note, setNote] = useState("");
  const [pending, run] = useTransition();
  const ready = useRef(false);

  // What you typed is kept in this tab until the order is made.
  useEffect(() => { const k = load(storeKey); if (k) setQty((q) => ({ ...q, ...k })); ready.current = true; }, [storeKey]);
  useEffect(() => { if (ready.current) keep(storeKey, qty); }, [qty, storeKey]);

  const editable = roundAt !== undefined;
  const changed = (r: Row) => (qty[r.id] ?? "") !== (r.start === undefined ? "" : fmt(r.start));
  const ordering = rows.filter((r) => { const n = parse(qty[r.id]); return typeof n === "number" && n > 0; });
  const needsLook = (r: Row) => r.state === "order" || r.state === "not_counted" || r.onHand === 0 || r.reported.qty > 0 || r.reported.unsure > 0 || changed(r) || (parse(qty[r.id]) ?? 0) !== 0;
  const shown = all || parEdit ? rows : rows.filter(needsLook);
  const missingQty = rows.filter((r) => r.state === "not_counted" && (r.reported.qty > 0 || r.reported.unsure > 0) && !qty[r.id]?.trim()).length;

  const generate = () => {
    setMsg(undefined);
    const bad = rows.find((r) => parse(qty[r.id]) === "bad");
    if (bad) { setMsg({ ok: false, text: `${bad.name}: a number, or leave it empty` }); return; }
    if (!ordering.length) { setMsg({ ok: false, text: "Nothing to order yet: give at least one product a quantity" }); return; }
    run(async () => {
      const r = await generateSupplierOrderNow(supplierId, { roundAt, note: note.trim() || undefined, lines: rows.map((x) => ({ productId: x.id, qty: (parse(qty[x.id]) as number | null) ?? null })) });
      if (!r.ok || !r.id) { setMsg({ ok: false, text: r.ok ? "Something went wrong" : r.error }); return; }
      forget(storeKey);
      router.push(`/stock/orders/${supplierId}/${r.id}`);
    });
  };
  const savePars = () => {
    if (!parEdit) return;
    const bad = rows.find((r) => parse(parEdit[r.id]) === "bad");
    if (bad) { setMsg({ ok: false, text: `${bad.name}: a par level from 0, or leave it empty for none` }); return; }
    run(async () => {
      const r = await saveSupplierPars(supplierId, rows.map((x) => ({ productId: x.id, qty: (parse(parEdit[x.id]) as number | null) ?? null })));
      if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
      setParEdit(undefined);
      setMsg({ ok: true, text: r.changed ? `${r.changed} par level${r.changed === 1 ? "" : "s"} saved` : "No par levels changed" });
      router.refresh();
    });
  };

  return (
    <section className="card stack" style={{ gap: 12, paddingBottom: editable ? 96 : undefined }} aria-label="What to order">
      <div className="row wrap" style={{ gap: 8 }}>
        <h2 className="grp-h grow">What to order</h2>
        {parEdit ? (
          <>
            <button type="button" className="btn ghost small" disabled={pending} onClick={() => { setParEdit(undefined); setMsg(undefined); }}>Cancel</button>
            <button type="button" className="btn small" disabled={pending} onClick={savePars}>{pending ? "Saving…" : "Save par levels"}</button>
          </>
        ) : (
          <>
            <div className="seg sm-seg" role="group" aria-label="Show">
              <button type="button" aria-pressed={!all} className={!all ? "sm-seg-on" : undefined} onClick={() => setAll(false)}>To check</button>
              <button type="button" aria-pressed={all} className={all ? "sm-seg-on" : undefined} onClick={() => setAll(true)}>All {rows.length}</button>
            </div>
            <button type="button" className="btn ghost small" onClick={() => { setParEdit(Object.fromEntries(rows.map((r) => [r.id, r.par === undefined ? "" : fmt(r.par)]))); setMsg(undefined); }}>Set par levels</button>
          </>
        )}
      </div>
      {msg && <div className={msg.ok ? "muted" : "err"} role={msg.ok ? "status" : "alert"}>{msg.text}</div>}
      {parEdit && <div className="muted lead">Par is the level you want on the shelf at {siteName} after a delivery, in each product&apos;s unit. Empty: no par.</div>}
      {!editable && !parEdit && <div className="muted lead">This delivery has been ordered. The numbers here are the next round&apos;s.</div>}
      <div className="plan-scroll">
        <table className="rec plan-table">
          <thead>
            <tr><th>Product</th><th className="plan-n">On shelf</th><th className="plan-n">Par</th><th className="plan-n">To send</th><th className="plan-n">Suggested</th><th className="plan-n">Order</th></tr>
          </thead>
          {GROUPS.map((g) => {
            const list = shown.filter((r) => r.group === g);
            if (!list.length) return null;
            return (
              <tbody key={g}>
                <tr><td colSpan={6} className="sup-group">{g}</td></tr>
                {list.map((r) => (
                  <tr key={r.id} className={r.onHand === 0 ? "warn" : undefined}>
                    <td>
                      <span className="strong">{r.name}</span>{r.size ? <span className="muted"> · {r.size}</span> : null}
                      {r.onHand === 0 && <span className="chip bad" style={{ marginLeft: 6 }}>Out</span>}
                      {r.state === "not_counted" && <div className="muted">Not counted{r.reported.qty ? `: ${r.reported.names.join(", ") || "someone"} reported ${fmt(r.reported.qty)}` : ""}</div>}
                      {r.state !== "not_counted" && (r.reported.qty > 0 || r.reported.unsure > 0) && <div className="muted">Reported {r.reported.qty ? fmt(r.reported.qty) : "not sure"}{r.reported.names.length ? ` by ${r.reported.names.join(", ")}` : ""}</div>}
                      {changed(r) && editable && <div className="muted">You changed it from {r.start === undefined ? "empty" : fmt(r.start)}</div>}
                    </td>
                    <td className="plan-n">{r.state === "not_counted" ? <span className="chip warn">Not counted</span> : fmt(r.onHand)}</td>
                    <td className="plan-n">{parEdit
                      ? <input className="txt plan-target" inputMode="decimal" aria-label={`Par for ${r.name}`} value={parEdit[r.id] ?? ""} placeholder="none" onChange={(e) => setParEdit((d) => ({ ...d!, [r.id]: e.target.value }))} />
                      : fmt(r.par)}</td>
                    <td className="plan-n">{r.toSend ? fmt(r.toSend) : "–"}</td>
                    <td className="plan-n">{r.state === "enough" ? <span className="chip done">Enough</span> : fmt(r.suggested)}</td>
                    <td className="plan-n">
                      {editable
                        ? <input className="txt plan-target" inputMode="decimal" aria-label={`Order ${r.name}`} value={qty[r.id] ?? ""} placeholder={r.state === "not_counted" ? "?" : ""}
                            onChange={(e) => setQty((q) => ({ ...q, [r.id]: e.target.value }))} />
                        : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
      {!shown.length && <div className="muted">Nothing to check: everything counted is at par. Show all {rows.length} to add something.</div>}
      <p className="muted" style={{ margin: 0 }}>Suggested = par + still to send to the restaurants − on the shelf. Your number is the order; both are kept, with who made it.</p>
      {editable && (
        <label className="stack" style={{ gap: 6 }}>
          <span className="strong">Note on the order (optional)</span>
          <input className="txt" style={{ width: "100%" }} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. ask for brisket in 5kg packs" />
        </label>
      )}
      {editable && (
        <div className="sticky-foot">
          <div className="inner" style={{ maxWidth: 1240 }}>
            <div className="prep-count" aria-live="polite"><b>{ordering.length}</b><span>to order</span></div>
            <span className="muted grow" style={{ fontSize: 13 }}>{missingQty ? `${missingQty} reported but not counted: give ${missingQty === 1 ? "it" : "them"} a number or leave ${missingQty === 1 ? "it" : "them"} out.` : ""}</span>
            <button type="button" className="btn accent" disabled={pending || !ordering.length} onClick={generate}>{pending ? "Making it…" : "Generate order"}</button>
          </div>
        </div>
      )}
    </section>
  );
}
