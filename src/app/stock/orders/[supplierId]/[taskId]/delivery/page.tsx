import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { store } from "@/lib/data";
import { lineEnd, taskCode } from "@/lib/domain/stock";
import { canCount } from "@/lib/domain/stock-count";
import { canOrder, GROUPS, groupOf } from "@/lib/domain/supplier-orders";
import { londonDate, londonHM, shortDay } from "@/lib/domain/time";
import { scheduled } from "@/lib/supplier-order-service";
import { StockBar } from "../../../../Bar";
import { stockCtx } from "../../../../load";
import { DeliveryForm } from "./DeliveryForm";

export const dynamic = "force-dynamic";

/** The kitchen confirms what a supplier delivery brought, line by line. Its own confirm bar, so no tabs. */
export default async function Delivery(props: { params: Promise<{ supplierId: string; taskId: string }> }) {
  const { supplierId, taskId } = await props.params;
  const { ctx, onPhone } = await stockCtx();
  const db = store();
  const s = await scheduled(db, supplierId);
  const d = await db.stockTask(taskId);
  const t = d?.tasks.find((x) => x.id === taskId);
  if (!s || !d || !t || t.supplierId !== supplierId || !t.destination) notFound();
  const site = await db.site(t.destination);
  if (!site || !(canCount(ctx.person, site) || canOrder(ctx.person, s.cfg))) redirect("/stock");
  const back = `/stock/orders/${supplierId}/${t.id}`;
  const ordered = d.events.some((e) => e.taskId === t.id && e.kind === "ordered");
  const delivered = d.events.find((e) => e.taskId === t.id && e.kind === "delivered");
  const { products } = await db.stockCatalog();
  const lines = d.lines.filter((l) => l.taskId === t.id).map((l) => {
    const r = d.requests.find((x) => x.id === l.requestId);
    const p = products.find((x) => x.id === r?.productId);
    return { id: l.id, name: p?.name ?? "?", size: p?.size, qty: lineEnd(l, d.events)?.qty ?? l.qty, group: groupOf(p?.category) };
  }).sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));
  const delDate = t.requiredBy ?? londonDate(Date.now());

  return (
    <>
      <StockBar ctx={ctx} onPhone={onPhone} title={`${s.supplier.name} delivery`} back={back} eyebrow={`${site.name} · ${shortDay(delDate)} · ${taskCode(t)}`} />
      {!ordered ? (
        <main className="stack"><div className="card stack"><span>This order hasn&apos;t been placed yet, so there&apos;s nothing to confirm.</span><Link className="btn ghost small" href={back} style={{ alignSelf: "flex-start" }}>Back to the order</Link></div></main>
      ) : delivered ? (
        <main className="stack"><div className="card stack"><span>Already confirmed {shortDay(londonDate(delivered.at))} {londonHM(delivered.at)}{delivered.byName ? ` by ${delivered.byName.split(" ")[0]}` : ""}.</span><Link className="btn ghost small" href={back} style={{ alignSelf: "flex-start" }}>See the order</Link></div></main>
      ) : (
        <DeliveryForm taskId={t.id} back={back} code={taskCode(t)} lines={lines} />
      )}
    </>
  );
}
