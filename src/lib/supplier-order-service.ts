import { store } from "@/lib/data";
import type { Done } from "@/lib/data/stock-store";
import type { Store } from "@/lib/data/store";
import { isOwner } from "@/lib/domain/access";
import { productionQueue, withProgress, type Product, type PurchaseTask, type StockEvent, type Supplier } from "@/lib/domain/stock";
import { cleanCount, type StockCount, type StockTarget } from "@/lib/domain/stock-count";
import { countFor, isScheduled, lastRound, nextRound, orderRows, roundBefore, roundState, type OrderRow, type Round, type RoundState, type SupplierOrders } from "@/lib/domain/supplier-orders";
import { afterQuietHours, londonDate, londonHM } from "@/lib/domain/time";
import type { Person, Site } from "@/lib/domain/types";

/**
 * Scheduled supplier orders, put together (rules in src/lib/domain/supplier-orders.ts): the order screen's view of a
 * round, sending a count of a supplier's products, and the reminders tick() sends.
 */

const DAY = 86_400_000;

export interface RoundView { round: Round; before?: Round; count?: StockCount; task?: PurchaseTask; state: RoundState }
export interface SupplierView {
  supplier: Supplier; cfg: SupplierOrders & { deliversTo: string }; site: Site; products: Product[]; targets: StockTarget[];
  next?: RoundView; last?: RoundView; rows: OrderRow[];
  /** Orders for this supplier's rounds, newest first. */
  history: { task: PurchaseTask; state: RoundState; round?: Round; lines: number }[];
  events: StockEvent[];
}

/** The supplier's settings when it's on order days and delivers to a kitchen; else undefined. */
export async function scheduled(db: Store, supplierId: string) {
  const [cfgs, { suppliers }] = await Promise.all([db.supplierOrders(), db.stockCatalog()]);
  const cfg = cfgs.find((c) => c.supplierId === supplierId);
  const supplier = suppliers.find((s) => s.id === supplierId);
  return supplier && isScheduled(cfg) ? { cfg, supplier } : undefined;
}

/** Everything the order screen needs for the supplier: the next round (and the last one), its rows and the order history. */
export async function supplierView(db: Store, supplierId: string, now: number): Promise<SupplierView | undefined> {
  const [cfgs, catalog, sites] = await Promise.all([db.supplierOrders(), db.stockCatalog(), db.sites()]);
  const cfg = cfgs.find((c) => c.supplierId === supplierId);
  const supplier = catalog.suppliers.find((s) => s.id === supplierId);
  if (!supplier || !isScheduled(cfg)) return undefined;
  const site = sites.find((s) => s.id === cfg.deliversTo);
  if (!site) return undefined;
  const today = londonDate(now);
  const [counts, targets, data] = await Promise.all([db.stockCounts(site.id, now - 21 * DAY, supplierId), db.stockTargets(site.id), db.stockData({ since: now - 60 * DAY })]);
  const products = catalog.products.filter((p) => p.active && p.supplierId === supplierId);
  const tasks = data.tasks.filter((t) => t.supplierId === supplierId && t.roundAt !== undefined && !t.cancelledAt);
  const view = (round: Round | undefined): RoundView | undefined => {
    if (!round) return undefined;
    const before = roundBefore(cfg.days, round);
    const count = countFor(counts, round, before);
    const task = tasks.find((t) => t.roundAt === round.cutoffAt);
    return { round, before, count, task, state: roundState(round, now, !!count, task, data.events) };
  };
  const next = view(nextRound(cfg.days, now, today));
  const last = view(lastRound(cfg.days, now, today));
  // Still to send to the restaurants: the kitchen's production orders, for these products.
  const kitchen = catalog.suppliers.filter((s) => s.method === "production" && s.siteId === site.id).map((s) => s.id);
  const queue = productionQueue(data.tasks.filter((t) => t.supplierId && kitchen.includes(t.supplierId)), data.lines, data.requests, data.events, catalog.products);
  const toSend = new Map(queue.map((q) => [q.product.id, q.outstanding]));
  const open = withProgress(data).filter((x) => x.request.siteId === site.id && x.request.supplierId === supplierId);
  const rows = orderRows(products, targets, next?.count, toSend, open);
  const history = tasks.sort((a, b) => (b.roundAt ?? 0) - (a.roundAt ?? 0)).slice(0, 12).map((task) => {
    const round = [next, last].find((r) => r?.task?.id === task.id)?.round;
    const r: Round = round ?? { cutDate: londonDate(task.roundAt!), cutoffAt: task.roundAt!, delDate: task.requiredBy ?? londonDate(task.roundAt!), deliveryAt: task.roundAt! };
    return { task, round, state: roundState(r, now, true, task, data.events), lines: data.lines.filter((l) => l.taskId === task.id).length };
  });
  return { supplier, cfg, site, products, targets, next, last, rows, history, events: data.events };
}

/** The people to tell about a supplier's orders: whoever orders from it (active), else the owners. */
async function orderersOf(db: Store, cfg: SupplierOrders, except?: string): Promise<Person[]> {
  const people = (await db.people()).filter((p) => p.status === "active" && p.id !== except);
  const chosen = people.filter((p) => cfg.orderers.includes(p.id));
  return chosen.length ? chosen : people.filter((p) => isOwner(p));
}

/**
 * Sends a count of the supplier's products from its kitchen, then tells whoever orders (not the person who counted)
 * how many products the order suggests.
 */
export async function sendSupplierCount(db: Store, person: Pick<Person, "id" | "name">, site: Pick<Site, "id" | "name">, supplierId: string,
  input: { lines: { productId: string; qty: number | null }[]; note?: string }, now: number): Promise<Done<{ count: StockCount; toOrder: number; counted: number; of: number; supplier: string }>> {
  const s = await scheduled(db, supplierId);
  if (!s || s.cfg.deliversTo !== site.id) return { ok: false, error: "That supplier isn't counted here" };
  const products = (await db.stockCatalog()).products.filter((p) => p.active && p.supplierId === supplierId);
  const clean = cleanCount(input.lines, products, input.note);
  if (!clean.ok) return clean;
  const count = await db.addStockCount({ siteId: site.id, countedBy: person.id, date: londonDate(now), lines: clean.value.lines, note: clean.value.note, supplierId });
  const view = await supplierView(db, supplierId, now);
  const toOrder = view?.next?.count?.id === count.id ? view.rows.filter((r) => (r.suggested ?? 0) > 0).length : 0;
  const first = person.name.split(" ")[0];
  for (const p of await orderersOf(db, s.cfg, person.id)) {
    await db.queueNotice({ personId: p.id, kind: "stock", title: `${s.supplier.name} count in · ${site.name}`,
      body: `${toOrder ? `${toOrder} product${toOrder === 1 ? "" : "s"} suggested to order` : "Nothing suggested to order"}. Counted by ${first} at ${londonHM(now)}: ${clean.value.lines.length} of ${products.length}.`,
      dedupeKey: `supcount|${count.id}|${p.id}`, sendAfter: afterQuietHours(now), url: `/stock/orders/${supplierId}` });
  }
  return { ok: true, value: { count, toOrder, counted: clean.value.lines.length, of: products.length, supplier: s.supplier.name } };
}

/** After a delivery with problems: whoever orders is told what didn't come. */
export async function notifyDeliveryProblems(db: Store, supplierId: string, taskId: string, problems: string[], by: Pick<Person, "id" | "name">, now: number) {
  const s = await scheduled(db, supplierId);
  if (!s || !problems.length) return 0;
  let n = 0;
  for (const p of await orderersOf(db, s.cfg, by.id)) {
    if (await db.queueNotice({ personId: p.id, kind: "stock", title: `${s.supplier.name} delivery: ${problems.length} problem${problems.length === 1 ? "" : "s"}`,
      body: `${problems.slice(0, 4).join(", ")}${problems.length > 4 ? ` and ${problems.length - 4} more` : ""}. Confirmed by ${by.name.split(" ")[0]} at ${londonHM(now)}.`,
      dedupeKey: `supdeliv|${taskId}|${p.id}`, sendAfter: afterQuietHours(now), url: `/stock/orders/${supplierId}/${taskId}` })) n++;
  }
  return n;
}

/** How long before a cut-off whoever orders hears that the count isn't in, and how long after it the owners hear nothing was ordered. */
export const COUNT_NUDGE_MIN = 120;
export const MISSED_AFTER_MIN = 15;

/**
 * Run by tick(): on a cut-off day, from COUNT_NUDGE_MIN before it, whoever orders hears if the kitchen hasn't counted
 * yet; from MISSED_AFTER_MIN after it (for 6 hours), the owners hear if nothing was ordered. Once each per round.
 */
export async function queueSupplierReminders(now = Date.now(), db: Store = store()): Promise<number> {
  const cfgs = (await db.supplierOrders()).filter(isScheduled);
  if (!cfgs.length) return 0;
  const people = (await db.people()).filter((p) => p.status === "active");
  let queued = 0;
  for (const cfg of cfgs) {
    const view = await supplierView(db, cfg.supplierId, now);
    if (!view) continue;
    const { supplier, site } = view;
    const r = view.next;
    if (r && r.round.cutoffAt - now <= COUNT_NUDGE_MIN * 60_000 && !r.count && !r.task) {
      for (const p of await orderersOf(db, cfg)) {
        if (await db.queueNotice({ personId: p.id, kind: "stock", title: `${supplier.name}: ${site.name} hasn't counted yet`,
          body: `The order closes at ${londonHM(r.round.cutoffAt)}. Ask the closers to count, or order from what you know.`,
          dedupeKey: `supnocount|${cfg.supplierId}|${r.round.cutoffAt}|${p.id}`, sendAfter: now, url: `/stock/orders/${cfg.supplierId}` })) queued++;
      }
    }
    const l = view.last;
    const since = l ? now - l.round.cutoffAt : 0;
    if (l && since >= MISSED_AFTER_MIN * 60_000 && since < 6 * 3_600_000 && (l.state === "missed")) {
      for (const p of people.filter((x) => isOwner(x))) {
        if (await db.queueNotice({ personId: p.id, kind: "stock", title: `${supplier.name} order not placed`,
          body: `The ${londonHM(l.round.cutoffAt)} cut-off for the ${l.round.delDate} delivery to ${site.name} has passed and nothing was ordered.`,
          dedupeKey: `supmissed|${cfg.supplierId}|${l.round.cutoffAt}|${p.id}`, sendAfter: afterQuietHours(now, true), url: `/stock/orders/${cfg.supplierId}` })) queued++;
      }
    }
  }
  return queued;
}
