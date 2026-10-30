import Link from "next/link";
import { notFound } from "next/navigation";
import { store } from "@/lib/data";
import { canPurchase, deliveryDaysText, neededCount, nextDelivery, ordersByRound } from "@/lib/domain/stock";
import { londonDate, longDay } from "@/lib/domain/time";
import { neededView } from "@/lib/stock-service";
import { StockBar, StockNav } from "../../Bar";
import { orderingStockCtx } from "../../load";
import { NeededBoard } from "../../needed/NeededBoard";
import { boardGroups } from "../../needed/board";

export const dynamic = "force-dynamic";

/**
 * A round supplier's order (Surelygrow, delivering to the Wembley kitchen on Monday and Friday): what the production
 * kitchen has asked for, on its own list, never mixed into Stock needed. Everything still waiting goes on the next
 * delivery, which closes at the end of the day before. Tick when ordered; the PDF is the order to email them.
 */
export default async function RoundOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, onPhone } = await orderingStockCtx();
  const db = store();
  const now = Date.now();
  const [{ groups, sites, items, catalog }, people, purchasers] = await Promise.all([neededView(db, ctx.person, now), db.people(), db.purchaserIds()]);
  const supplier = catalog.suppliers.find((s) => s.id === id);
  if (!supplier || !ordersByRound(supplier)) notFound();
  const group = groups.find((g) => g.supplier?.id === supplier.id);
  const next = nextDelivery(supplier.deliveryDays ?? [], now);
  const today = londonDate(now);
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  const board = group ? boardGroups([group], { siteName, items, suppliers: catalog.suppliers }) : [];
  const drivers = people.filter((p) => canPurchase({ ...p, purchaser: purchasers.includes(p.id) }))
    .map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name));
  const n = group ? neededCount([group]) : 0;
  const closesToday = next?.orderBy === today;
  return (
    <>
      <StockBar ctx={ctx} onPhone={onPhone} title={`${supplier.name} order`} back="/stock/needed" />
      <main className="stack">
        <section className={`card stack round-head${closesToday ? " closing" : ""}`} style={{ gap: 6 }}>
          <div className="row wrap" style={{ gap: 8, alignItems: "baseline" }}>
            <h2 className="h-sec grow" style={{ margin: 0 }}>{next ? `For ${longDay(next.date)}` : supplier.name}</h2>
            {closesToday ? <span className="chip late">Order closes today</span> : next && <span className="chip warn">Order by end of {longDay(next.orderBy)}</span>}
          </div>
          <div className="muted">
            {supplier.name} delivers to the production kitchen on {deliveryDaysText(supplier.deliveryDays ?? [])}. Everything still to order is for the next delivery; anything asked for after the cut-off goes on the one after.
            This list is kept off Stock needed.
          </div>
          <div className="strong">{n ? `${n} item${n === 1 ? "" : "s"} to order` : "Nothing to order yet"}</div>
        </section>
        {board.length > 0 && <NeededBoard groups={board} drivers={drivers} />}
        <nav className="row wrap" style={{ gap: 8 }}>
          <Link className="btn ghost small" href="/stock/needed">Back to Stock needed</Link>
        </nav>
      </main>
      <StockNav ctx={ctx} onPhone={onPhone} />
    </>
  );
}
