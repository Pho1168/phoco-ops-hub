import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { store } from "@/lib/data";
import { taskCode } from "@/lib/domain/stock";
import { canOrder, DOW, dowOf, startQty } from "@/lib/domain/supplier-orders";
import { londonDate, londonHM, shortDay } from "@/lib/domain/time";
import { supplierView, type RoundView } from "@/lib/supplier-order-service";
import { StockBar, StockNav } from "../../Bar";
import { stockCtx } from "../../load";
import { dayDate, RoundChip } from "../parts";
import { OrderBoard } from "./OrderBoard";

export const dynamic = "force-dynamic";

const left = (ms: number) => { const m = Math.max(0, Math.round(ms / 60_000)); return m >= 120 ? `${Math.floor(m / 60)} h left` : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min left` : `${m} min left`; };
const dayName = (iso: string) => DOW[dowOf(iso)];

/**
 * A scheduled supplier's order (Surelygrow): the next delivery, the kitchen's count, and per product what's on the
 * shelf, par, still to send to the restaurants and the suggestion. Whoever orders changes it and generates the order.
 */
export default async function SupplierOrderPage(props: { params: Promise<{ supplierId: string }> }) {
  const { supplierId } = await props.params;
  const { ctx, onPhone, can } = await stockCtx();
  const db = store();
  const now = Date.now();
  const view = await supplierView(db, supplierId, now);
  if (!view) notFound();
  if (!canOrder(ctx.person, view.cfg)) redirect("/stock");
  const { supplier, site, next, last, rows, history } = view;
  const today = londonDate(now);
  const editable = !!next && !next.task;
  const countLine = (r: RoundView) => r.count
    ? `${site.name} counted ${r.count.date === today ? "today" : shortDay(r.count.date)} at ${londonHM(r.count.createdAt)}${r.count.countedByName ? `, by ${r.count.countedByName.split(" ")[0]}` : ""}`
    : `${site.name} hasn't counted yet`;
  const toOrder = rows.filter((r) => (startQty(r) ?? 0) > 0).length;
  const notCounted = rows.filter((r) => r.state === "not_counted").length;
  const out = rows.filter((r) => r.onHand === 0).length;
  const reported = rows.filter((r) => r.reported.qty > 0 || r.reported.unsure > 0).length;
  const noPar = rows.filter((r) => r.par === undefined).length;
  const lastOpen = last && last.task && last.state !== "delivered" ? last : last && last.state === "missed" && now < last.round.deliveryAt ? last : undefined;

  return (
    <>
      <StockBar ctx={ctx} onPhone={onPhone} title={`${supplier.name} order`} back="/stock" eyebrow={`Stock & Purchasing · for ${site.name}`} />
      <main className="wide stack">
        {lastOpen && (
          <section className="card stack" style={{ gap: 8 }} aria-label="The last order">
            <div className="row wrap" style={{ gap: 10 }}>
              <span className="strong grow">Last order: {dayDate(lastOpen.round.delDate)} delivery</span>
              <RoundChip state={lastOpen.state} />
              {lastOpen.task && <Link className="btn ghost small" href={`/stock/orders/${supplier.id}/${lastOpen.task.id}`}>Open {taskCode(lastOpen.task)}</Link>}
            </div>
            {lastOpen.state === "missed" && !lastOpen.task && <span className="muted lead">The cut-off passed with nothing ordered. If Surelygrow still takes it, you can order it below until the delivery time.</span>}
          </section>
        )}

        {next ? (
          <section className="card stack" style={{ gap: 12 }} aria-label="This order">
            <div className="row wrap" style={{ gap: 16, alignItems: "flex-end" }}>
              <div className="stack grow" style={{ gap: 4 }}>
                <span className="muted" style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Delivered to {site.name}</span>
                <span className="sup-when">{dayDate(next.round.delDate)}, {londonHM(next.round.deliveryAt)}</span>
                <span>Order by <b>{dayName(next.round.cutDate)} {londonHM(next.round.cutoffAt)}</b>{next.round.cutDate === today && <> · <span className="sup-left">{left(next.round.cutoffAt - now)}</span></>}</span>
              </div>
              <RoundChip state={next.state} />
            </div>
            <div className={`sup-count ${next.count ? "done" : "wait"}`}>
              <span className="sup-dot" aria-hidden>{next.count ? "✓" : "!"}</span>
              <div className="stack grow" style={{ gap: 2 }}>
                <span className="strong">{countLine(next)}</span>
                <span className="muted">{next.count
                  ? `${next.count.lines.length} of ${view.products.length} ${supplier.name} items counted${next.count.note ? ` · “${next.count.note}”` : ""}`
                  : `The closers are asked on their shift screen on ${dayName(next.round.cutDate)}. Until then the suggestions are blank.`}</span>
              </div>
            </div>
            {next.task ? (
              <div className="row wrap" style={{ gap: 10 }}>
                <span className="grow">Order <b>{taskCode(next.task)}</b> made {londonHM(next.task.createdAt)}{next.task.assigneeName ? ` by ${next.task.assigneeName.split(" ")[0]}` : ""}.</span>
                <Link className="btn" href={`/stock/orders/${supplier.id}/${next.task.id}`}>{next.state === "generated" ? "Send it and mark it placed" : "Open the order"}</Link>
              </div>
            ) : (
              <div className="row wrap" style={{ gap: 6 }}>
                <span className="chip">{toOrder} to order</span>
                {out > 0 && <span className="chip bad">{out} out on the shelf</span>}
                {next.count && notCounted > 0 && <span className="chip warn">{notCounted} not counted</span>}
                {reported > 0 && <span className="chip late">{reported} reported at {site.name}</span>}
                {noPar > 0 && <span className="chip">{noPar} without a par</span>}
              </div>
            )}
          </section>
        ) : (
          <div className="card muted">{supplier.name} has no order days set. The owner sets them in the catalogue.</div>
        )}

        <div className="cols two">
          <OrderBoard supplierId={supplier.id} siteName={site.name} roundAt={editable ? next!.round.cutoffAt : lastOpen && !lastOpen.task ? lastOpen.round.cutoffAt : undefined}
            storeKey={`phoco-order:${ctx.person.id}:${supplier.id}:${next?.round.cutoffAt ?? 0}`}
            rows={rows.map((r) => ({ id: r.product.id, name: r.product.name, size: r.product.size, group: r.group, onHand: r.onHand, par: r.par, toSend: r.toSend,
              reported: r.reported, suggested: r.suggested, state: r.state, start: startQty(r) }))} />
          <aside className="aside panel stack" aria-label="Before you order">
            {rows.some((r) => r.reported.qty > 0 || r.reported.unsure > 0 || r.toSend > 0) && <h2 className="grp-h">Before you order</h2>}
            {rows.filter((r) => r.reported.qty > 0 || r.reported.unsure > 0).slice(0, 6).map((r) => (
              <div key={r.product.id} className="sup-note">
                <span className="chip late" style={{ alignSelf: "flex-start" }}>Reported at {site.name}</span>
                <span><b>{r.product.name}</b>{r.product.size ? ` · ${r.product.size}` : ""}</span>
                <span className="muted">{r.reported.names.join(", ") || "Someone"} asked for {r.reported.qty || "an unknown amount"}{r.reported.unsure ? " (not sure of the quantity)" : ""}. It&apos;s used first when you order it.</span>
              </div>
            ))}
            {rows.some((r) => r.toSend > 0) && (
              <div className="sup-note">
                <span className="strong">Still to send to the restaurants</span>
                <span className="muted">{rows.filter((r) => r.toSend > 0).slice(0, 6).map((r) => `${r.product.name} ${r.toSend}`).join(", ")}. Already in the suggestion.</span>
              </div>
            )}
            <h2 className="grp-h" style={{ marginTop: 6 }}>Recent orders</h2>
            {!history.length && <div className="muted">None yet.</div>}
            {history.slice(0, 6).map((h) => (
              <Link key={h.task.id} href={`/stock/orders/${supplier.id}/${h.task.id}`} className="row" style={{ gap: 8, color: "inherit", textDecoration: "none" }}>
                <span className="grow"><b>{taskCode(h.task)}</b> · {h.task.requiredBy ? shortDay(h.task.requiredBy) : ""} · {h.lines} products</span>
                <RoundChip state={h.state} />
              </Link>
            ))}
            {can.purchasing && <Link className="btn ghost small" href={`/stock/orders/${supplier.id}/settings`} style={{ alignSelf: "flex-start" }}>Order days and who orders</Link>}
          </aside>
        </div>
      </main>
      <StockNav ctx={ctx} onPhone={onPhone} />
    </>
  );
}
