import { notFound } from "next/navigation";
import { store } from "@/lib/data";
import { canChangeSupplier, canCancelRequest, methodOf, productLabel, progress, reqCode, STATE_LABEL, taskCode, wantedOf, type StockEvent } from "@/lib/domain/stock";
import { londonDate, londonHM, shortDay } from "@/lib/domain/time";
import { StockBar, StockNav } from "../../Bar";
import { qtyText, stockCtx } from "../../load";
import { RequestControls } from "./RequestControls";

export const dynamic = "force-dynamic";

const WHAT: Partial<Record<StockEvent["kind"], string>> = {
  bought: "bought", unavailable: "not available", dispatched: "dispatched", line_cancelled: "taken off a task", reported_again: "reported again", qty_changed: "quantity set",
  supplier_changed: "supplier changed to", request_cancelled: "cancelled", picked: "picked", packed: "packed", substitute: "suggested a substitute:", substitute_ok: "approved the substitute",
  substitute_no: "said no to the substitute", note: "noted",
};

/** One request: where it stands and everything that happened to it, with the owner's controls. */
export default async function RequestPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const { ctx, onPhone, can } = await stockCtx();
  const db = store();
  const data = await db.stockData({ since: 0 });
  const r = data.requests.find((x) => x.id === id);
  if (!r || !(can.purchasing || ctx.person.access.some((a) => a.siteId === r.siteId))) notFound();
  const { products, suppliers } = await db.stockCatalog();
  const site = await db.site(r.siteId);
  const p = progress(r, data.lines, data.events, data.receipts, data.tasks);
  const product = products.find((x) => x.id === r.productId);
  const supplier = suppliers.find((s) => s.id === r.supplierId);
  const lines = data.lines.filter((l) => l.requestId === r.id);
  const taskOf = (taskId?: string) => data.tasks.find((t) => t.id === taskId);
  const when = (at: number) => `${shortDay(londonDate(at))} ${londonHM(at)}`;
  const timeline: { at: number; text: string }[] = [
    { at: r.createdAt, text: `${r.requestedByName ?? "Someone"} reported it ${r.level === "out" ? "out" : "low"}: ${qtyText(r.qty)}${r.note ? ` (${r.note})` : ""}` },
    ...lines.map((l) => { const t = taskOf(l.taskId); return { at: data.events.find((e) => e.taskId === l.taskId)?.at ?? t?.createdAt ?? 0, text: `${qtyText(l.qty)} put on ${t ? taskCode(t) : "a task"}${t ? ` (${methodOf(t.method)?.label}${t.assigneeName ? `, ${t.assigneeName}` : ""})` : ""}` }; }),
    ...data.events.filter((e) => e.requestId === r.id && WHAT[e.kind]).map((e) => ({ at: e.at,
      text: `${e.byName ?? "Someone"} ${WHAT[e.kind]}${e.kind === "supplier_changed" ? ` ${e.text}` : ""}${e.qty !== undefined && e.kind !== "supplier_changed" ? ` ${qtyText(e.qty)}` : ""}${e.text && !["supplier_changed", "reported_again"].includes(e.kind) ? ` · ${e.text}` : ""}${e.kind === "reported_again" && e.text === "out" ? " · now out" : ""}${e.ref ? ` · ${e.ref}` : ""}` })),
    ...data.receipts.filter((x) => x.requestId === r.id).map((x) => ({ at: x.at, text: `${x.byName ?? "Someone"} confirmed ${qtyText(x.qty)} arrived${x.note ? ` · ${x.note}` : ""}` })),
  ].sort((a, b) => a.at - b.at);

  return (
    <>
      <StockBar ctx={ctx} onPhone={onPhone} title={product ? product.name : "Request"} eyebrow={`${reqCode(r)} · ${site?.name ?? r.siteId}`} back={can.purchasing ? "/stock/needed" : "/stock/report"} />
      <main className="stack">
        <section className="card stack" aria-label="Where it stands">
          <div className="row wrap" style={{ gap: 10 }}>
            <h2 className="h-sec grow">{product ? productLabel(product) : "Product"}</h2>
            <span className={`chip ${r.level === "out" ? "bad" : "warn"}`}>{r.level === "out" ? "Out" : "Low"}</span>
            <span className={`chip ${p.state === "received" ? "done" : "late"}`}>{STATE_LABEL[p.state]}</span>
          </div>
          <div className="stats row wrap" style={{ gap: 22 }}>
            <div><div className="stat">{qtyText(p.wanted)}</div><div className="muted">wanted</div></div>
            <div><div className="stat">{qtyText(p.planned)}</div><div className="muted">assigned</div></div>
            <div><div className="stat">{qtyText(p.obtained)}</div><div className="muted">bought or sent</div></div>
            <div><div className="stat">{qtyText(p.received)}</div><div className="muted">received</div></div>
          </div>
          <div className="muted">From {supplier?.name ?? "no supplier yet"}{r.qty === undefined && r.fixedQty !== undefined ? ` · staff weren't sure; set to ${qtyText(r.fixedQty)}` : ""}{r.fixedQty !== undefined && r.qty !== undefined && r.fixedQty !== r.qty ? ` · asked for ${qtyText(r.qty)}, set to ${qtyText(wantedOf(r))}` : ""}</div>
          {r.photoId && <a href={`/api/media/${r.photoId}`} target="_blank" rel="noreferrer">See the photo</a>}
          {r.cancelReason && <div className="alert">Cancelled: {r.cancelReason}</div>}
        </section>
        {can.purchasing && p.state !== "cancelled" && (
          <RequestControls requestId={r.id} wanted={p.wanted} suppliers={suppliers.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name }))} supplierId={r.supplierId}
            canSupplier={canChangeSupplier(p)} canCancel={canCancelRequest(p)} />
        )}
        <section className="card stack" aria-label="What happened">
          <h2 className="h-sec">What happened</h2>
          <ul className="stock-timeline">{timeline.map((x, i) => <li key={i}><time>{when(x.at)}</time><span>{x.text}</span></li>)}</ul>
        </section>
      </main>
      <StockNav ctx={ctx} onPhone={onPhone} />
    </>
  );
}
