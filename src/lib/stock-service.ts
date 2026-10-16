import { store } from "@/lib/data";
import type { Store } from "@/lib/data/store";
import type { Done, StockData } from "@/lib/data/stock-store";
import { isOwner } from "@/lib/domain/access";
import { buyFrom, cleanLines, cleanNewItems, cleanProduct, lineEnd, runsPurchasing, sameProduct, type NewItem, methodOf, neededGroups, needsEscalation, orderingSites, productionQueue, productLabel, reqCode, taskCode, withProgress, type NeededGroup, type Product, type ProductionRow, type Progress, type StockRequest, type Supplier } from "@/lib/domain/stock";
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
export async function sendStockReport(db: Store, person: Pick<Person, "id">, site: Pick<Site, "id">, now: number): Promise<Done<{ created: StockRequest[]; again: number; noIssues: boolean; newItems: NewItem[] }>> {
  const draft = await db.stockDraft(site.id, person.id);
  if (!draft) return { ok: false, error: "There's nothing to send. Add what you need, or tap No stock issues today" };
  const { catalog } = await stockView(db, now, [site.id]);
  const clean = cleanLines(draft.lines, catalog.products);
  if (!clean.ok) return clean;
  const extras = cleanNewItems(draft.extras);
  if (!extras.ok) return extras;
  const empty = !clean.value.length && !extras.value.length;
  if (empty && !draft.noIssues) return { ok: false, error: "Add what you need, or tap No stock issues today" };
  if (!empty && draft.noIssues) await db.saveStockDraft(site.id, person.id, draft.date, clean.value, false, extras.value);
  const sent = await db.submitStockReport(draft.id, person.id, clean.value, catalog.products, extras.value);
  if (!sent) return { ok: false, error: "That report has already been sent" };
  await routeProduction(db, sent.created, person.id, now, catalog.suppliers);
  if (sent.newItems.length) await notifyNewItems(db, sent.newItems, site.id, now);
  return { ok: true, value: { created: sent.created, again: sent.again, noIssues: empty, newItems: sent.newItems } };
}

/** Tells the owners a restaurant asked for something that isn't in the catalogue (one message per report and owner). */
async function notifyNewItems(db: Store, items: NewItem[], siteId: string, now: number): Promise<void> {
  const [people, site] = await Promise.all([db.people(), db.site(siteId)]);
  const names = items.map((i) => `${i.qty} × ${i.name}${i.size ? ` (${i.size})` : ""}`);
  for (const p of people.filter((x) => runsPurchasing(x))) {
    await db.queueNotice({ personId: p.id, kind: "stock", title: `New item${items.length === 1 ? "" : "s"} asked for · ${site?.name ?? siteId}`,
      body: `${names.slice(0, 4).join(", ")}${names.length > 4 ? ` and ${names.length - 4} more` : ""}. Not in the catalogue yet: add ${items.length === 1 ? "it" : "them"} on Stock needed.`,
      dedupeKey: `newitem|${items[0].id}|${p.id}`, sendAfter: afterQuietHours(now), url: "/stock/needed" });
  }
}

/**
 * The owner adds a new item to the catalogue: as a new product (name, size, category, supplier, checked like any
 * product), or as a product that's already there; then it's asked for at its restaurant with this quantity, so it's on
 * Stock needed under its supplier (production: straight onto the kitchen's order) and on the list for next time.
 */
export async function addNewItem(db: Store, person: Pick<Person, "id" | "status" | "access">, id: string,
  input: { productId: string; qty: number } | { name: string; size?: string; category?: string; supplierId: string; qty: number }, now: number): Promise<Done<{ productId: string; created: boolean }>> {
  if (!runsPurchasing(person)) return { ok: false, error: "Only the owner adds to the catalogue" };
  const item = (await db.stockNewItems({ open: true })).find((n) => n.id === id);
  if (!item) return { ok: false, error: "That new item has already been dealt with. Refresh to see the list as it is now" };
  const { products, suppliers } = await db.stockCatalog();
  let product: Product | undefined;
  let created = false;
  if ("productId" in input) {
    product = products.find((p) => p.id === input.productId && p.active);
    if (!product) return { ok: false, error: "That product isn't in the catalogue" };
  } else {
    if (!input.supplierId) return { ok: false, error: "Choose who it's bought from" };
    const clean = cleanProduct({ name: input.name, size: input.size, category: input.category, supplierId: input.supplierId }, suppliers.filter((s) => s.active), [], undefined);
    if (!clean.ok) return clean;
    product = products.find((p) => sameProduct(p, clean.value));
    if (product && !product.active) return { ok: false, error: `${product.name} is in the catalogue but switched off. Switch it on in the catalogue first` };
    if (!product) {
      const pid = await db.saveProduct(undefined, clean.value, true);
      if (!pid) return { ok: false, error: "That product is already in the catalogue" };
      product = (await db.stockCatalog()).products.find((p) => p.id === pid);
      created = true;
    }
  }
  if (!product) return { ok: false, error: "That product isn't in the catalogue" };
  const qty = Math.round(Number(input.qty) * 100) / 100;
  if (!Number.isFinite(qty) || qty <= 0 || qty > 9999) return { ok: false, error: "Quantities are from 1 to 9999" };
  const r = await db.decideNewItem(id, person.id, { productId: product.id, supplierId: product.supplierId, qty });
  if (!r.ok) return r;
  if (r.value.request) await routeProduction(db, [r.value.request], person.id, now);
  return { ok: true, value: { productId: product.id, created } };
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
      dedupeKey: `stocktask|${t.id}|${personId}|${role}`, sendAfter: t.priority === "urgent" ? afterQuietHours(now, true) : afterQuietHours(now), url: "/stock/tasks" })) sent++;
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
        dedupeKey: `stockurgent|${r.id}|${o.id}`, sendAfter: afterQuietHours(now, true), url: "/stock/needed" })) queued++;
    }
  }
  return queued;
}

// ---------- Stock needed ----------

/** The Stock needed page for this person: every supplier's list at the sites they order for. */
export async function neededView(db: Store, person: Pick<Person, "status" | "access">, now: number) {
  const [{ catalog, data, items }, sites] = await Promise.all([stockView(db, now), db.sites()]);
  const siteIds = orderingSites(person, sites.filter((s) => s.status === "open").map((s) => s.id));
  const groups = neededGroups(items, data, catalog.products, catalog.suppliers, siteIds);
  return { catalog, data, items, sites, siteIds, groups };
}

/** One supplier's group as it is now (the page sends its key), or undefined. */
export async function neededGroup(db: Store, person: Pick<Person, "status" | "access">, key: string, now: number): Promise<{ group?: NeededGroup; siteIds: string[] }> {
  const v = await neededView(db, person, now);
  return { group: v.groups.find((g) => g.key === key), siteIds: v.siteIds };
}

const TICK_NOTE = "Ticked off on Stock needed";

/**
 * Ticks products off a supplier's list: done. Ordered or bought products become one task for the person ticking, with
 * a line each, the order placed (bought in full) and arrived (a receipt), so nothing is left waiting. A production
 * kitchen's products are sent (dispatched) and arrived. Only what's still needed now is ticked (two people at once
 * can't tick the same thing twice: the task's lines are checked again in the store).
 */
export async function tickNeeded(db: Store, person: Pick<Person, "id" | "status" | "access">, key: string, productIds: string[], now: number): Promise<Done<{ ticked: number }>> {
  let { group } = await neededGroup(db, person, key, now);
  if (!group) return { ok: false, error: "That list has changed. Refresh and try again" };
  // A production product asked for but not yet on the kitchen's order (it had no amount then): onto it first.
  const unrouted = group.production ? group.rows.filter((r) => productIds.includes(r.product.id)).flatMap((r) => r.requestIds) : [];
  if (unrouted.length) {
    const reqs = (await db.stockData({ since: stockSince(now) })).requests.filter((r) => unrouted.includes(r.id));
    await routeProduction(db, reqs, person.id, now);
    group = (await neededGroup(db, person, key, now)).group;
    if (!group) return { ok: false, error: "That list has changed. Refresh and try again" };
  }
  const rows = group.rows.filter((r) => productIds.includes(r.product.id));
  if (!rows.length) return { ok: false, error: "Those are already done. Refresh to see the list as it is now" };
  let ticked = 0;
  if (group.production) {
    const data = await db.stockData({ since: stockSince(now) });
    for (const id of rows.flatMap((r) => r.lineIds)) {
      const line = data.lines.find((l) => l.id === id);
      if (!line || lineEnd(line, data.events)) continue;
      const r = await db.addStockEvent({ by: person.id, kind: "dispatched", lineId: id, qty: line.qty, text: TICK_NOTE });
      if (!r.ok) continue;
      await db.addStockReceipt(line.requestId, line.qty, person.id, TICK_NOTE);
      ticked++;
    }
    return ticked ? { ok: true, value: { ticked: rows.length } } : { ok: false, error: "Those have already been sent" };
  }
  const items = withProgress(await db.stockData({ since: stockSince(now) }));
  const lines = rows.flatMap((r) => r.requestIds).flatMap((id) => {
    const x = items.find((i) => i.request.id === id);
    return x && x.progress.toPlan > 0 ? [{ requestId: id, qty: x.progress.toPlan }] : [];
  });
  if (!lines.length) return { ok: false, error: "Those are already done. Refresh to see the list as it is now" };
  const method = group.supplier?.method ?? "shop";
  const made = await db.createStockTask({ supplierId: group.supplier?.id, method, assigneeId: person.id, priority: "normal", note: TICK_NOTE, createdBy: person.id }, lines);
  if (!made.ok) return made;
  const placed = await db.orderPlaced(made.value, person.id, undefined, undefined);
  if (!placed.ok) return placed;
  for (const l of lines) await db.addStockReceipt(l.requestId, l.qty, person.id, TICK_NOTE);
  return { ok: true, value: { ticked: rows.length } };
}

const CLEAR_NOTE = "Cleared from Stock needed";

/**
 * Clears Stock needed without ordering anything: every list given to a driver is taken back, every request on the page
 * is cancelled (kept, with the reason, in the history), and new items still waiting are marked not needed. A request
 * that's partly bought already can't be cancelled; it's left on the list and counted.
 */
export async function clearNeeded(db: Store, person: Pick<Person, "id" | "status" | "access">, now: number): Promise<Done<{ cancelled: number; kept: number; lists: number; newItems: number }>> {
  const v = await neededView(db, person, now);
  if (!v.siteIds.length) return { ok: false, error: "Only the owner and operations managers order stock" };
  let lists = 0;
  for (const t of v.groups.flatMap((g) => g.drivers.map((d) => d.task))) if (await db.cancelStockTask(t.id, person.id, CLEAR_NOTE)) lists++;
  const lineReq = new Map(v.data.lines.map((l) => [l.id, l.requestId]));
  const ids = new Set<string>();
  for (const g of v.groups) {
    for (const r of g.rows) {
      for (const id of [...r.requestIds, ...r.unknownIds]) ids.add(id);
      for (const l of r.lineIds) { const id = lineReq.get(l); if (id) ids.add(id); }
    }
    for (const d of g.drivers) for (const l of v.data.lines.filter((x) => x.taskId === d.task.id)) ids.add(l.requestId);
  }
  let cancelled = 0, kept = 0;
  for (const id of ids) {
    const req = v.data.requests.find((r) => r.id === id);
    if (!req || req.cancelledAt || !v.siteIds.includes(req.siteId)) continue;
    const r = await db.changeStockRequest(id, { cancel: CLEAR_NOTE }, person.id);
    if (r.ok) cancelled++; else kept++;
  }
  let newItems = 0;
  if (runsPurchasing(person)) {
    for (const n of await db.stockNewItems({ open: true, siteIds: v.siteIds })) if ((await db.decideNewItem(n.id, person.id, { dismiss: CLEAR_NOTE })).ok) newItems++;
  }
  return { ok: true, value: { cancelled, kept, lists, newItems } };
}

/** Gives what a supplier's list still needs (or some of it) to a driver: one task, theirs to tick off on their phone. */
export async function giveToDriver(db: Store, person: Pick<Person, "id" | "status" | "access">, key: string, driverId: string, productIds: string[] | undefined, now: number): Promise<Done<string>> {
  const { group } = await neededGroup(db, person, key, now);
  if (!group || group.production) return { ok: false, error: "That list has changed. Refresh and try again" };
  const items = withProgress(await db.stockData({ since: stockSince(now) }));
  const lines = group.rows.filter((r) => !productIds || productIds.includes(r.product.id)).flatMap((r) => r.requestIds).flatMap((id) => {
    const x = items.find((i) => i.request.id === id);
    return x && x.progress.toPlan > 0 ? [{ requestId: id, qty: x.progress.toPlan }] : [];
  });
  if (!lines.length) return { ok: false, error: "There's nothing on this list to give out. Items without an amount need one first" };
  const made = await db.createStockTask({ supplierId: group.supplier?.id, method: group.supplier?.method ?? "shop", assigneeId: driverId, priority: "normal", createdBy: person.id }, lines);
  if (!made.ok) return made;
  await notifyTask(db, made.value, now);
  return made;
}

/**
 * Moves an item on Stock needed to another supplier that sells it (before anyone has it): each of its requests there
 * now, so it shows on that supplier's card (and its PDF or driver's list). One partly bought already stays put.
 */
export async function moveNeeded(db: Store, person: Pick<Person, "id" | "status" | "access">, key: string, productId: string, supplierId: string, now: number): Promise<Done<{ moved: number; kept: number; to: string }>> {
  const { group } = await neededGroup(db, person, key, now);
  const row = group?.rows.find((r) => r.product.id === productId);
  if (!group || group.production || !row) return { ok: false, error: "That list has changed. Refresh and try again" };
  const { suppliers } = await db.stockCatalog();
  const to = buyFrom(row.product, suppliers).find((s) => s.id === supplierId);
  if (!to || to.id === group.supplier?.id) return { ok: false, error: `${row.product.name} isn't sold there. Add the supplier to it in the catalogue first` };
  let moved = 0, kept = 0;
  for (const id of [...row.requestIds, ...row.unknownIds]) {
    const r = await db.changeStockRequest(id, { supplierId: to.id }, person.id);
    if (r.ok) moved++; else kept++;
  }
  if (!moved) return { ok: false, error: "Part of it is already bought, so it stays where it is" };
  return { ok: true, value: { moved, kept, to: to.name } };
}

/**
 * A driver ticks a line off: bought (and so arrived), or couldn't get it (it goes back on the Stock needed list). Bought
 * somewhere else on the way (`at`): one of the other suppliers that sell it, noted on the record.
 */
export async function driverTick(db: Store, person: Pick<Person, "id">, lineId: string, got: boolean, now: number, at?: string): Promise<Done> {
  const data = await db.stockData({ since: stockSince(now) });
  const line = data.lines.find((l) => l.id === lineId);
  const task = line && data.tasks.find((t) => t.id === line.taskId);
  if (!line || !task || task.cancelledAt) return { ok: false, error: "That isn't on your list any more" };
  if (task.assigneeId !== person.id && task.driverId !== person.id) return { ok: false, error: "That isn't on your list" };
  let where: string | undefined;
  if (got && at && at !== task.supplierId) {
    const { products, suppliers } = await db.stockCatalog();
    const req = data.requests.find((x) => x.id === line.requestId);
    const product = req && products.find((p) => p.id === req.productId);
    where = product && buyFrom(product, suppliers).find((s) => s.id === at)?.name;
    if (!where) return { ok: false, error: "That shop isn't one that sells it" };
  }
  const r = await db.addStockEvent({ by: person.id, kind: got ? "bought" : "unavailable", lineId, qty: got ? line.qty : undefined, text: got ? (where ? `Bought at ${where}` : "Ticked off") : "Couldn't get it" });
  if (!r.ok) return r;
  if (got) await db.addStockReceipt(line.requestId, line.qty, person.id, "Bought by the driver");
  return { ok: true, value: undefined };
}

/** Where the supplier delivers (a production kitchen's name), for its order sheet. */
export async function deliversTo(db: Store, supplierId: string | undefined): Promise<string | undefined> {
  if (!supplierId) return undefined;
  const d = (await db.supplierDelivers()).find((x) => x.supplierId === supplierId);
  return d?.deliversTo ? (await db.site(d.deliversTo))?.name : undefined;
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
