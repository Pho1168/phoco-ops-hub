import Link from "next/link";
import { store } from "@/lib/data";
import { canSeeTask, isClosed, isUrgent, productionQueue, taskState } from "@/lib/domain/stock";
import { DOW, dowOf, ROUND_LABEL } from "@/lib/domain/supplier-orders";
import { londonDate, londonHM } from "@/lib/domain/time";
import { kitchenPlan, stockView } from "@/lib/stock-service";
import { supplierView } from "@/lib/supplier-order-service";
import { Icon } from "@/components/Icon";
import { StockBar, StockNav } from "./Bar";
import { stockCtx } from "./load";

export const dynamic = "force-dynamic";

/** Stock & Purchasing home: the doors this person has, each with what's waiting behind it. */
export default async function StockHome() {
  const { ctx, onPhone, can } = await stockCtx();
  const db = store();
  const now = Date.now();
  const { catalog, data, items } = await stockView(db, now);
  const [draft, sent] = await Promise.all([
    can.report ? db.stockDraft(ctx.site.id, ctx.person.id) : undefined,
    can.report ? db.stockReports([ctx.site.id], now - 86_400_000) : [],
  ]);
  const today = londonDate(now);
  const sentToday = sent.filter((r) => r.date === today);
  const mySites = new Set(ctx.person.access.map((a) => a.siteId));
  const toReceive = items.filter((x) => mySites.has(x.request.siteId) && x.progress.toReceive > 0).length;
  const openHere = items.filter((x) => x.request.siteId === ctx.site.id && !isClosed(x.progress)).length;
  const myTasks = data.tasks.filter((t) => !t.cancelledAt && (t.assigneeId === ctx.person.id || t.driverId === ctx.person.id) && taskState(t, data.lines, data.events) !== "done");
  const prodRows = can.productionSites.length ? productionQueue(data.tasks.filter((t) => canSeeTask(ctx.person, t, catalog.suppliers.find((s) => s.id === t.supplierId))), data.lines, data.requests, data.events, catalog.products) : [];
  const prodOutstanding = prodRows.filter((r) => r.outstanding > 0).length;
  // What to make at the kitchens this person plans, from each one's latest count.
  const plans = await Promise.all(can.planSites.map((id) => kitchenPlan(db, id, now)));
  const toMake = plans.reduce((n, p) => n + p.rows.filter((r) => (r.make ?? 0) > 0).length, 0);
  const countedToday = can.count ? (await db.stockCounts(ctx.site.id, now - 86_400_000)).find((c) => c.date === londonDate(now)) : undefined;
  const waiting = items.filter((x) => x.progress.state === "waiting" || x.progress.state === "needs_qty" || x.progress.state === "part_bought" && x.progress.toPlan > 0);
  const urgent = waiting.filter((x) => isUrgent(x.request, data.events)).length;
  // Suppliers on order days (Surelygrow): whoever orders gets the order door, the kitchen team the count and the delivery.
  const supIds = [...new Set([...can.orders, ...can.kitchenSuppliers].map((x) => x.id))];
  const supViews = (await Promise.all(supIds.map((id) => supplierView(db, id, now)))).filter((v) => v !== undefined);
  const when = (iso: string, at: number) => `${DOW[dowOf(iso)].slice(0, 3)} ${londonHM(at)}`;
  const awaited = (v: (typeof supViews)[number]) => [v.last, v.next].find((r) => r?.task && r.state === "ordered");

  const door = (href: string, icon: string, title: string, line: string, badge?: { n: number; tone?: string }) => (
    <Link className="tile" href={href}>
      <span className="tile-ico"><Icon name={icon} /></span>
      <span className="grow stack" style={{ gap: 4 }}>
        <span className="tile-title">{title}</span>
        <span className="muted" style={{ fontSize: 14 }}>{line}</span>
      </span>
      {badge && badge.n > 0 && <span className={`chip ${badge.tone ?? "late"}`}>{badge.n}</span>}
    </Link>
  );

  return (
    <>
      <StockBar ctx={ctx} onPhone={onPhone} title="Stock" />
      <main className="stack">
        {can.report && (
          <section className="stack" aria-label="Your restaurant">
            <h2 className="grp-h">{ctx.site.name}</h2>
            <div className="tiles">
              {door("/stock/report", "box", "Report stock", draft && (draft.lines.length || draft.noIssues)
                ? `Not sent yet: ${draft.lines.length} item${draft.lines.length === 1 ? "" : "s"}`
                : sentToday.length ? `Sent today by ${sentToday.map((r) => r.personName?.split(" ")[0]).filter(Boolean).join(", ")}` : "What's low or out at the end of your shift",
                draft && draft.lines.length ? { n: draft.lines.length, tone: "warn" } : undefined)}
              {door("/stock/requests", "check", "Requests and deliveries", toReceive ? `${toReceive} to confirm when it arrives` : `${openHere} in hand`, { n: toReceive })}
            </div>
          </section>
        )}
        {(myTasks.length > 0 || can.purchaser) && (
          <section className="stack" aria-label="Your purchasing">
            <h2 className="grp-h">Your purchasing</h2>
            <div className="tiles">{door("/stock/tasks", "cart", "My shopping list", myTasks.length ? `${myTasks.length} task${myTasks.length === 1 ? "" : "s"} for you` : "Nothing for you right now", { n: myTasks.length })}</div>
          </section>
        )}
        {supViews.length > 0 && (
          <section className="stack" aria-label="Supplier orders">
            <h2 className="grp-h">Supplier orders</h2>
            <div className="tiles">
              {supViews.map((v) => {
                const r = v.next;
                const del = awaited(v);
                const ordersIt = can.orders.some((x) => x.id === v.supplier.id);
                const countsIt = can.kitchenSuppliers.some((x) => x.id === v.supplier.id);
                const needs = r && (r.state === "review" || r.state === "generated");
                return (
                  <span key={v.supplier.id} style={{ display: "contents" }}>
                    {ordersIt && door(`/stock/orders/${v.supplier.id}`, "cart", `${v.supplier.name} order`,
                      r ? `${ROUND_LABEL[r.state]} · order by ${when(r.round.cutDate, r.round.cutoffAt)} for ${when(r.round.delDate, r.round.deliveryAt)}` : "No order days coming up",
                      needs ? { n: 1, tone: "warn" } : undefined)}
                    {countsIt && r && !r.task && door(`/stock/count?for=${v.supplier.id}`, "check", `Count ${v.supplier.name} stock`,
                      r.count ? `Counted ${r.count.countedByName ? `by ${r.count.countedByName.split(" ")[0]} ` : ""}at ${londonHM(r.count.createdAt)} · for the ${when(r.round.delDate, r.round.deliveryAt)} delivery` : `Before ${when(r.round.cutDate, r.round.cutoffAt)}, at close`)}
                    {countsIt && del?.task && door(`/stock/orders/${v.supplier.id}/${del.task.id}/delivery`, "truck", `${v.supplier.name} delivery`,
                      `Due ${when(del.round.delDate, del.round.deliveryAt)} · confirm what arrived`, { n: 1, tone: "warn" })}
                  </span>
                );
              })}
            </div>
          </section>
        )}
        {(can.productionSites.length > 0 || can.planSites.length > 0) && (
          <section className="stack" aria-label="Production">
            <h2 className="grp-h">Production kitchen</h2>
            <div className="tiles">
              {door("/stock/production", "truck", "Production orders", prodOutstanding ? `${prodOutstanding} product${prodOutstanding === 1 ? "" : "s"} to prepare or send` : "Nothing waiting", { n: prodOutstanding })}
              {can.count && door("/stock/count", "check", "Count production stock", countedToday ? `Counted today by ${countedToday.countedByName?.split(" ")[0] ?? "someone"}` : "What's on the shelf, at close")}
              {can.planSites.length > 0 && door("/stock/plan", "report", "Production plan", plans.some((p) => p.latest) ? (toMake ? `${toMake} item${toMake === 1 ? "" : "s"} to make` : "Nothing to make") : "No count yet · set the targets", { n: toMake })}
            </div>
          </section>
        )}
        {can.purchasing && (
          <section className="stack" aria-label="Purchasing">
            <h2 className="grp-h">Owner</h2>
            <div className="tiles">
              {door("/stock/purchasing", "report", "Purchasing dashboard", waiting.length ? `${waiting.length} request${waiting.length === 1 ? "" : "s"} to give to someone${urgent ? `, ${urgent} urgent` : ""}` : "Everything is assigned", { n: urgent || waiting.length, tone: urgent ? "bad" : "late" })}
              {door("/stock/catalogue", "prep", "Catalogue and suppliers", `${catalog.products.filter((p) => p.active).length} products · ${catalog.suppliers.filter((s) => s.active).length} suppliers`)}
              {door("/stock/history", "records", "Stock history", "Every request, what happened and who did it")}
            </div>
          </section>
        )}
        {!can.report && !can.purchasing && !can.productionSites.length && !can.planSites.length && myTasks.length === 0 && supViews.length === 0 && (
          <div className="card muted">Nothing here for you at {ctx.site.name}.</div>
        )}
      </main>
      <StockNav ctx={ctx} onPhone={onPhone} />
    </>
  );
}
