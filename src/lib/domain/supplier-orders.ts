import { isOwner } from "./access";
import { lineEnd, progress, QTY_MAX, type Product, type Progress, type PurchaseTask, type Receipt, type StockEvent, type StockRequest, type Supplier, type TaskLine } from "./stock";
import { addDays, londonToUtc } from "./time";
import type { Person, Site, SiteId } from "./types";

/**
 * Scheduled supplier orders (first: Surelygrow). A supplier can have order days (a cut-off and a delivery, UK
 * wall-clock, so British Summer Time is handled), the people who order from it, and a production kitchen it delivers
 * to. Then:
 *
 * - On a cut-off day the kitchen's closers count the supplier's products (a count with the supplier on it).
 * - Whoever orders sees, per product: on the shelf, par (the kitchen's target), still to send to the restaurants on
 *   the kitchen's production orders, and suggested = par + still to send − on the shelf (never below 0). They change
 *   it as they like; their number is the order.
 * - Generating makes one purchase task for the round (its cut-off moment): what was reported at the kitchen and is
 *   still waiting is used first, the rest becomes new requests, so nothing is ordered twice.
 * - The kitchen confirms what arrived; what didn't come is recorded as short and goes back to waiting.
 * - A restaurant asking for one of its products gets it from the kitchen (its production order), never from the
 *   supplier, and only products marked for restaurants show there.
 */

export interface OrderDay { cutDow: number; cutHm: string; delDow: number; delHm: string }
export interface SupplierOrders { supplierId: string; deliversTo?: SiteId; days: OrderDay[]; orderers: string[]; updatedAt?: number }

export const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The weekday of an ISO date (0 Sunday). */
export const dowOf = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();

/** Order settings, checked: a production kitchen to deliver to (or none), up to 7 order days (one per cut-off weekday), active people to order. */
export function cleanOrderSettings(input: { deliversTo?: string | null; days: { cutDow: number; cutHm: string; delDow: number; delHm: string }[]; orderers: string[] },
  sites: Pick<Site, "id" | "kind">[], people: Pick<Person, "id" | "status">[]):
  { ok: true; value: Omit<SupplierOrders, "supplierId" | "updatedAt"> } | { ok: false; error: string } {
  const deliversTo = input.deliversTo || undefined;
  if (deliversTo && !sites.some((s) => s.id === deliversTo && s.kind === "production")) return { ok: false, error: "It can only deliver to a production kitchen" };
  if (input.days.length > 7) return { ok: false, error: "At most one order day per weekday" };
  const days: OrderDay[] = [];
  for (const d of input.days) {
    const ok = [d.cutDow, d.delDow].every((n) => Number.isInteger(n) && n >= 0 && n <= 6) && HM.test(d.cutHm) && HM.test(d.delHm);
    if (!ok) return { ok: false, error: "Each order day needs a weekday and a time like 20:00" };
    if (days.some((x) => x.cutDow === d.cutDow)) return { ok: false, error: `${DOW[d.cutDow]} is there twice` };
    days.push({ cutDow: d.cutDow, cutHm: d.cutHm, delDow: d.delDow, delHm: d.delHm });
  }
  days.sort((a, b) => a.cutDow - b.cutDow);
  const orderers = [...new Set(input.orderers)];
  if (orderers.length > 10) return { ok: false, error: "At most 10 people order from one supplier" };
  if (orderers.some((id) => !people.some((p) => p.id === id && p.status === "active"))) return { ok: false, error: "Everyone who orders must be an active member of staff" };
  return { ok: true, value: { ...(deliversTo ? { deliversTo } : {}), days, orderers } };
}

// ---------- rounds ----------

export interface Round { cutDate: string; cutoffAt: number; delDate: string; deliveryAt: number }

/** Days from a cut-off to its delivery: the next delivery weekday after it (the same day only if later that day). */
const daysToDelivery = (d: OrderDay) => {
  const k = (d.delDow - d.cutDow + 7) % 7;
  return k === 0 && d.delHm <= d.cutHm ? 7 : k;
};

/** Every round whose cut-off falls from a week before `fromDate` to two weeks after, in time order. */
export function roundsAround(days: OrderDay[], fromDate: string): Round[] {
  const out: Round[] = [];
  for (let i = -8; i <= 15; i++) {
    const date = addDays(fromDate, i);
    for (const d of days.filter((x) => x.cutDow === dowOf(date))) {
      const delDate = addDays(date, daysToDelivery(d));
      out.push({ cutDate: date, cutoffAt: londonToUtc(date, d.cutHm), delDate, deliveryAt: londonToUtc(delDate, d.delHm) });
    }
  }
  return out.sort((a, b) => a.cutoffAt - b.cutoffAt);
}
/** The round whose cut-off is next (now or later). */
export const nextRound = (days: OrderDay[], now: number, today: string) => roundsAround(days, today).find((r) => r.cutoffAt >= now);
/** The latest round whose cut-off has passed. */
export const lastRound = (days: OrderDay[], now: number, today: string) => roundsAround(days, today).filter((r) => r.cutoffAt < now).at(-1);
/** The round before this one (its cut-off starts this round's counting window). */
export const roundBefore = (days: OrderDay[], r: Round) => roundsAround(days, r.cutDate).filter((x) => x.cutoffAt < r.cutoffAt).at(-1);

/** The count for a round: the latest one sent after the round before it closed, up to its own cut-off. */
export function countFor<C extends { createdAt: number }>(counts: C[], round: Round, before?: Round): C | undefined {
  return counts.filter((c) => c.createdAt <= round.cutoffAt && (!before || c.createdAt > before.cutoffAt)).sort((a, b) => b.createdAt - a.createdAt)[0];
}

export type RoundState = "counting" | "review" | "generated" | "ordered" | "delivered" | "short" | "missed";
export const ROUND_LABEL: Record<RoundState, string> = {
  counting: "Waiting for the count", review: "Ready for review", generated: "Made, not placed yet", ordered: "Ordered",
  delivered: "Delivered", short: "Delivered · short", missed: "Deadline missed",
};
/** Where a round stands: its order (if any) and that order's events, else whether it's been counted and the cut-off has passed. */
export function roundState(round: Round, now: number, counted: boolean, task: Pick<PurchaseTask, "id"> | undefined, events: Pick<StockEvent, "kind" | "taskId">[]): RoundState {
  if (task) {
    const on = events.filter((e) => e.taskId === task.id);
    if (on.some((e) => e.kind === "delivered")) return on.some((e) => e.kind === "short") ? "short" : "delivered";
    if (on.some((e) => e.kind === "ordered")) return "ordered";
    return now > round.cutoffAt ? "missed" : "generated";
  }
  if (now > round.cutoffAt) return "missed";
  return counted ? "review" : "counting";
}

// ---------- who ----------

/** Ordering from a supplier: owners, and the people the owner chose for it. */
export const canOrder = (p: Pick<Person, "id" | "status" | "access">, cfg: Pick<SupplierOrders, "orderers"> | undefined) =>
  p.status === "active" && (isOwner(p) || !!cfg?.orderers.includes(p.id));

/** A supplier on order days that delivers to a kitchen. */
export const isScheduled = (cfg: SupplierOrders | undefined): cfg is SupplierOrders & { deliversTo: SiteId } => !!cfg?.deliversTo && cfg.days.length > 0;

/**
 * Who a site gets a product from. A supplier that delivers only to a kitchen supplies the restaurants through that
 * kitchen: their requests go to the kitchen's production "supplier" (and so onto its production orders).
 */
export function supplierAt(product: Pick<Product, "supplierId">, siteId: SiteId, cfgs: SupplierOrders[], suppliers: Pick<Supplier, "id" | "method" | "siteId">[]): string | undefined {
  const cfg = cfgs.find((c) => c.supplierId === product.supplierId);
  if (!cfg?.deliversTo || cfg.deliversTo === siteId) return product.supplierId;
  return suppliers.find((s) => s.method === "production" && s.siteId === cfg.deliversTo)?.id ?? product.supplierId;
}
/** Whether a site's staff can ask for a product: not one a kitchen-only supplier sends that isn't marked for restaurants. */
export function shownAt(product: Pick<Product, "supplierId" | "forRestaurants">, siteId: SiteId, cfgs: SupplierOrders[]): boolean {
  const cfg = cfgs.find((c) => c.supplierId === product.supplierId);
  return !cfg?.deliversTo || cfg.deliversTo === siteId || product.forRestaurants !== false;
}

// ---------- the order ----------

export type Group = "Meat" | "Vegetables" | "Other";
export const GROUPS: Group[] = ["Meat", "Vegetables", "Other"];
export const groupOf = (category?: string): Group => (/meat|fish/i.test(category ?? "") ? "Meat" : /veg|fruit|tofu/i.test(category ?? "") ? "Vegetables" : "Other");

export type RowState = "order" | "enough" | "not_counted" | "no_par";
export interface OrderRow {
  product: Product; group: Group;
  onHand?: number; par?: number;
  /** Still to send to the restaurants on the kitchen's production orders. */
  toSend: number;
  /** Reported at the kitchen and still waiting: known quantities, and how many said "not sure". */
  reported: { qty: number; unsure: number; names: string[] };
  /** par + still to send − on the shelf, never below 0. Unset when it wasn't counted. */
  suggested?: number;
  state: RowState;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The order screen's rows: every product of the supplier, meat then vegetables then other, catalogue order within. */
export function orderRows(products: Product[], targets: { productId: string; qty?: number }[], count: { lines: { productId: string; qty: number }[] } | undefined,
  toSend: Map<string, number>, open: { request: StockRequest; progress: Progress }[]): OrderRow[] {
  const par = new Map(targets.filter((t) => t.qty !== undefined).map((t) => [t.productId, t.qty!]));
  const shelf = new Map((count?.lines ?? []).map((l) => [l.productId, l.qty]));
  return products.map((product, i) => {
    const mine = open.filter((o) => o.request.productId === product.id && !o.request.cancelledAt && (o.progress.toPlan > 0 || o.progress.state === "needs_qty"));
    const reported = { qty: round2(mine.reduce((s, o) => s + o.progress.toPlan, 0)), unsure: mine.filter((o) => o.progress.wanted === undefined).length,
      names: [...new Set(mine.map((o) => o.request.requestedByName?.split(" ")[0]).filter(Boolean) as string[])] };
    const onHand = shelf.get(product.id), p = par.get(product.id), send = round2(toSend.get(product.id) ?? 0);
    const base = { i, product, group: groupOf(product.category), onHand, par: p, toSend: send, reported };
    if (onHand === undefined) return { ...base, state: "not_counted" as const };
    const suggested = round2(Math.max(0, (p ?? 0) + send - onHand));
    return { ...base, suggested, state: suggested > 0 ? ("order" as const) : p === undefined ? ("no_par" as const) : ("enough" as const) };
  }).sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || a.i - b.i).map(({ i, ...r }) => { void i; return r; });
}

/** What the order box starts at: the suggestion, else what was reported. */
export const startQty = (r: Pick<OrderRow, "suggested" | "reported">) => (r.suggested ? r.suggested : r.reported.qty || undefined);

/** The order's lines, checked: the supplier's products, once each, a quantity above 0; at least one. */
export function cleanOrderLines(lines: { productId: string; qty: number | null | undefined }[], allowed: Pick<Product, "id">[]):
  { ok: true; value: { productId: string; qty: number }[] } | { ok: false; error: string } {
  const ids = new Set(allowed.map((p) => p.id));
  const out: { productId: string; qty: number }[] = [];
  for (const l of lines) {
    if (l.qty === null || l.qty === undefined || l.qty === 0) continue;
    if (!ids.has(l.productId)) return { ok: false, error: "One of the products isn't this supplier's any more. Reload the page and try again" };
    if (typeof l.qty !== "number" || !Number.isFinite(l.qty) || l.qty < 0 || l.qty > QTY_MAX) return { ok: false, error: `Order quantities are above 0 and up to ${QTY_MAX}` };
    if (out.some((o) => o.productId === l.productId)) continue;
    out.push({ productId: l.productId, qty: round2(l.qty) });
  }
  if (!out.length) return { ok: false, error: "There's nothing to order: give at least one product a quantity" };
  return { ok: true, value: out };
}

/**
 * How an order becomes lines: for each product, what was reported at the kitchen and is still waiting (oldest first)
 * is used first; a "not sure" one is given the order's quantity; anything left over is a new request.
 */
export function planOrderLines(lines: { productId: string; qty: number }[], open: { request: StockRequest; progress: Progress }[], siteId: SiteId, supplierId: string):
  { use: { requestId: string; qty: number; setQty?: number }[]; create: { productId: string; qty: number }[] } {
  const use: { requestId: string; qty: number; setQty?: number }[] = [];
  const create: { productId: string; qty: number }[] = [];
  for (const l of lines) {
    let left = l.qty;
    const avail = open.filter((o) => o.request.siteId === siteId && o.request.productId === l.productId && o.request.supplierId === supplierId && !o.request.cancelledAt
      && (o.progress.toPlan > 0 || o.progress.state === "needs_qty")).sort((a, b) => a.request.createdAt - b.request.createdAt);
    for (const o of avail) {
      if (left <= 0) break;
      if (o.progress.wanted === undefined) { use.push({ requestId: o.request.id, qty: left, setQty: left }); left = 0; break; }
      const take = round2(Math.min(left, o.progress.toPlan));
      use.push({ requestId: o.request.id, qty: take });
      left = round2(left - take);
    }
    if (left > 0) create.push({ productId: l.productId, qty: left });
  }
  return { use, create };
}

const qtyStr = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));
const fullDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** The order as plain text for WhatsApp or email: who it's for, where and when, then each group's lines. */
export function orderText(o: { supplier: string; deliverTo: string; delDate: string; delHm: string; ref: string; lines: { name: string; size?: string; qty: number; group: Group }[] }): string {
  const out = [`PHO & CO order for ${o.supplier}`, `Deliver to: ${o.deliverTo}`, `${fullDate(o.delDate)} by ${o.delHm} · our ref ${o.ref}`];
  for (const g of GROUPS) {
    const ls = o.lines.filter((l) => l.group === g);
    if (!ls.length) continue;
    out.push("", g.toUpperCase(), ...ls.map((l) => `${qtyStr(l.qty)} × ${l.name}${l.size ? ` (${l.size})` : ""}`));
  }
  out.push("", `${o.lines.length} product${o.lines.length === 1 ? "" : "s"} · thank you`);
  return out.join("\n");
}

/** What a delivery confirmation records per line: what arrived, and why the rest didn't. */
export type Outcome = "arrived" | "short" | "missing" | "wrong";
export const OUTCOME_LABEL: Record<Outcome, string> = { arrived: "Arrived", short: "Short", missing: "Not delivered", wrong: "Wrong or damaged" };
export function checkDelivery(lines: { lineId: string; arrived: number; outcome: Outcome }[], ordered: Map<string, number>):
  { ok: true; value: { lineId: string; arrived: number; missing: number; outcome: Outcome }[] } | { ok: false; error: string } {
  const out: { lineId: string; arrived: number; missing: number; outcome: Outcome }[] = [];
  for (const l of lines) {
    const q = ordered.get(l.lineId);
    if (q === undefined) return { ok: false, error: "One of the lines isn't on this order. Reload the page" };
    if (out.some((o) => o.lineId === l.lineId)) continue;
    const arrived = round2(Number(l.arrived));
    if (!Number.isFinite(arrived) || arrived < 0 || arrived > q + 1e-9) return { ok: false, error: `Arrived is from 0 to what was ordered (${qtyStr(q)})` };
    const missing = round2(q - arrived);
    const outcome: Outcome = missing <= 0 ? "arrived" : arrived === 0 && l.outcome === "arrived" ? "missing" : l.outcome === "arrived" ? "short" : l.outcome;
    out.push({ lineId: l.lineId, arrived, missing: Math.max(0, missing), outcome });
  }
  if (out.length !== ordered.size) return { ok: false, error: "Say what happened to every line" };
  return { ok: true, value: out };
}

/**
 * A confirmation against the records as they are inside the store's transaction: every line of the order, each one
 * bought (the order was placed), arrived + not arrived = what was bought, and never more arriving than is still to
 * come for its request.
 */
export function checkDeliveryAgainst(taskLines: TaskLine[], d: { requests: StockRequest[]; lines: TaskLine[]; events: StockEvent[]; receipts: Receipt[]; tasks: Pick<PurchaseTask, "id" | "cancelledAt">[] },
  input: { lineId: string; arrived: number; missing: number; outcome: Outcome }[]):
  { ok: true; value: { lineId: string; requestId: string; arrived: number; missing: number; outcome: Outcome }[] } | { ok: false; error: string } {
  const out: { lineId: string; requestId: string; arrived: number; missing: number; outcome: Outcome }[] = [];
  for (const l of taskLines) {
    const end = lineEnd(l, d.events);
    if (!end || end.kind !== "bought") return { ok: false, error: "Mark the order placed before confirming the delivery" };
    const i = input.find((x) => x.lineId === l.id);
    if (!i) return { ok: false, error: "Say what happened to every line" };
    if (Math.abs(i.arrived + i.missing - end.qty) > 1e-9) return { ok: false, error: "The numbers don't match the order. Reload the page" };
    const r = d.requests.find((x) => x.id === l.requestId);
    if (!r) return { ok: false, error: "One of the requests isn't there any more" };
    const p = progress(r, d.lines, d.events, d.receipts, d.tasks);
    if (i.arrived > p.toReceive + 1e-9) return { ok: false, error: "Some of it has already been confirmed. Reload the page" };
    out.push({ lineId: l.id, requestId: r.id, arrived: i.arrived, missing: i.missing, outcome: i.outcome });
  }
  return { ok: true, value: out };
}
