import { store } from "@/lib/data";
import type { Store } from "@/lib/data/store";
import type { Done, StockData } from "@/lib/data/stock-store";
import { isOwner } from "@/lib/domain/access";
import { cleanLines, methodOf, needsEscalation, productionQueue, productLabel, reqCode, taskCode, withProgress, type Product, type ProductionRow, type Progress, type StockRequest, type Supplier } from "@/lib/domain/stock";
import { supplierAt } from "@/lib/domain/supplier-orders";
import { belowTarget, cleanCount, countProducts, productionPlan, plansProduction, type PlanRow, type StockCount, type StockTarget } from "@/lib/domain/stock-count";
import { afterQuietHours, londonDate, londonHM } from "@/lib/domain/time";
import type { Person, Site } from "@/lib/domain/types";

/**
 * Stock & Purchasing, put together: the steps that read several records and then write (sending a report, routing
 * production products to the kitchen, telling people). Rules stay in src/lib/domain/stock.ts.
 */

/** How far back the screens look. Older records are kept; the history page can go further. */
export const STOCK_WINDOW_DAYS = 120;
export const stockSince = (now: number, days = STOCK_WINDOW_DAYS) => now - days * 86_400_000;

export async function stockView(db: Store, now: number, siteIds?: string[], days?: number) {
  const [catalog, data] = await Promise.all([db.stockCatalog(), db.stockData({ since: stockSince(now, days), siteIds })]);
  return { catalog, data, items: withProgress(data) };
}

/**
 * Sends the person's report at the site. A report with nothing in it is "no stock issues today" (it must say so).
 * Production products go straight onto the production kitchen's order for this restaurant today.
 */
export async function sendStockReport(db: Store, person: Pick<Person, "id">, site: Pick<Site, "id">, now: number): Promise<Done<{ created: StockRequest[]; again: number; noIssues: boolean }>> {
  const draft = await db.stockDraft(site.id, person.id);
  if (!draft) return { ok: false, error: "There's nothing to send. Add what's low or out, or tap No stock issues today" };
  const { catalog, items } = await stockView(db, now, [site.id]);
  const clean = cleanLines(draft.lines, catalog.products);
  if (!clean.ok) return clean;
  if (!clean.value.length && !draft.noIssues) return { ok: false, error: "Add what's low or out, or tap No stock issues today" };
  if (clean.value.length && draft.noIssues) await db.saveStockDraft(site.id, person.id, draft.date, clean.value, false);
  void items;
  // A supplier that delivers only to a kitchen supplies the restaurants through that kitchen (its production order).
  const cfgs = await db.supplierOrders();
  const routed = catalog.products.map((p) => ({ id: p.id, supplierId: supplierAt(p, site.id, cfgs, catalog.suppliers) }));
  const sent = await db.submitStockReport(draft.id, person.id, clean.value, routed);
  if (!sent) return { ok: false, error: "That report has already been sent" };
  await routeProduction(db, sent.created, person.id, now, catalog.suppliers);
  return { ok: true, value: { created: sent.created, again: sent.again, noIssues: !clean.value.length } };
}

/** Requests whose supplier is a production kitchen, with a quantity and nothing assigned: onto that kitchen's order for today. */
export async function routeProduction(db: Store, requests: StockRequest[], by: string, now: number, suppliers?: Supplier[]): Promise<number> {
  const sups = suppliers ?? (await db.stockCatalog()).suppliers;
  const groups = new Map<string, { supplierId: string; siteId: string; ids: string[] }>();
  for (const r of requests) {
    const sup = sups.find((s) => s.id === r.supplierId);
    if (!sup || sup.method !== "production" || r.siteId === sup.siteId || r.cancelledAt) continue;
    const key = `${sup.id}|${r.siteId}`;
    const g = groups.get(key) ?? { supplierId: sup.id, siteId: r.siteId, ids: [] };
    g.ids.push(r.id);
    groups.set(key, g);
  }
  let n = 0;
  // What's still to plan is worked out by the store, inside its transaction.
  for (const g of groups.values()) if (await db.addToProductionOrder(g.supplierId, g.siteId, londonDate(now), g.ids, by)) n++;
  return n;
}

/** Tells whoever a task is given to (and its driver) that it's theirs. Once per task and person. */
export async function notifyTask(db: Store, taskId: string, now: number): Promise<number> {
  const d = await db.stockTask(taskId);
  const t = d?.tasks.find((x) => x.id === taskId);
  if (!d || !t || t.cancelledAt) return 0;
  const { suppliers, products } = await db.stockCatalog();
  const sup = suppliers.find((s) => s.id === t.supplierId);
  const n = d.lines.filter((l) => l.taskId === t.id).length;
  let sent = 0;
  for (const [personId, role] of [[t.assigneeId, methodOf(t.method)?.who ?? "Buyer"], [t.driverId, "Driver"]] as const) {
    if (!personId) continue;
    const first = d.requests.find((r) => d.lines.some((l) => l.taskId === t.id && l.requestId === r.id));
    const what = first ? productLabel(products.find((p) => p.id === first.productId) ?? { name: "items" }) : "items";
    if (await db.queueNotice({ personId, kind: "stock", title: `${taskCode(t)}: ${sup?.name ?? "Purchasing"} · you're the ${role.toLowerCase()}`,
      body: `${n} item${n === 1 ? "" : "s"}${n ? `, starting with ${what}` : ""}${t.requiredBy ? `. Needed by ${t.requiredBy}` : ""}.`,
      dedupeKey: `stocktask|${t.id}|${personId}|${role}`, sendAfter: t.priority === "urgent" ? afterQuietHours(now, true) : afterQuietHours(now), url: `/stock/tasks/${t.id}` })) sent++;
  }
  return sent;
}

/** Urgent requests (reported out) nobody has after ESCALATE_HOURS: the owners are told, once per request. */
export async function queueStockEscalations(now = Date.now(), db: Store = store()): Promise<number> {
  const [people, catalog, data] = await Promise.all([db.people(), db.stockCatalog(), db.stockData({ since: stockSince(now, 14) })]);
  const owners = people.filter((p) => p.status === "active" && isOwner(p));
  const sites = new Map((await db.sites()).map((s) => [s.id, s.name]));
  let queued = 0;
  for (const { request: r, progress: p } of withProgress(data)) {
    if (!needsEscalation(r, p, data.events, now)) continue;
    const product = catalog.products.find((x) => x.id === r.productId);
    for (const o of owners) {
      if (await db.queueNotice({ personId: o.id, kind: "stock", title: `Out of stock, nobody assigned · ${sites.get(r.siteId) ?? r.siteId}`,
        body: `${product ? productLabel(product) : "A product"} (${reqCode(r)}) was reported out and nobody has it yet.`,
        dedupeKey: `stockurgent|${r.id}|${o.id}`, sendAfter: afterQuietHours(now, true), url: "/stock/purchasing" })) queued++;
    }
  }
  return queued;
}

/** How far back the plan looks for the latest count (older than that: not counted). */
export const COUNT_WINDOW_DAYS = 30;

/**
 * A production kitchen's plan: the products it counts, the latest count, the targets, what the restaurants still
 * need sending on its production orders, and what to make. Rules in src/lib/domain/stock-count.ts.
 */
export async function kitchenPlan(db: Store, siteId: string, now: number): Promise<{ products: Product[]; counts: StockCount[]; latest?: StockCount; targets: StockTarget[]; orders: ProductionRow[]; rows: PlanRow[] }> {
  const [{ catalog, data }, counts, targets] = await Promise.all([stockView(db, now), db.stockCounts(siteId, now - COUNT_WINDOW_DAYS * 86_400_000), db.stockTargets(siteId)]);
  const products = countProducts(catalog.products, catalog.suppliers, siteId);
  const own = new Set(catalog.suppliers.filter((s) => s.method === "production" && s.siteId === siteId).map((s) => s.id));
  const orders = productionQueue(data.tasks.filter((t) => t.supplierId && own.has(t.supplierId)), data.lines, data.requests, data.events, catalog.products);
  const latest = counts[0];
  return { products, counts, latest, targets, orders, rows: productionPlan(products, targets, latest, orders) };
}

/**
 * Sends a production count from the kitchen (checked), then tells whoever plans there (owners, its managers and
 * operations managers, not the person who counted) how many items are below target and how many to make.
 */
export async function sendProductionCount(db: Store, person: Pick<Person, "id" | "name">, site: Pick<Site, "id" | "name">, input: { lines: { productId: string; qty: number | null }[]; note?: string }, now: number):
  Promise<Done<{ count: StockCount; below: number; make: number; counted: number; of: number }>> {
  const { catalog } = await stockView(db, now, [site.id], 1);
  const products = countProducts(catalog.products, catalog.suppliers, site.id);
  if (!products.length) return { ok: false, error: `${site.name} has no production products to count. Add them in the catalogue first` };
  const clean = cleanCount(input.lines, products, input.note);
  if (!clean.ok) return clean;
  const count = await db.addStockCount({ siteId: site.id, countedBy: person.id, date: londonDate(now), lines: clean.value.lines, note: clean.value.note });
  const plan = await kitchenPlan(db, site.id, now);
  // This count, whatever else was sent at the same moment.
  const rows = productionPlan(plan.products, plan.targets, count, plan.orders);
  const below = belowTarget(rows).length, make = rows.filter((r) => (r.make ?? 0) > 0).length;
  const planners = (await db.people()).filter((p) => p.id !== person.id && plansProduction(p, site.id));
  const first = person.name.split(" ")[0];
  for (const p of planners) {
    await db.queueNotice({ personId: p.id, kind: "stock", title: `Production count · ${site.name}`,
      body: `${make ? `${make} item${make === 1 ? "" : "s"} to make` : "Nothing to make"}${below ? `, ${below} below target` : ""}. Counted by ${first} at ${londonHM(now)}: ${clean.value.lines.length} of ${products.length} items.`,
      dedupeKey: `prodcount|${count.id}|${p.id}`, sendAfter: afterQuietHours(now), url: `/stock/plan?site=${site.id}` });
  }
  return { ok: true, value: { count, below, make, counted: clean.value.lines.length, of: products.length } };
}

/** A request's product, supplier and progress together, for lists. */
export function describe(items: { request: StockRequest; progress: Progress }[], products: Product[], suppliers: Supplier[]) {
  return items.map((x) => ({ ...x, product: products.find((p) => p.id === x.request.productId), supplier: suppliers.find((s) => s.id === x.request.supplierId) }));
}

export type { StockData };
