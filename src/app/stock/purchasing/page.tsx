import Link from "next/link";
import { store } from "@/lib/data";
import { canPurchase, isUrgent, latestPrice, lineEnd, methodOf, onProductionTeam, pounds, spendOf, supplierGroups, TASK_LABEL, taskCode, taskState } from "@/lib/domain/stock";
import { addDays, londonDate, shortDay } from "@/lib/domain/time";
import { stockView } from "@/lib/stock-service";
import { StockBar, StockNav } from "../Bar";
import { ownerStockCtx } from "../load";
import { GroupsBoard, type BoardGroup } from "./GroupsBoard";

export const dynamic = "force-dynamic";

/**
 * The owner's purchasing dashboard: the numbers that need a look, what's still to give to someone grouped by
 * supplier (each restaurant's share kept), the tasks under way and who has them.
 */
export default async function Purchasing(props: { searchParams: Promise<{ site?: string; supplier?: string; person?: string }> }) {
  const sp = await props.searchParams;
  const { ctx, onPhone } = await ownerStockCtx();
  const db = store();
  const now = Date.now();
  const today = londonDate(now);
  const [{ catalog, data, items }, sites, people, purchasers] = await Promise.all([stockView(db, now), db.sites(), db.people(), db.purchaserIds()]);
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  const site = sites.find((s) => s.id === sp.site)?.id;
  const shownItems = items.filter((x) => !site || x.request.siteId === site);
  const groups = supplierGroups(shownItems, catalog.products, catalog.suppliers, data.events, catalog.prices)
    .filter((g) => !sp.supplier || (g.supplier?.id ?? "none") === sp.supplier);

  const liveTasks = data.tasks.filter((t) => !t.cancelledAt);
  const stateOf = new Map(liveTasks.map((t) => [t.id, taskState(t, data.lines, data.events)]));
  const openTasks = liveTasks.filter((t) => stateOf.get(t.id) !== "done")
    .filter((t) => !sp.person || t.assigneeId === sp.person || t.driverId === sp.person)
    .filter((t) => !site || data.lines.some((l) => l.taskId === t.id && data.requests.find((r) => r.id === l.requestId)?.siteId === site));
  const openLines = data.lines.filter((l) => !lineEnd(l, data.events) && stateOf.has(l.taskId) && stateOf.get(l.taskId) !== "done");
  const reqOf = (id: string) => data.requests.find((r) => r.id === id);
  const supOfTask = (taskId: string) => catalog.suppliers.find((s) => s.id === data.tasks.find((t) => t.id === taskId)?.supplierId);

  // The cards.
  const waiting = shownItems.filter((x) => x.progress.toPlan > 0 || x.progress.state === "needs_qty");
  const urgentWaiting = waiting.filter((x) => isUrgent(x.request, data.events));
  const unassignedTasks = openTasks.filter((t) => !t.assigneeId && t.method !== "production");
  const awaitingPurchase = openLines.filter((l) => supOfTask(l.taskId)?.method !== "production" && data.tasks.find((t) => t.id === l.taskId)?.method !== "production").length;
  const inTransit = shownItems.filter((x) => x.progress.toReceive > 0 && x.progress.received === 0).length;
  const productionPending = openLines.filter((l) => data.tasks.find((t) => t.id === l.taskId)?.method === "production").length;
  const deliveries = shownItems.filter((x) => x.progress.toReceive > 0).length;
  let estimate = 0, unpriced = 0;
  for (const l of openLines) {
    const t = data.tasks.find((x) => x.id === l.taskId);
    if (t?.method === "production" || supOfTask(l.taskId)?.method === "production") continue;
    const r = reqOf(l.requestId);
    const price = r && latestPrice(catalog.prices, r.productId);
    if (price) estimate += price.pence * l.qty; else unpriced++;
  }
  for (const g of groups) { estimate += g.estimate; unpriced += g.unpriced; }
  const weekAgo = now - 7 * 86_400_000;
  const spentWeek = spendOf(data.tasks, data.events.filter((e) => e.at >= weekAgo), catalog.suppliers);
  const overdue = openTasks.filter((t) => t.requiredBy && t.requiredBy < today);

  const card = (n: React.ReactNode, label: string, tone?: string, href?: string) => {
    const body = <><div className="stat" style={{ color: tone }}>{n}</div><div className="muted">{label}</div></>;
    return href ? <Link className="card" href={href} style={{ textDecoration: "none", color: "inherit" }}>{body}</Link> : <div className="card">{body}</div>;
  };

  const assignable = people.filter((p) => canPurchase({ ...p, purchaser: purchasers.includes(p.id) })).map((p) => ({ id: p.id, name: p.name }));
  const board: BoardGroup[] = groups.map((g) => ({
    key: g.supplier?.id ?? "none", supplier: g.supplier ? { id: g.supplier.id, name: g.supplier.name, method: g.supplier.method, note: g.supplier.note, siteId: g.supplier.siteId } : undefined,
    urgent: g.urgent, estimate: g.estimate, unpriced: g.unpriced,
    team: g.supplier?.method === "production" && g.supplier.siteId ? people.filter((p) => onProductionTeam(p, g.supplier!.siteId!)).map((p) => ({ id: p.id, name: p.name })) : [],
    rows: g.rows.map((r) => ({
      productId: r.product.id, name: r.product.name, size: r.product.size, toPlan: r.toPlan, urgent: r.urgent, unavailableAt: r.unavailableAt, estimate: r.estimate,
      price: (() => { const p = latestPrice(catalog.prices, r.product.id); return p ? { text: `${pounds(p.pence)} on ${p.on}`, old: p.on < addDays(today, -90) } : undefined; })(),
      sites: r.sites.map((s) => ({ siteId: s.siteId, siteName: siteName.get(s.siteId) ?? s.siteId, requests: s.requests.map((x) => ({ id: x.request.id, toPlan: x.progress.toPlan, needsQty: x.progress.state === "needs_qty", urgent: x.urgent, note: x.request.note })) })),
    })),
  }));

  // Accountability: who has what, overdue, done lately; and where shortages come from.
  const month = now - 30 * 86_400_000;
  const people2 = people.filter((p) => liveTasks.some((t) => t.assigneeId === p.id || t.driverId === p.id)).map((p) => {
    const mine = liveTasks.filter((t) => t.assigneeId === p.id || t.driverId === p.id);
    return { id: p.id, name: p.name, open: mine.filter((t) => stateOf.get(t.id) !== "done").length, overdue: mine.filter((t) => stateOf.get(t.id) !== "done" && t.requiredBy && t.requiredBy < today).length,
      done: mine.filter((t) => stateOf.get(t.id) === "done" && t.createdAt >= month).length };
  });
  const shortages = sites.map((s) => ({ name: s.name, n: items.filter((x) => x.request.siteId === s.id && x.request.createdAt >= month).length, out: items.filter((x) => x.request.siteId === s.id && x.request.createdAt >= month && x.request.level === "out").length }))
    .filter((s) => s.n > 0);

  return (
    <>
      <StockBar ctx={ctx} onPhone={onPhone} title="Purchasing" back="/stock" eyebrow="Stock & Purchasing · every site" />
      <main className="wide stack">
        <form className="stock-filter" method="get">
          <select name="site" defaultValue={site ?? ""} aria-label="Restaurant"><option value="">Every site</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select name="supplier" defaultValue={sp.supplier ?? ""} aria-label="Supplier"><option value="">Every supplier</option>{catalog.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}<option value="none">No supplier</option></select>
          <select name="person" defaultValue={sp.person ?? ""} aria-label="Person"><option value="">Everyone</option>{assignable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <button className="btn small" type="submit">Show</button>
          {(site || sp.supplier || sp.person) && <Link className="btn ghost small" href="/stock/purchasing">Clear</Link>}
          <span className="grow" />
          <Link className="btn ghost small" href="/stock/catalogue">Catalogue</Link>
          <Link className="btn ghost small" href="/stock/history">History</Link>
        </form>

        <div className="grid2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}>
          {card(waiting.length + unassignedTasks.length, `need attention${urgentWaiting.length ? ` · ${urgentWaiting.length} urgent` : ""}`, urgentWaiting.length ? "var(--bad)" : waiting.length ? "var(--accent)" : undefined, "#board")}
          {card(awaitingPurchase, "lines awaiting purchase", undefined, "#tasks")}
          {card(inTransit, "bought, on the way")}
          {card(productionPending, "production lines pending", undefined, "#tasks")}
          {card(deliveries, "not yet confirmed received")}
          {card(estimate ? pounds(Math.round(estimate)) : "—", `estimated still to spend${unpriced ? ` · ${unpriced} with no price` : ""}`)}
          {card(spentWeek ? pounds(spentWeek) : "£0.00", "spent in the last 7 days (recorded)")}
          {card(overdue.length, "tasks past their date", overdue.length ? "var(--bad)" : undefined, "#tasks")}
        </div>

        <section className="stack" id="board" aria-label="To give to someone">
          <h2 className="grp-h">To give to someone <span>grouped by supplier · each restaurant&apos;s share kept</span></h2>
          {!board.length && <div className="card muted">Nothing waiting. New reports show here.</div>}
          <GroupsBoard groups={board} people={assignable} tomorrow={addDays(today, 1)} />
        </section>

        <div className="cols two">
          <section className="stack" id="tasks" aria-label="Under way">
            <h2 className="grp-h">Under way <span>{openTasks.length} task{openTasks.length === 1 ? "" : "s"}</span></h2>
            {!openTasks.length && <div className="card muted">No tasks under way.</div>}
            {openTasks.map((t) => {
              const sup = catalog.suppliers.find((s) => s.id === t.supplierId);
              const ls = data.lines.filter((l) => l.taskId === t.id);
              const ended = ls.filter((l) => lineEnd(l, data.events)).length;
              const late = t.requiredBy && t.requiredBy < today;
              return (
                <Link key={t.id} className="stock-line" href={`/stock/tasks/${t.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                  <div className="row wrap" style={{ gap: 8 }}>
                    <span className="strong grow">{taskCode(t)} · {sup?.name ?? "No supplier"}{t.destination ? ` → ${siteName.get(t.destination)}` : ""}</span>
                    {t.priority === "urgent" && <span className="chip bad">Urgent</span>}
                    <span className={`chip ${late ? "bad" : "late"}`}>{TASK_LABEL[stateOf.get(t.id)!]}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {methodOf(t.method)?.label} · {t.assigneeName ?? (t.method === "production" ? "production team" : "nobody yet")}{t.driverName ? ` · driver ${t.driverName}` : ""}
                    {t.requiredBy ? ` · by ${shortDay(t.requiredBy)}` : ""} · {ended}/{ls.length} lines done
                  </div>
                </Link>
              );
            })}
          </section>
          <aside className="aside panel stack" aria-label="Who's doing what">
            <h2 className="grp-h">Who&apos;s doing what</h2>
            {!people2.length && <div className="muted">Nobody has a task yet.</div>}
            {people2.map((p) => (
              <Link key={p.id} href={`/stock/purchasing?person=${p.id}`} className="row" style={{ gap: 8, color: "inherit", textDecoration: "none" }}>
                <span className="grow strong">{p.name}</span>
                <span className="chip late">{p.open} open</span>
                {p.overdue > 0 && <span className="chip bad">{p.overdue} late</span>}
                <span className="chip done">{p.done} done</span>
              </Link>
            ))}
            <h2 className="grp-h" style={{ marginTop: 12 }}>Shortages · 30 days</h2>
            {!shortages.length && <div className="muted">None reported.</div>}
            {shortages.map((s) => <div key={s.name} className="row" style={{ gap: 8 }}><span className="grow">{s.name}</span><span className="chip warn">{s.n} reported</span>{s.out > 0 && <span className="chip bad">{s.out} out</span>}</div>)}
          </aside>
        </div>
      </main>
      <StockNav ctx={ctx} onPhone={onPhone} />
    </>
  );
}
