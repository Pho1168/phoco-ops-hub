import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { store } from "@/lib/data";
import { canCount } from "@/lib/domain/stock-count";
import { lineEnd, shortOf, taskCode, type StockEvent } from "@/lib/domain/stock";
import { canOrder, DOW, dowOf, groupOf, orderText, roundState, type Round } from "@/lib/domain/supplier-orders";
import { londonDate, londonHM, shortDay } from "@/lib/domain/time";
import { scheduled } from "@/lib/supplier-order-service";
import { StockBar, StockNav } from "../../../Bar";
import { stockCtx } from "../../../load";
import { dayDate, RoundChip } from "../../parts";
import { PlaceOrder } from "./PlaceOrder";

export const dynamic = "force-dynamic";

/** One supplier order: its text to send (copy, WhatsApp, email, print), marking it placed, and then its delivery. */
export default async function SupplierOrder(props: { params: Promise<{ supplierId: string; taskId: string }> }) {
  const { supplierId, taskId } = await props.params;
  const { ctx, onPhone } = await stockCtx();
  const db = store();
  const now = Date.now();
  const s = await scheduled(db, supplierId);
  const d = await db.stockTask(taskId);
  const t = d?.tasks.find((x) => x.id === taskId);
  if (!s || !d || !t || t.supplierId !== supplierId || t.roundAt === undefined) notFound();
  const site = await db.site(t.destination ?? s.cfg.deliversTo);
  if (!site) notFound();
  const orders = canOrder(ctx.person, s.cfg);
  const team = canCount(ctx.person, site);
  if (!orders && !team) redirect("/stock");
  const { products } = await db.stockCatalog();
  const mine = d.lines.filter((l) => l.taskId === t.id);
  const lines = mine.map((l) => {
    const r = d.requests.find((x) => x.id === l.requestId);
    const p = products.find((x) => x.id === r?.productId);
    return { id: l.id, name: p?.name ?? "?", size: p?.size, qty: l.qty, group: groupOf(p?.category), short: shortOf(l, d.events), bought: lineEnd(l, d.events)?.kind === "bought" };
  }).sort((a, b) => ["Meat", "Vegetables", "Other"].indexOf(a.group) - ["Meat", "Vegetables", "Other"].indexOf(b.group));
  const ev = (k: StockEvent["kind"]) => d.events.find((e) => e.taskId === t.id && e.kind === k);
  const ordered = ev("ordered"), delivered = ev("delivered");
  const delDate = t.requiredBy ?? londonDate(t.roundAt);
  const round: Round = { cutDate: londonDate(t.roundAt), cutoffAt: t.roundAt, delDate, deliveryAt: t.roundAt };
  const state = t.cancelledAt ? undefined : roundState(round, now, true, t, d.events);
  const delHm = s.cfg.days.find((x) => x.cutDow === dowOf(round.cutDate))?.delHm ?? "08:00";
  const text = orderText({ supplier: s.supplier.name, deliverTo: `PHO & CO ${site.name} production kitchen`, delDate, delHm, ref: taskCode(t), lines });
  const dayName = DOW[dowOf(delDate)];

  return (
    <>
      <StockBar ctx={ctx} onPhone={onPhone} title={`${s.supplier.name} · ${shortDay(delDate)}`} back={orders ? `/stock/orders/${supplierId}` : "/stock"}
        eyebrow={`${taskCode(t)} · made ${shortDay(londonDate(t.createdAt))} ${londonHM(t.createdAt)}${t.assigneeName ? ` by ${t.assigneeName.split(" ")[0]}` : ""}`} />
      <main className="wide stack">
        <div className="cols two">
          <section className="card stack" style={{ gap: 12 }} aria-label="The order">
            <div className="row wrap no-print" style={{ gap: 10 }}>
              <h2 className="grp-h grow">{ordered ? "The order as sent" : "The order, ready to send"}</h2>
              {state && <RoundChip state={state} />}
            </div>
            <pre className="sup-text">{text}</pre>
            {t.note && <div className="muted">Note: {t.note}</div>}
            <PlaceOrder taskId={t.id} supplierName={s.supplier.name} text={text} subject={`PHO & CO order ${taskCode(t)} · ${dayDate(delDate)}`}
              canPlace={orders && !ordered && !t.cancelledAt} placed={ordered ? { by: ordered.byName?.split(" ")[0], at: `${shortDay(londonDate(ordered.at))} ${londonHM(ordered.at)}`, ref: ordered.ref } : undefined} />
          </section>
          <aside className="aside panel stack no-print" aria-label="Delivery">
            <h2 className="grp-h">Delivery</h2>
            {t.cancelledAt && <div>Cancelled{t.cancelReason ? `: ${t.cancelReason}` : ""}.</div>}
            {!ordered && !t.cancelledAt && <span>Send it to {s.supplier.name}, then tap <b>Order placed</b>. {site.name} then sees it on {dayName}, to check it in.</span>}
            {ordered && !delivered && (
              <>
                <span>Due at {site.name} on <b>{dayDate(delDate)}</b> by {delHm}. The team confirms what arrived on their shift screen.</span>
                {team && <Link className="btn" href={`/stock/orders/${supplierId}/${t.id}/delivery`} style={{ alignSelf: "flex-start" }}>Confirm what arrived</Link>}
              </>
            )}
            {delivered && (
              <>
                <span>Confirmed {shortDay(londonDate(delivered.at))} {londonHM(delivered.at)}{delivered.byName ? ` by ${delivered.byName.split(" ")[0]}` : ""}{delivered.text ? `: “${delivered.text}”` : ""}.</span>
                {lines.filter((l) => l.short > 0).map((l) => <span key={l.id} className="chip late" style={{ alignSelf: "flex-start" }}>{l.name}: {l.short} didn&apos;t come</span>)}
                {!lines.some((l) => l.short > 0) && <span className="chip done" style={{ alignSelf: "flex-start" }}>Everything arrived</span>}
              </>
            )}
            <span className="muted">Anything that didn&apos;t come goes back to waiting and shows on the next order.</span>
          </aside>
        </div>
      </main>
      <StockNav ctx={ctx} onPhone={onPhone} />
    </>
  );
}
