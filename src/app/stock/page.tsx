import Link from "next/link";
import { store } from "@/lib/data";
import { deliveryDaysText, editsSiteNeeded, lineEnd, neededCount, nextDelivery, ordersByRound, sentTodayLine } from "@/lib/domain/stock";
import { londonDate, londonHM, shortDay } from "@/lib/domain/time";
import { kitchenPlan, neededView, siteNeededView } from "@/lib/stock-service";
import { Icon } from "@/components/Icon";
import { BRANDS } from "@/lib/domain/brand";
import { StockBar, StockNav } from "./Bar";
import { stockCtx } from "./load";
import { PrintStock } from "./PrintStock";

export const dynamic = "force-dynamic";

/**
 * Stock home: Report stock (anyone at the site), Stock needed (owners and operations managers; on the tablet, everyone
 * else sees their restaurant's list) and My shopping list
 * (drivers); the production kitchen's count and plan for its team; the catalogue and history for the owner.
 */
export default async function StockHome() {
  const { ctx, onPhone, can } = await stockCtx();
  const db = store();
  const now = Date.now();
  const today = londonDate(now);
  const view = await neededView(db, ctx.person, now);
  const { data } = view;
  const [draft, sent] = await Promise.all([
    can.report ? db.stockDraft(ctx.site.id, ctx.person.id) : undefined,
    can.report ? db.stockReports([ctx.site.id], now - 86_400_000) : [],
  ]);
  const sentToday = sent.filter((r) => r.date === today);
  const drafted = draft ? draft.lines.length + draft.extras.length : 0;
  const newCount = can.ordering ? (await db.stockNewItems({ open: true, siteIds: view.siteIds })).length : 0;
  // A round supplier's order (Surelygrow) has its own door, not counted in Stock needed.
  const listed = view.groups.filter((g) => !ordersByRound(g.supplier));
  const needed = neededCount(listed) + newCount;
  const suppliers = listed.filter((g) => g.rows.length).length;
  const rounds = can.ordering ? view.catalog.suppliers.filter((s) => ordersByRound(s) && view.brands.includes(s.brand ?? "phoco")).map((s) => {
    const g = view.groups.find((x) => x.supplier?.id === s.id);
    return { s, n: g ? neededCount([g]) : 0, next: nextDelivery(s.deliveryDays ?? [], now) };
  }) : [];
  // On the tablet, everyone else sees what their restaurant has asked for (and can change it).
  const siteList = !can.ordering && !onPhone && editsSiteNeeded(ctx.person, ctx.site, ctx.scope) ? (await siteNeededView(db, ctx.site.id, now)).groups : undefined;
  const siteItems = siteList ? neededCount(siteList) : 0;
  // My shopping list: what's still to get on lists given to me.
  const mine = new Set(data.tasks.filter((t) => !t.cancelledAt && t.method !== "production" && (t.assigneeId === ctx.person.id || t.driverId === ctx.person.id)).map((t) => t.id));
  const myItems = data.lines.filter((l) => mine.has(l.taskId) && !lineEnd(l, data.events)).length;
  const plans = await Promise.all(can.planSites.map((id) => kitchenPlan(db, id, now)));
  const toMake = plans.reduce((n, p) => n + p.rows.filter((r) => (r.make ?? 0) > 0).length, 0);
  const countedToday = can.count ? (await db.stockCounts(ctx.site.id, now - 86_400_000)).find((c) => c.date === today) : undefined;
  const kitchen = can.count || can.planSites.length > 0;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

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
        {!onPhone && (can.ordering || siteList) && <PrintStock label={can.ordering ? "Print everything on Stock needed." : `Print what ${ctx.site.name} has on Stock needed.`} />}
        <div className="tiles">
          {can.report && door("/stock/report", "box", "Report stock", draft && (drafted || draft.noIssues)
            ? `Not sent yet: ${plural(drafted, "item")}`
            : sentTodayLine(sentToday, londonHM) ?? `What ${ctx.site.name} needs ordered, and how many`,
            drafted ? { n: drafted, tone: "warn" } : undefined)}
          {can.ordering && door("/stock/needed", "cart", "Stock needed", needed ? `${plural(needed - newCount, "item")} from ${plural(suppliers, "supplier")}${newCount ? ` · ${newCount} new to add` : ""}` : "Nothing waiting", { n: needed })}
          {rounds.map(({ s, n, next }) => <span key={s.id} style={{ display: "contents" }}>{door(`/stock/order/${s.id}`, "truck", `${s.name} order${view.brands.length > 1 ? ` · ${BRANDS[s.brand ?? "phoco"].name}` : ""}`,
            next ? `For ${shortDay(next.date)} · order by end of ${shortDay(next.orderBy)}` : `Delivers ${deliveryDaysText(s.deliveryDays ?? [])}`, { n, tone: "warn" })}</span>)}
          {siteList && door("/stock/needed", "cart", "Stock needed", siteItems ? `${plural(siteItems, "item")} ${ctx.site.name} has asked for · change or remove` : "Nothing waiting", { n: siteItems })}
          {(myItems > 0 || can.purchaser) && door("/stock/tasks", "truck", "My shopping list", myItems ? `${plural(myItems, "item")} to get` : "Nothing for you right now", { n: myItems })}
        </div>
        {kitchen && (
          <section className="stack" aria-label="Production kitchen">
            <h2 className="grp-h">Production kitchen</h2>
            <div className="tiles">
              {can.count && door("/stock/count", "check", "Count production stock", countedToday ? `Counted today by ${countedToday.countedByName?.split(" ")[0] ?? "someone"}` : "What's on the shelf, at close")}
              {can.planSites.length > 0 && door("/stock/plan", "report", "Production plan", plans.some((p) => p.latest) ? (toMake ? `${plural(toMake, "item")} to make` : "Nothing to make") : "No count yet · set the targets", { n: toMake })}
            </div>
          </section>
        )}
        {can.purchasing && (
          <div className="row wrap" style={{ gap: 8 }}>
            <Link className="btn ghost small" href="/stock/catalogue">Catalogue and suppliers</Link>
            <Link className="btn ghost small" href="/stock/history">Stock history</Link>
          </div>
        )}
        {!can.report && !can.ordering && !kitchen && myItems === 0 && !can.purchaser && (
          <div className="card muted">Nothing here for you at {ctx.site.name}.</div>
        )}
      </main>
      <StockNav ctx={ctx} onPhone={onPhone} />
    </>
  );
}
