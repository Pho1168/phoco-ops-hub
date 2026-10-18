import { isLead, isOwner, leadSites } from "./access";
import { addDays, londonDate, londonToUtc } from "./time";
import type { Person, Site, SiteId } from "./types";

/**
 * Stock & Purchasing. Staff say what they need and how many (a report of lines); each line becomes a request (SR-…).
 * The owner and operations managers see it all on one page, Stock needed, grouped by supplier, and tick it off when
 * it's ordered or bought, or give a shop run to a driver, who ticks it off on their phone. Behind a tick is a purchase
 * task (PT-…) of lines, one per request, and a log of events that are only ever added (bought, unavailable,
 * dispatched, …); a tick also records it as arrived (a receipt), so it's done. Quantities are never mixed up:
 * wanted, planned, obtained, received.
 *
 * Products that come from a production kitchen (a supplier whose method is "production") skip the owner: they go
 * straight onto that kitchen's production order for the restaurant, where the team picks, packs and dispatches them.
 */

// ---------- catalogue ----------

export type SupplyMethod = "shop" | "online" | "delivery" | "production";
export const METHODS: { id: SupplyMethod; label: string; who: string; hint: string }[] = [
  { id: "shop", label: "Shop trip", who: "Driver", hint: "Someone drives to the shop or wholesaler and buys it" },
  { id: "online", label: "Online order", who: "Buyer", hint: "Ordered on a website: delivered, or collected by a driver" },
  { id: "delivery", label: "Supplier delivers", who: "Orders it", hint: "Someone places the order; the supplier delivers" },
  { id: "production", label: "Production kitchen", who: "Production team", hint: "Made or picked at the production kitchen and sent over" },
];
export const methodOf = (id: string) => METHODS.find((m) => m.id === id);

export interface Supplier {
  id: string; name: string; method: SupplyMethod;
  /** The production kitchen this "supplier" is (method production). */
  siteId?: SiteId;
  /** Minimum order, delivery charge, cut-off: free text the owner keeps up to date. */
  note?: string;
  /** The supplier's website (https only). */
  link?: string;
  active: boolean;
}

export interface Product {
  id: string; name: string;
  /** What one counts as: "1kg", "Case x 14", "10L". Staff order in these. */
  size?: string;
  category?: string;
  /** The preferred supplier. Unset: the owner picks one when it's requested. */
  supplierId?: string;
  active: boolean;
  /** A product page at the supplier (https only), for online buyers. */
  link?: string;
  /** The name it had in the order sheet it was imported from, kept so it can be traced. */
  importName?: string;
  /** False: restaurants can't ask for it when its supplier delivers only to a kitchen (raw ingredients). Default true. */
  forRestaurants?: boolean;
  /** Other suppliers that also sell it (not the preferred one), for buying it wherever suits the run. */
  alsoFrom?: string[];
}

/** A reference price (pence, ex VAT) on a date: history, never a promise. */
export interface Price { productId: string; pence: number; on: string; note?: string }

const HTTPS = /^https:\/\/[^\s]+$/;
export function cleanSupplier(input: { name: string; method: string; note?: string; link?: string; siteId?: string }, existing: Pick<Supplier, "id" | "name">[], id?: string):
  { ok: true; value: Omit<Supplier, "id" | "active"> } | { ok: false; error: string } {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 60) return { ok: false, error: "Give the supplier a name" };
  if (existing.some((s) => s.id !== id && s.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: `There's already a supplier called ${name}` };
  const m = methodOf(input.method);
  if (!m) return { ok: false, error: "Choose how it's bought" };
  if (m.id === "production" && !input.siteId) return { ok: false, error: "Choose which production kitchen it is" };
  const link = input.link?.trim() || undefined;
  if (link && !HTTPS.test(link)) return { ok: false, error: "The website must start with https://" };
  const note = input.note?.trim().slice(0, 300) || undefined;
  return { ok: true, value: { name, method: m.id, ...(m.id === "production" ? { siteId: input.siteId } : {}), ...(note ? { note } : {}), ...(link ? { link } : {}) } };
}

export function cleanProduct(input: { name: string; size?: string; category?: string; supplierId?: string; link?: string }, suppliers: Pick<Supplier, "id">[], existing: Pick<Product, "id" | "name" | "size" | "supplierId">[], id?: string):
  { ok: true; value: Pick<Product, "name" | "size" | "category" | "supplierId" | "link"> } | { ok: false; error: string } {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) return { ok: false, error: "Give the product a name" };
  const size = input.size?.trim().replace(/\s+/g, " ").slice(0, 40) || undefined;
  const category = input.category?.trim().slice(0, 40) || undefined;
  const supplierId = input.supplierId || undefined;
  if (supplierId && !suppliers.some((s) => s.id === supplierId)) return { ok: false, error: "That supplier isn't in the list" };
  const link = input.link?.trim() || undefined;
  if (link && !HTTPS.test(link)) return { ok: false, error: "The link must start with https://" };
  // The same name and size from the same supplier is the same product; different sizes or suppliers stay separate.
  if (existing.some((p) => p.id !== id && sameProduct(p, { name, size, supplierId }))) return { ok: false, error: `${name}${size ? ` (${size})` : ""} from that supplier is already in the catalogue` };
  return { ok: true, value: { name, size, category, supplierId, link } };
}
const norm = (s?: string) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
export const ALSO_FROM_MAX = 6;
/** A product's other suppliers, checked: active, not a production kitchen, not the preferred one, once each, at most ALSO_FROM_MAX. */
export function cleanAlsoFrom(ids: string[], preferredId: string | undefined, suppliers: Pick<Supplier, "id" | "method" | "active">[]): { ok: true; value: string[] } | { ok: false; error: string } {
  const out: string[] = [];
  for (const id of ids) {
    if (!id || id === preferredId || out.includes(id)) continue;
    const s = suppliers.find((x) => x.id === id);
    if (!s || !s.active) return { ok: false, error: "One of the other suppliers isn't in the list" };
    if (s.method === "production") return { ok: false, error: "A production kitchen can't be another supplier" };
    out.push(id);
  }
  if (out.length > ALSO_FROM_MAX) return { ok: false, error: `Up to ${ALSO_FROM_MAX} other suppliers` };
  return { ok: true, value: out };
}

/** Where a product can be bought: its preferred supplier, then the others that also sell it (active, no production kitchens). */
export function buyFrom(product: Pick<Product, "supplierId" | "alsoFrom">, suppliers: Supplier[]): Supplier[] {
  const ids = [product.supplierId, ...(product.alsoFrom ?? [])].filter((x): x is string => !!x);
  return [...new Set(ids)].map((id) => suppliers.find((s) => s.id === id)).filter((s): s is Supplier => !!s && s.active && s.method !== "production");
}

export const sameProduct = (a: Pick<Product, "name" | "size" | "supplierId">, b: Pick<Product, "name" | "size" | "supplierId">) =>
  norm(a.name) === norm(b.name) && norm(a.size) === norm(b.size) && (a.supplierId ?? "") === (b.supplierId ?? "");

export const productLabel = (p: Pick<Product, "name" | "size">) => (p.size ? `${p.name} · ${p.size}` : p.name);

export function cleanPrice(input: { pounds: string; on: string; note?: string }): { ok: true; value: { pence: number; on: string; note?: string } } | { ok: false; error: string } {
  const n = Number(input.pounds.replace(/[£,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > 100_000) return { ok: false, error: "Enter a price like 12.50" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.on)) return { ok: false, error: "Give the date the price is from" };
  const note = input.note?.trim().slice(0, 120) || undefined;
  return { ok: true, value: { pence: Math.round(n * 100), on: input.on, ...(note ? { note } : {}) } };
}

/** The latest reference price of a product, if any. */
export function latestPrice(prices: Price[], productId: string): Price | undefined {
  return prices.filter((p) => p.productId === productId).sort((a, b) => b.on.localeCompare(a.on))[0];
}
export const pounds = (pence: number) => `£${(pence / 100).toFixed(2)}`;
/** How old a reference price is, in words: "today", "12 days old", "8 months old". */
export function priceAge(on: string, today: string): string {
  const days = Math.round((Date.parse(today) - Date.parse(on)) / 86_400_000);
  if (days <= 0) return "today";
  if (days < 60) return `${days} day${days === 1 ? "" : "s"} old`;
  const months = Math.round(days / 30.4);
  return months < 24 ? `${months} months old` : `${Math.round(days / 365)} years old`;
}

// ---------- who does what ----------

/** Reporting stock: anyone active with access at an open site. */
export const canReportAt = (p: Pick<Person, "status" | "access">, site: Pick<Site, "id" | "status">) =>
  p.status === "active" && site.status === "open" && p.access.some((a) => a.siteId === site.id);
/**
 * On the tablet (the full app), anyone who reports stock at the restaurant sees what it has asked for on Stock needed
 * and can change the amount of, or remove, what's still waiting. Ordering it stays with the owner and ops.
 */
export const editsSiteNeeded = (p: Pick<Person, "status" | "access">, site: Pick<Site, "id" | "status">, scope: "full" | "shifts") =>
  scope === "full" && canReportAt(p, site);

/** The catalogue, suppliers and prices: the owner only. */
export const runsPurchasing = (p: Pick<Person, "status" | "access">) => p.status === "active" && isOwner(p);

/** Stock needed (tick off, give to a driver, the order sheet): owners, and operations managers for their sites. */
export const runsOrdering = (p: Pick<Person, "status" | "access">) => p.status === "active" && isLead(p);
export const orderingSites = (p: Pick<Person, "status" | "access">, all: SiteId[]): SiteId[] => (runsOrdering(p) ? leadSites(p, all) : []);

/** The production team at a production kitchen: production staff there, its managers, and owners. */
export const onProductionTeam = (p: Pick<Person, "status" | "access">, siteId: SiteId) =>
  p.status === "active" && (isOwner(p) || p.access.some((a) => a.siteId === siteId && (a.role === "manager" || a.role === "ops" || a.sections.includes("PROD"))));

/** Who can be given purchasing work: active people the owner marked as purchasers, and owners. */
export const canPurchase = (p: Pick<Person, "status" | "access"> & { purchaser?: boolean }) => p.status === "active" && (!!p.purchaser || isOwner(p));

// ---------- reports ----------

export type StockLevel = "low" | "out";
export interface DraftLine { productId: string; level: StockLevel; qty?: number; note?: string; photoId?: string }
export interface StockReport {
  id: string; siteId: SiteId; personId: string; personName?: string; date: string;
  lines: DraftLine[]; noIssues: boolean; submittedAt?: number; updatedAt: number;
  /** Items not in the catalogue (new items for the owner to add). */
  extras: NewItemLine[];
}
/** Something staff need that isn't in the catalogue: what it is, the pack or size if they know, how many. */
export interface NewItemLine { name: string; size?: string; qty?: number; note?: string }
/** A new item sent to the owner, and what they decided (added to the catalogue, or not needed). */
export interface NewItem {
  id: string; siteId: SiteId; reportId?: string; name: string; size?: string; qty: number; note?: string;
  requestedBy: string; requestedByName?: string; createdAt: number;
  decidedAt?: number; decidedBy?: string; productId?: string; requestId?: string; dismissed?: string;
}
export const NEW_ITEMS_MAX = 20;
export const QTY_MAX = 9999;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A report's lines, checked: known active products, once each, how many are needed (above 0), short notes. A draft may
 * still have a line without an amount (it's being filled in); sending needs every amount.
 */
export function cleanLines(lines: DraftLine[], products: Pick<Product, "id" | "active">[], opts: { draft?: boolean } = {}): { ok: true; value: DraftLine[] } | { ok: false; error: string } {
  if (lines.length > 200) return { ok: false, error: "That's too many lines for one report" };
  const out: DraftLine[] = [];
  for (const l of lines) {
    const p = products.find((x) => x.id === l.productId);
    if (!p || !p.active) return { ok: false, error: "One of the products isn't in the catalogue any more. Take it off and try again" };
    if (out.some((o) => o.productId === l.productId)) continue;
    if (l.level !== "low" && l.level !== "out") return { ok: false, error: "Choose low or out for every product" };
    let qty: number | undefined;
    if (l.qty === undefined || l.qty === null) {
      if (!opts.draft) return { ok: false, error: "Say how many you need of every item" };
    } else {
      qty = Number(l.qty);
      if (!Number.isFinite(qty) || qty <= 0 || qty > QTY_MAX) return { ok: false, error: `Quantities are from 1 to ${QTY_MAX}` };
      qty = Math.round(qty * 100) / 100;
    }
    const note = l.note?.trim().slice(0, 200) || undefined;
    const photoId = l.photoId && UUID.test(l.photoId) ? l.photoId : undefined;
    out.push({ productId: l.productId, level: l.level, ...(qty !== undefined ? { qty } : {}), ...(note ? { note } : {}), ...(photoId ? { photoId } : {}) });
  }
  return { ok: true, value: out };
}

/**
 * A report's new items, checked: a name (2–80 characters), an optional pack or size, how many (a draft may not say
 * yet), a short note; the same name and size once; at most NEW_ITEMS_MAX.
 */
export function cleanNewItems(items: NewItemLine[], opts: { draft?: boolean } = {}): { ok: true; value: NewItemLine[] } | { ok: false; error: string } {
  if (items.length > NEW_ITEMS_MAX) return { ok: false, error: `Up to ${NEW_ITEMS_MAX} new items in one report` };
  const out: NewItemLine[] = [];
  const key = (x: NewItemLine) => `${x.name.toLowerCase()}|${(x.size ?? "").toLowerCase()}`;
  for (const i of items) {
    const name = String(i.name ?? "").replace(/\s+/g, " ").trim();
    if (name.length < 2 || name.length > 80) return { ok: false, error: "Give each new item a name (2 to 80 letters)" };
    const size = String(i.size ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || undefined;
    let qty: number | undefined;
    if (i.qty === undefined || i.qty === null) {
      if (!opts.draft) return { ok: false, error: `Say how many you need of ${name}` };
    } else {
      qty = Number(i.qty);
      if (!Number.isFinite(qty) || qty <= 0 || qty > QTY_MAX) return { ok: false, error: `Quantities are from 1 to ${QTY_MAX}` };
      qty = Math.round(qty * 100) / 100;
    }
    const note = String(i.note ?? "").trim().slice(0, 200) || undefined;
    const x: NewItemLine = { name, ...(size ? { size } : {}), ...(qty !== undefined ? { qty } : {}), ...(note ? { note } : {}) };
    if (out.some((o) => key(o) === key(x))) continue;
    out.push(x);
  }
  return { ok: true, value: out };
}

/** Catalogue products whose name looks like a new item's (so the owner can spot it's already there). */
export function lookAlikes(name: string, products: Pick<Product, "id" | "name" | "size" | "active">[], n = 3): Pick<Product, "id" | "name" | "size">[] {
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  if (!words.length) return [];
  return products.filter((p) => p.active)
    .map((p) => ({ p, score: words.filter((w) => p.name.toLowerCase().includes(w)).length }))
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name)).slice(0, n).map((x) => x.p);
}

/**
 * The Report stock tile's line for today's sent reports: each person once (first names, newest first), and when the
 * latest was sent, e.g. "Sent today by Vishal, Anh · last at 17:30". Undefined when none were sent.
 */
export function sentTodayLine(reports: Pick<StockReport, "personName" | "submittedAt">[], hm: (ms: number) => string): string | undefined {
  if (!reports.length) return undefined;
  const sorted = [...reports].sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0));
  const names = [...new Set(sorted.map((r) => r.personName?.split(" ")[0]).filter((n): n is string => !!n))];
  const last = sorted[0].submittedAt;
  return `Sent today${names.length ? ` by ${names.join(", ")}` : ""}${last ? ` · last at ${hm(last)}` : ""}`;
}

// ---------- requests, tasks, events ----------

export interface StockRequest {
  id: string; code: number; siteId: SiteId; productId: string; level: StockLevel;
  /** What staff asked for; unset: they weren't sure. */
  qty?: number;
  /** What the owner set it to (with a reason, in the log). */
  fixedQty?: number;
  note?: string; photoId?: string; reportId?: string;
  requestedBy: string; requestedByName?: string; createdAt: number;
  /** Who it's bought from: the product's preferred supplier when it was reported, unless the owner changed it. */
  supplierId?: string;
  cancelledAt?: number; cancelReason?: string;
  /** Made by unticking that line: it puts back what the line ticked off. */
  reopensLine?: string;
}
export type Priority = "normal" | "urgent";
export interface PurchaseTask {
  id: string; code: number; supplierId?: string; method: SupplyMethod;
  /** Driver (shop), buyer (online), whoever orders (delivery), or the production lead. */
  assigneeId?: string; assigneeName?: string;
  /** Collects an online order, or drives a production order over. */
  driverId?: string; driverName?: string;
  requiredBy?: string; priority: Priority; note?: string;
  /** Production orders: the restaurant it's for. A scheduled supplier's order: the kitchen it's delivered to. */
  destination?: SiteId;
  /** A scheduled supplier's order: its round (the cut-off moment). One order per supplier and round. */
  roundAt?: number;
  createdBy: string; createdAt: number; cancelledAt?: number; cancelReason?: string;
}
export interface TaskLine { id: string; taskId: string; requestId: string; qty: number;
  /** Made by unticking that line on a driver's list: it's back on the list. */
  redoes?: string }
export const TERMINAL = ["bought", "unavailable", "dispatched", "line_cancelled"] as const;
export type Terminal = (typeof TERMINAL)[number];
export type EventKind = Terminal
  | "reported_again" | "qty_changed" | "supplier_changed" | "request_cancelled"
  | "assigned" | "acknowledged" | "ordered" | "cost" | "collected" | "delivered" | "task_cancelled"
  | "picked" | "packed" | "substitute" | "substitute_ok" | "substitute_no" | "note"
  /** A delivery brought less than was bought (short, not delivered, wrong): that much goes back to waiting. */
  | "short";
export interface StockEvent {
  id: string; at: number; by: string; byName?: string; kind: EventKind;
  taskId?: string; lineId?: string; requestId?: string;
  qty?: number; pence?: number; text?: string; mediaId?: string;
  /** An order reference (online) or a batch code (production). */
  ref?: string;
  /** Expected delivery date (online) or use-by (production). */
  on?: string;
}
export interface Receipt { id: string; requestId: string; qty: number; by: string; byName?: string; at: number; note?: string }

export const reqCode = (r: Pick<StockRequest, "code">) => `SR-${String(r.code).padStart(4, "0")}`;
export const taskCode = (t: Pick<PurchaseTask, "code" | "method">) => `${t.method === "production" ? "PO" : "PT"}-${String(t.code).padStart(4, "0")}`;
export const wantedOf = (r: Pick<StockRequest, "qty" | "fixedQty">) => r.fixedQty ?? r.qty;

/** How a line ended, if it has: what was obtained (bought or dispatched) and how. */
export function lineEnd(line: TaskLine, events: StockEvent[]): { kind: Terminal; qty: number; event: StockEvent } | undefined {
  const e = events.find((x) => x.lineId === line.id && (TERMINAL as readonly string[]).includes(x.kind));
  if (!e) return undefined;
  const kind = e.kind as Terminal;
  return { kind, qty: kind === "bought" || kind === "dispatched" ? e.qty ?? 0 : 0, event: e };
}

export type RequestState = "cancelled" | "needs_qty" | "waiting" | "part_assigned" | "assigned" | "part_bought" | "on_the_way" | "part_received" | "received";
export const STATE_LABEL: Record<RequestState, string> = {
  cancelled: "Cancelled", needs_qty: "Needs a quantity", waiting: "Asked for", part_assigned: "Partly with a driver",
  assigned: "With a driver", part_bought: "Partly done", on_the_way: "Ordered", part_received: "Partly done", received: "Done",
};
export interface Progress {
  wanted?: number;
  /** On open lines (assigned, not yet bought or dispatched). */
  planned: number;
  /** Bought or dispatched so far. */
  obtained: number;
  received: number;
  /** Still to give to someone. */
  toPlan: number;
  /** Bought or dispatched, not yet confirmed by the restaurant. */
  toReceive: number;
  state: RequestState;
  /** The last time a line of it couldn't be got, if any (so the owner sees it came back). */
  unavailable?: StockEvent;
}

/** What deliveries of a line didn't bring (recorded once the line was bought). */
export const shortOf = (line: Pick<TaskLine, "id">, events: StockEvent[]) => events.filter((e) => e.lineId === line.id && e.kind === "short").reduce((s, e) => s + (e.qty ?? 0), 0);

/** Where a request stands, from its lines (on tasks not cancelled), their events and its receipts. */
export function progress(r: StockRequest, lines: TaskLine[], events: StockEvent[], receipts: Receipt[], tasks: Pick<PurchaseTask, "id" | "cancelledAt">[]): Progress {
  const live = new Set(tasks.filter((t) => !t.cancelledAt).map((t) => t.id));
  let planned = 0, obtained = 0;
  let unavailable: StockEvent | undefined;
  for (const l of lines.filter((x) => x.requestId === r.id)) {
    const end = lineEnd(l, events);
    if (end) {
      obtained += Math.max(0, end.qty - shortOf(l, events));
      if (end.kind === "unavailable" && (!unavailable || end.event.at > unavailable.at)) unavailable = end.event;
    } else if (live.has(l.taskId)) planned += l.qty;
  }
  const received = receipts.filter((x) => x.requestId === r.id).reduce((s, x) => s + x.qty, 0);
  const wanted = wantedOf(r);
  const round = (n: number) => Math.round(n * 100) / 100;
  const toPlan = r.cancelledAt || wanted === undefined ? 0 : round(Math.max(0, wanted - planned - obtained));
  const toReceive = round(Math.max(0, obtained - received));
  let state: RequestState;
  if (r.cancelledAt) state = "cancelled";
  else if (wanted === undefined) state = planned || obtained ? "assigned" : "needs_qty";
  else if (received >= wanted) state = "received";
  else if (received > 0) state = "part_received";
  else if (obtained >= wanted) state = "on_the_way";
  else if (obtained > 0) state = "part_bought";
  else if (planned + obtained >= wanted) state = "assigned";
  else if (planned > 0) state = "part_assigned";
  else state = "waiting";
  return { wanted, planned: round(planned), obtained: round(obtained), received: round(received), toPlan, toReceive, state, unavailable };
}

/** Finished: received in full, or cancelled. Anything else is still in hand. */
export const isClosed = (p: Pick<Progress, "state">) => p.state === "cancelled" || p.state === "received";

// ---------- ticks and unticks ----------

/** The note on what a tick on Stock needed makes (the task and its order; a production tick's dispatch). */
export const TICK_NOTE = "Ticked off on Stock needed";
/** A tick can be taken back until the working day ends (05:00 London), and stays on the list, crossed out, until then. */
export const UNTICK_UNTIL = "05:00";
/** When the working day that `now` is in began: today at 05:00 London, or yesterday's before then. */
export function tickDayStart(now: number): number {
  const today = londonDate(now);
  const start = londonToUtc(today, UNTICK_UNTIL);
  return now >= start ? start : londonToUtc(addDays(today, -1), UNTICK_UNTIL);
}
/** Lines whose tick has been taken back: a request (put back on Stock needed) or a line (back on a driver's list) was made from them. */
export function untickedLines(d: { requests: Pick<StockRequest, "reopensLine">[]; lines: Pick<TaskLine, "redoes">[] }): Set<string> {
  return new Set([...d.requests.map((r) => r.reopensLine), ...d.lines.map((l) => l.redoes)].filter((x): x is string => !!x));
}
/** Whether a ticked line can still be unticked: it ended (bought, sent or couldn't get) this working day and hasn't been already. */
export function canUntick(line: Pick<TaskLine, "id">, events: StockEvent[], unticked: Set<string>, now: number): boolean {
  const end = lineEnd(line as TaskLine, events);
  return !!end && end.kind !== "line_cancelled" && !unticked.has(line.id) && end.event.at >= tickDayStart(now);
}
/** A tick on Stock needed (not a driver's): bought on a tick's task, or a production line sent by a tick. */
export function isNeededTick(line: TaskLine, task: Pick<PurchaseTask, "note"> | undefined, events: StockEvent[]): boolean {
  const end = lineEnd(line, events);
  return !!end && ((end.kind === "bought" && task?.note === TICK_NOTE) || (end.kind === "dispatched" && end.event.text === TICK_NOTE));
}

// ---------- submitting a report ----------

export interface SubmitPlan { create: (DraftLine & { supplierId?: string })[]; again: { requestId: string; line: DraftLine; setQty?: number; was?: number }[] }
/** The note on the amount change a later report makes ("was 3, given in a later report"). */
export const laterReportNote = (was?: number) => (was !== undefined ? `was ${was}, given in a later report` : "given in a later report");

/**
 * What a submitted report does. A product already requested at that site and still waiting (nothing of it assigned or
 * bought yet) isn't requested twice: it's noted on that request (an "out" makes it urgent), and the amount given now
 * replaces the one waiting (the latest count wins; it fills one that was "not sure"). Once part of it is assigned or
 * bought, a new report of it is a new need: a new request. Everything new gets the product's preferred supplier.
 */
export function planSubmit(lines: DraftLine[], siteId: SiteId, open: { request: StockRequest; progress: Progress }[], products: Pick<Product, "id" | "supplierId">[]): SubmitPlan {
  const plan: SubmitPlan = { create: [], again: [] };
  for (const l of lines) {
    const existing = open.find((o) => o.request.siteId === siteId && o.request.productId === l.productId && !o.request.cancelledAt
      && (o.progress.state === "waiting" || o.progress.state === "needs_qty"));
    if (existing) plan.again.push({ requestId: existing.request.id, line: l,
      ...(l.qty !== undefined && l.qty !== existing.progress.wanted ? { setQty: l.qty, ...(existing.progress.wanted !== undefined ? { was: existing.progress.wanted } : {}) } : {}) });
    else plan.create.push({ ...l, supplierId: products.find((p) => p.id === l.productId)?.supplierId });
  }
  return plan;
}

/** Urgent: reported out, or the open request was reported out again. */
export const isUrgent = (r: Pick<StockRequest, "id" | "level">, events: StockEvent[]) =>
  r.level === "out" || events.some((e) => e.requestId === r.id && e.kind === "reported_again" && e.text === "out");

// ---------- the owner's view ----------

export interface GroupRow {
  product: Product;
  /** One per restaurant: what's still to give to someone, or "not sure" (needs a quantity first). */
  sites: { siteId: SiteId; requests: { request: StockRequest; progress: Progress; urgent: boolean }[]; toPlan: number; unknown: number }[];
  toPlan: number; urgent: boolean; unavailableAt?: number;
  estimate?: number;
}
export interface SupplierGroup { supplier?: Supplier; rows: GroupRow[]; toPlanLines: number; urgent: boolean; estimate: number; unpriced: number }

/**
 * What still needs giving to someone, grouped by supplier (the request's supplier), then product, then restaurant.
 * Only the same product (same name, size and supplier) is ever added up across restaurants.
 */
export function supplierGroups(requests: { request: StockRequest; progress: Progress }[], products: Product[], suppliers: Supplier[], events: StockEvent[], prices: Price[], siteFilter?: SiteId): SupplierGroup[] {
  const groups = new Map<string, SupplierGroup>();
  for (const { request: r, progress: p } of requests) {
    if (siteFilter && r.siteId !== siteFilter) continue;
    if (p.state === "cancelled" || !(p.toPlan > 0 || p.state === "needs_qty")) continue;
    const product = products.find((x) => x.id === r.productId);
    if (!product) continue;
    const key = r.supplierId ?? "";
    const g = groups.get(key) ?? { supplier: suppliers.find((s) => s.id === r.supplierId), rows: [], toPlanLines: 0, urgent: false, estimate: 0, unpriced: 0 };
    groups.set(key, g);
    let row = g.rows.find((x) => x.product.id === product.id);
    if (!row) { row = { product, sites: [], toPlan: 0, urgent: false }; g.rows.push(row); }
    let site = row.sites.find((s) => s.siteId === r.siteId);
    if (!site) { site = { siteId: r.siteId, requests: [], toPlan: 0, unknown: 0 }; row.sites.push(site); }
    const urgent = isUrgent(r, events);
    site.requests.push({ request: r, progress: p, urgent });
    site.toPlan += p.toPlan;
    if (p.state === "needs_qty") site.unknown++;
    row.toPlan += p.toPlan;
    row.urgent ||= urgent;
    if (p.unavailable && (!row.unavailableAt || p.unavailable.at > row.unavailableAt)) row.unavailableAt = p.unavailable.at;
  }
  for (const g of groups.values()) {
    g.toPlanLines = g.rows.length;
    g.urgent = g.rows.some((r) => r.urgent);
    const internal = g.supplier?.method === "production";
    for (const row of g.rows) {
      const price = latestPrice(prices, row.product.id);
      if (price && !internal) { row.estimate = Math.round(price.pence * row.toPlan); g.estimate += row.estimate; }
      else if (!internal && row.toPlan > 0) g.unpriced++;
      row.sites.sort((a, b) => a.siteId.localeCompare(b.siteId));
    }
    g.rows.sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.product.name.localeCompare(b.product.name));
  }
  return [...groups.values()].sort((a, b) => Number(!a.supplier) - Number(!b.supplier) || Number(b.urgent) - Number(a.urgent) || (a.supplier?.name ?? "").localeCompare(b.supplier?.name ?? ""));
}

/**
 * A new purchase task from the owner: lines of (request, quantity). Every request must be open with that much still
 * to give to someone, and from the task's supplier (change a request's supplier first). A production order is for one
 * restaurant.
 */
export function checkTaskLines(lines: { requestId: string; qty: number }[], requests: { request: StockRequest; progress: Progress }[], supplierId: string | undefined, method: SupplyMethod):
  { ok: true; value: { requestId: string; qty: number }[] } | { ok: false; error: string } {
  if (!lines.length) return { ok: false, error: "Pick at least one thing to buy" };
  const out: { requestId: string; qty: number }[] = [];
  for (const l of lines) {
    const r = requests.find((x) => x.request.id === l.requestId);
    if (!r || r.request.cancelledAt) return { ok: false, error: "One of the requests has been cancelled. Refresh and try again" };
    if ((r.request.supplierId ?? "") !== (supplierId ?? "")) return { ok: false, error: `${reqCode(r.request)} is for a different supplier. Change its supplier first` };
    const qty = Math.round(Number(l.qty) * 100) / 100;
    if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: `Give ${reqCode(r.request)} a quantity` };
    if (r.progress.wanted === undefined) return { ok: false, error: `${reqCode(r.request)} has no quantity yet. Set one first` };
    if (qty > r.progress.toPlan + 1e-9) return { ok: false, error: `${reqCode(r.request)} only has ${r.progress.toPlan} left to buy. Refresh and try again` };
    if (out.some((o) => o.requestId === l.requestId)) return { ok: false, error: `${reqCode(r.request)} is in the list twice` };
    out.push({ requestId: l.requestId, qty });
  }
  if (method === "production" && new Set(out.map((o) => requests.find((x) => x.request.id === o.requestId)!.request.siteId)).size > 1) {
    return { ok: false, error: "A production order goes to one restaurant. Make one for each" };
  }
  return { ok: true, value: out };
}

export type TaskState = "cancelled" | "done" | "in_progress" | "ordered" | "acknowledged" | "assigned" | "unassigned";
export const TASK_LABEL: Record<TaskState, string> = {
  cancelled: "Cancelled", done: "Done", in_progress: "In progress", ordered: "Ordered", acknowledged: "Seen", assigned: "Assigned", unassigned: "Nobody yet",
};
export interface TaskLineView { line: TaskLine; request: StockRequest; end?: ReturnType<typeof lineEnd>; picked?: number; packed?: number; substitute?: StockEvent; substituteAnswer?: StockEvent }

export function taskState(t: PurchaseTask, lines: TaskLine[], events: StockEvent[]): TaskState {
  if (t.cancelledAt) return "cancelled";
  const mine = lines.filter((l) => l.taskId === t.id);
  const ended = mine.filter((l) => lineEnd(l, events)).length;
  if (mine.length && mine.every((l) => lineEnd(l, events)?.kind === "line_cancelled")) return "cancelled";
  if (mine.length && ended === mine.length) return "done";
  if (ended > 0 || events.some((e) => e.taskId === t.id && (e.kind === "picked" || e.kind === "packed"))) return "in_progress";
  if (events.some((e) => e.taskId === t.id && e.kind === "ordered")) return "ordered";
  if (events.some((e) => e.taskId === t.id && e.kind === "acknowledged")) return "acknowledged";
  // A production order is the kitchen team's as soon as it's made; others wait for the owner to give them to someone.
  return t.assigneeId || t.method === "production" ? "assigned" : "unassigned";
}

export function taskLines(t: PurchaseTask, lines: TaskLine[], requests: StockRequest[], events: StockEvent[]): TaskLineView[] {
  return lines.filter((l) => l.taskId === t.id).flatMap((line) => {
    const request = requests.find((r) => r.id === line.requestId);
    if (!request) return [];
    const of = (k: EventKind) => events.filter((e) => e.lineId === line.id && e.kind === k).sort((a, b) => b.at - a.at)[0];
    const substitute = of("substitute");
    const answer = substitute ? events.filter((e) => e.lineId === line.id && (e.kind === "substitute_ok" || e.kind === "substitute_no") && e.at >= substitute.at).sort((a, b) => b.at - a.at)[0] : undefined;
    return [{ line, request, end: lineEnd(line, events), picked: of("picked")?.qty, packed: of("packed")?.qty, substitute, substituteAnswer: answer }];
  });
}

/** Who may see and act on a task: the owner, whoever it's given to (or drives it), and for a production order the team there. */
export function canSeeTask(p: Pick<Person, "id" | "status" | "access">, t: PurchaseTask, supplier?: Pick<Supplier, "siteId" | "method">): boolean {
  if (p.status !== "active") return false;
  if (runsPurchasing(p)) return true;
  if (t.assigneeId === p.id || t.driverId === p.id) return true;
  return t.method === "production" && !!supplier?.siteId && onProductionTeam(p, supplier.siteId);
}

/**
 * Ending a line (bought, unavailable, dispatched): once only, and never more than the line asked for. Buying less
 * leaves the rest of the request waiting to be given to someone again, with its restaurant.
 */
export function checkLineEnd(kind: "bought" | "unavailable" | "dispatched", qty: number | undefined, line: TaskLine, events: StockEvent[]): { ok: true; qty: number } | { ok: false; error: string } {
  if (lineEnd(line, events)) return { ok: false, error: "That's already been recorded" };
  if (kind === "unavailable") return { ok: true, qty: 0 };
  const q = Math.round(Number(qty) * 100) / 100;
  if (!Number.isFinite(q) || q <= 0) return { ok: false, error: kind === "dispatched" ? "How many went out?" : "How many did you get? (Use Not available for none)" };
  if (q > line.qty + 1e-9) return { ok: false, error: `That's more than the ${line.qty} asked for` };
  return { ok: true, qty: q };
}

/** Confirming what arrived: up to what was bought or dispatched and not yet confirmed. */
export function checkReceipt(qty: number, p: Progress): { ok: true; qty: number } | { ok: false; error: string } {
  const q = Math.round(Number(qty) * 100) / 100;
  if (!Number.isFinite(q) || q <= 0) return { ok: false, error: "How many arrived?" };
  if (p.toReceive <= 0) return { ok: false, error: "Nothing has been sent for this yet" };
  if (q > p.toReceive + 1e-9) return { ok: false, error: `Only ${p.toReceive} has been sent` };
  return { ok: true, qty: q };
}

/** The owner changes the supplier only while nothing of it is assigned or bought (cancel those lines first). */
export const canChangeSupplier = (p: Progress) => p.state !== "cancelled" && p.planned === 0 && p.obtained === 0;
export const canCancelRequest = (p: Progress) => p.state !== "cancelled" && p.state !== "received" && p.obtained === 0;

// ---------- the production kitchen ----------

export interface ProductionRow { product: Product; sites: { siteId: SiteId; lines: { view: TaskLineView; task: PurchaseTask }[]; requested: number; dispatched: number; outstanding: number }[]; requested: number; dispatched: number; outstanding: number }

/** A production kitchen's queue: its orders' lines by product, with each restaurant's share, requested vs dispatched. */
export function productionQueue(tasks: PurchaseTask[], lines: TaskLine[], requests: StockRequest[], events: StockEvent[], products: Product[]): ProductionRow[] {
  const rows: ProductionRow[] = [];
  for (const t of tasks.filter((x) => x.method === "production" && !x.cancelledAt)) {
    for (const view of taskLines(t, lines, requests, events)) {
      if (view.end?.kind === "line_cancelled") continue;
      const product = products.find((p) => p.id === view.request.productId);
      if (!product) continue;
      let row = rows.find((r) => r.product.id === product.id);
      if (!row) { row = { product, sites: [], requested: 0, dispatched: 0, outstanding: 0 }; rows.push(row); }
      let site = row.sites.find((s) => s.siteId === view.request.siteId);
      if (!site) { site = { siteId: view.request.siteId, lines: [], requested: 0, dispatched: 0, outstanding: 0 }; row.sites.push(site); }
      const sent = view.end?.kind === "dispatched" ? view.end.qty : 0;
      site.lines.push({ view, task: t });
      site.requested += view.line.qty; site.dispatched += sent; site.outstanding += view.end ? 0 : view.line.qty;
      row.requested += view.line.qty; row.dispatched += sent; row.outstanding += view.end ? 0 : view.line.qty;
    }
  }
  return rows.filter((r) => r.outstanding > 0 || r.sites.some((s) => s.lines.some((l) => l.view.end?.kind === "dispatched")))
    .sort((a, b) => Number(b.outstanding > 0) - Number(a.outstanding > 0) || a.product.name.localeCompare(b.product.name));
}

// ---------- Stock needed: one page for the owner and operations managers ----------

export interface NeededRow {
  product: Product;
  /** Still to order, added up across the restaurants (only the same product is ever added up). */
  qty: number;
  sites: { siteId: SiteId; qty: number; unknown: number }[];
  /** Requests still to order (a tick orders these) and, for a production kitchen, its open order lines (a tick sends these). */
  requestIds: string[]; lineIds: string[];
  /** Requests sent with no amount (from before amounts were asked for): an amount is set first. */
  unknownIds: string[];
  notes: string[]; photoIds: string[]; urgent: boolean;
  /** The latest change of amount this working day (given `now`): to what, from what, by whom and when. */
  changed?: { qty: number; was?: number; by?: string; at: number };
}
/** Taken off the list this working day by someone at the restaurant (`REMOVE_NOTE`), so the owner sees it went. */
export interface RemovedRow { product: Product; qty?: number; siteId: SiteId; by?: string; at: number }
export interface WithDriver { task: PurchaseTask; items: { name: string; qty: number }[]; open: number; done: number }
/** Ticked off this working day: stays on the card, crossed out, so a mistaken tick can be taken back. */
export interface TickedRow { product: Product; qty: number; sites: { siteId: SiteId; qty: number }[]; lineIds: string[]; by: string[]; at: number }
export interface NeededGroup { key: string; supplier?: Supplier; rows: NeededRow[]; drivers: WithDriver[]; production: boolean; ticked: TickedRow[]; removed: RemovedRow[] }

/**
 * What's needed, by supplier, for these sites. A product from a supplier: what's still to order of its requests. A
 * production product: what's still to send on the kitchen's production orders (they're made as soon as it's asked
 * for). Shop runs given to a driver show under their supplier until the driver has ticked everything off. Given `now`,
 * what was ticked off this working day (and not unticked) is listed under its supplier too (`ticked`).
 */
export function neededGroups(items: { request: StockRequest; progress: Progress }[], data: { tasks: PurchaseTask[]; lines: TaskLine[]; events: StockEvent[]; requests: StockRequest[] },
  products: Product[], suppliers: Supplier[], siteIds: SiteId[], now?: number): NeededGroup[] {
  const groups = new Map<string, NeededGroup>();
  const group = (supplierId: string | undefined) => {
    const key = supplierId ?? "";
    let g = groups.get(key);
    if (!g) {
      const supplier = suppliers.find((s) => s.id === supplierId);
      g = { key, supplier, rows: [], drivers: [], production: supplier?.method === "production", ticked: [], removed: [] };
      groups.set(key, g);
    }
    return g;
  };
  const row = (g: NeededGroup, product: Product) => {
    let r = g.rows.find((x) => x.product.id === product.id);
    if (!r) { r = { product, qty: 0, sites: [], requestIds: [], lineIds: [], unknownIds: [], notes: [], photoIds: [], urgent: false }; g.rows.push(r); }
    return r;
  };
  const site = (r: NeededRow, siteId: SiteId) => {
    let x = r.sites.find((s) => s.siteId === siteId);
    if (!x) { x = { siteId, qty: 0, unknown: 0 }; r.sites.push(x); }
    return x;
  };
  const round = (n: number) => Math.round(n * 100) / 100;
  const add = (r: NeededRow, req: StockRequest) => {
    if (req.note && !r.notes.includes(req.note)) r.notes.push(req.note);
    if (req.photoId && !r.photoIds.includes(req.photoId)) r.photoIds.push(req.photoId);
    r.urgent ||= isUrgent(req, data.events);
  };
  for (const { request: req, progress: p } of items) {
    if (!siteIds.includes(req.siteId) || p.state === "cancelled") continue;
    const product = products.find((x) => x.id === req.productId);
    if (!product) continue;
    if (p.state === "needs_qty") {
      const r = row(group(req.supplierId), product);
      r.unknownIds.push(req.id); site(r, req.siteId).unknown++; add(r, req);
    } else if (p.toPlan > 0) {
      const r = row(group(req.supplierId), product);
      r.qty = round(r.qty + p.toPlan); r.requestIds.push(req.id);
      const s = site(r, req.siteId); s.qty = round(s.qty + p.toPlan); add(r, req);
    }
  }
  // Production orders: what's still to send, per product and restaurant.
  for (const t of data.tasks.filter((x) => x.method === "production" && !x.cancelledAt)) {
    for (const v of taskLines(t, data.lines, data.requests, data.events)) {
      if (v.end || !siteIds.includes(v.request.siteId)) continue;
      const product = products.find((x) => x.id === v.request.productId);
      if (!product) continue;
      const r = row(group(t.supplierId), product);
      r.qty = round(r.qty + v.line.qty); r.lineIds.push(v.line.id);
      const s = site(r, v.request.siteId); s.qty = round(s.qty + v.line.qty); add(r, v.request);
    }
  }
  const unticked = untickedLines(data);
  // Shop runs and orders given to someone: theirs until every line is ticked off (bought, or couldn't get).
  for (const t of data.tasks.filter((x) => x.method !== "production" && !x.cancelledAt && x.assigneeId)) {
    const views = taskLines(t, data.lines, data.requests, data.events).filter((v) => siteIds.includes(v.request.siteId) && !unticked.has(v.line.id));
    const open = views.filter((v) => !v.end);
    if (!open.length) continue;
    const byName = new Map<string, number>();
    for (const v of open) {
      const product = products.find((x) => x.id === v.request.productId);
      const name = product ? productLabel(product) : "?";
      byName.set(name, round((byName.get(name) ?? 0) + v.line.qty));
    }
    group(t.supplierId).drivers.push({ task: t, items: [...byName.entries()].map(([name, qty]) => ({ name, qty })), open: open.length, done: views.length - open.length });
  }
  // Ticked off this working day, still to be seen (and unticked if it was a mistake).
  if (now !== undefined) {
    const from = tickDayStart(now);
    // Amounts changed today (the latest per row), and what someone at a restaurant took off the list.
    for (const g of groups.values()) {
      for (const r of g.rows) {
        // The latest (events come in the order they were made, so a later one wins a tie).
        const e = data.events.filter((x) => x.kind === "qty_changed" && x.at >= from && x.requestId && [...r.requestIds, ...r.unknownIds].includes(x.requestId))
          .reduce<StockEvent | undefined>((m, x) => (!m || x.at >= m.at ? x : m), undefined);
        const was = e?.text?.match(/^was (-?\d+(?:\.\d+)?)(?:,|$)/)?.[1];
        if (e && e.qty !== undefined) r.changed = { qty: e.qty, ...(was !== undefined ? { was: Number(was) } : {}), by: e.byName?.split(" ")[0], at: e.at };
      }
    }
    for (const e of data.events.filter((x) => x.kind === "request_cancelled" && x.text === REMOVE_NOTE && x.at >= from)) {
      const req = data.requests.find((r) => r.id === e.requestId);
      const product = req && products.find((x) => x.id === req.productId);
      if (!req || !product || !siteIds.includes(req.siteId)) continue;
      group(req.supplierId).removed.push({ product, qty: wantedOf(req), siteId: req.siteId, by: e.byName?.split(" ")[0], at: e.at });
    }
    for (const l of data.lines) {
      const req = data.requests.find((r) => r.id === l.requestId);
      const task = data.tasks.find((t) => t.id === l.taskId);
      const end = lineEnd(l, data.events);
      if (!req || !task || !end || !siteIds.includes(req.siteId) || unticked.has(l.id) || end.event.at < from || !isNeededTick(l, task, data.events)) continue;
      const product = products.find((x) => x.id === req.productId);
      if (!product) continue;
      const g = group(task.supplierId);
      let r = g.ticked.find((x) => x.product.id === product.id);
      if (!r) { r = { product, qty: 0, sites: [], lineIds: [], by: [], at: 0 }; g.ticked.push(r); }
      r.qty = round(r.qty + end.qty); r.lineIds.push(l.id); r.at = Math.max(r.at, end.event.at);
      const name = end.event.byName?.split(" ")[0];
      if (name && !r.by.includes(name)) r.by.push(name);
      let s = r.sites.find((x) => x.siteId === req.siteId);
      if (!s) { s = { siteId: req.siteId, qty: 0 }; r.sites.push(s); }
      s.qty = round(s.qty + end.qty);
    }
  }
  for (const g of groups.values()) {
    g.rows.sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.product.name.localeCompare(b.product.name));
    g.ticked.sort((a, b) => a.product.name.localeCompare(b.product.name));
    for (const r of g.ticked) r.sites.sort((a, b) => a.siteId.localeCompare(b.siteId));
    for (const r of g.rows) r.sites.sort((a, b) => a.siteId.localeCompare(b.siteId));
    g.drivers.sort((a, b) => a.task.createdAt - b.task.createdAt);
  }
  return [...groups.values()].filter((g) => g.rows.length || g.drivers.length || g.ticked.length || g.removed.length)
    .sort((a, b) => Number(!a.supplier) - Number(!b.supplier) || Number(a.production) - Number(b.production) || (a.supplier?.name ?? "").localeCompare(b.supplier?.name ?? ""));
}

/** The tick-off sheet: new items first, then each supplier's card as rows (amount, item and pack, who it's for). */
export function neededSheet(groups: NeededGroup[], newItems: Pick<NewItem, "name" | "size" | "qty" | "siteId" | "note">[], siteName: (id: SiteId) => string, supplierName: (id: string) => string | undefined = () => undefined):
  { heading: string; sub?: string; rows: { qty: string; item: string; detail?: string; flag?: string }[]; notes?: string[] }[] {
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));
  const label = (name: string, size?: string) => (size ? `${name} \u00b7 ${size}` : name);
  const out: ReturnType<typeof neededSheet> = [];
  if (newItems.length) {
    out.push({ heading: "New items", sub: "Not in the catalogue yet", rows: newItems.map((n) => ({
      qty: fmt(n.qty), item: label(n.name, n.size), detail: [`For ${siteName(n.siteId)}`, n.note].filter(Boolean).join(" \u00b7 "), flag: "NEW" })) });
  }
  for (const g of groups) {
    const rows = g.rows.map((r) => {
      const sites = r.sites.filter((x) => x.qty > 0);
      const where = sites.length === 1 ? `For ${siteName(sites[0].siteId)}` : sites.map((x) => `${siteName(x.siteId)} ${fmt(x.qty)}`).join(" \u00b7 ");
      const unknown = r.sites.filter((x) => x.unknown > 0).map((x) => `${siteName(x.siteId)}: amount needed`);
      const also = g.production ? [] : (r.product.alsoFrom ?? []).filter((id) => id !== g.supplier?.id).map(supplierName).filter((n): n is string => !!n);
      return { qty: r.qty > 0 ? fmt(r.qty) : "?", item: label(r.product.name, r.product.size),
        detail: [where, ...unknown, ...r.notes.map((t) => `\u201c${t}\u201d`), ...(also.length ? [`also at ${also.join(", ")}`] : [])].filter(Boolean).join(" \u00b7 ") || undefined, flag: r.urgent ? "URGENT" : undefined };
    });
    const notes = g.drivers.map((d) => `With ${d.task.assigneeName?.split(" ")[0] ?? "a driver"}: ${d.items.map((x) => `${fmt(x.qty)} ${x.name}`).join(", ")}`);
    if (!rows.length && !notes.length) continue;
    const sub = g.production ? "Production: tick when sent" : g.supplier ? methodOf(g.supplier.method)?.label : "Set a supplier in the catalogue";
    out.push({ heading: g.supplier?.name ?? "No supplier yet", sub, rows, notes });
  }
  return out;
}

/** The reason on a request someone at the restaurant took off Stock needed. */
export const REMOVE_NOTE = "Removed on Stock needed";
/** Nobody has any of it yet (not given to a driver, ordered or sent): the restaurant can still change or remove it. */
export const stillWaiting = (p: Pick<Progress, "state">) => p.state === "waiting" || p.state === "needs_qty";

/** One restaurant's item on Stock needed, as the restaurant sees it: whether it can still change it, and if not, why. */
export interface SiteWaitingRow { row: NeededRow; group: NeededGroup; editable: boolean; status?: "kitchen" | "ordering" }
/** A restaurant's items on Stock needed (its groups from `neededGroups`), each with whether it can still be changed there. */
export function siteWaitingRows(groups: NeededGroup[], items: { request: StockRequest; progress: Progress }[]): SiteWaitingRow[] {
  return groups.flatMap((group) => group.rows.map((row) => {
    const ids = [...row.requestIds, ...row.unknownIds];
    const editable = !group.production && ids.length > 0 && ids.every((id) => { const p = items.find((x) => x.request.id === id)?.progress; return !!p && stillWaiting(p); });
    return { row, group, editable, ...(editable ? {} : { status: group.production ? "kitchen" as const : "ordering" as const }) };
  }));
}

/**
 * How a product's waiting requests at one restaurant (oldest first) reach a new total: the newest takes the change; one
 * brought down to nothing is removed (newest first). Nothing to do when the total is already that.
 */
export function qtyPlan(reqs: { id: string; wanted?: number }[], target: number): ({ id: string; qty: number } | { id: string; remove: true })[] {
  const round = (n: number) => Math.round(n * 100) / 100;
  const total = round(reqs.reduce((t, r) => t + (r.wanted ?? 0), 0));
  if (!reqs.length || target === total) return [];
  const out: ({ id: string; qty: number } | { id: string; remove: true })[] = [];
  if (target > total) {
    const last = reqs[reqs.length - 1];
    return [{ id: last.id, qty: round((last.wanted ?? 0) + target - total) }];
  }
  let cut = round(total - target);
  for (const r of [...reqs].reverse()) {
    if (cut <= 0) break;
    const w = r.wanted ?? 0;
    const take = Math.min(w, cut);
    cut = round(cut - take);
    if (w - take <= 0) out.push({ id: r.id, remove: true }); else out.push({ id: r.id, qty: round(w - take) });
  }
  return out;
}

/** How many things a group still needs ordering, giving out or sending (rows, plus items with drivers). */
export const neededCount = (groups: NeededGroup[]) => groups.reduce((n, g) => n + g.rows.length, 0);

/** The order sheet's lines for a supplier: each product's total and pack, what's still to order (rows with an amount). */
export function orderSheetLines(g: NeededGroup): { qty: number; name: string; pack?: string }[] {
  return g.rows.filter((r) => r.qty > 0 && r.requestIds.length).map((r) => ({ qty: r.qty, name: r.product.name, pack: r.product.size }));
}

// ---------- help and nudges ----------

/** A typical quantity for a product at a site: the middle of its last (up to) 8 requests' quantities. A hint, never sent by itself. */
export function typicalQty(history: Pick<StockRequest, "productId" | "siteId" | "qty" | "fixedQty" | "createdAt">[], productId: string, siteId: SiteId): number | undefined {
  const qs = history.filter((r) => r.productId === productId && r.siteId === siteId && wantedOf(r) !== undefined)
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, 8).map((r) => wantedOf(r)!).sort((a, b) => a - b);
  if (!qs.length) return undefined;
  return qs[Math.floor((qs.length - 1) / 2)];
}

/** Products a site asks for most (last 60 days), for the top of Report Stock. */
export function frequent(history: Pick<StockRequest, "productId" | "siteId" | "createdAt">[], siteId: SiteId, now: number, n = 12): string[] {
  const since = now - 60 * 86_400_000, count = new Map<string, number>();
  for (const r of history) if (r.siteId === siteId && r.createdAt >= since) count.set(r.productId, (count.get(r.productId) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => id);
}

/** Hours an urgent request may wait with nothing assigned before the owner is told. */
export const ESCALATE_HOURS = 2;
export function needsEscalation(r: StockRequest, p: Progress, events: StockEvent[], now: number): boolean {
  return isUrgent(r, events) && (p.state === "waiting" || p.state === "needs_qty") && now - r.createdAt >= ESCALATE_HOURS * 3_600_000;
}

/** Spend recorded on tasks (production orders are internal transfers, not spend). */
export function spendOf(tasks: PurchaseTask[], events: StockEvent[], suppliers: Supplier[]): number {
  const external = new Set(tasks.filter((t) => t.method !== "production" && suppliers.find((s) => s.id === t.supplierId)?.method !== "production").map((t) => t.id));
  return events.filter((e) => e.kind === "cost" && e.taskId && external.has(e.taskId)).reduce((s, e) => s + (e.pence ?? 0), 0);
}

/** A plain-text order to paste into an email or a supplier's form. */
export function orderSummary(t: PurchaseTask, views: TaskLineView[], products: Product[], supplier: Supplier | undefined, siteNames: Map<string, string>): string {
  const byProduct = new Map<string, { product?: Product; qty: number; sites: string[] }>();
  for (const v of views.filter((x) => !x.end || x.end.kind !== "line_cancelled")) {
    const e = byProduct.get(v.request.productId) ?? { product: products.find((p) => p.id === v.request.productId), qty: 0, sites: [] };
    e.qty += v.line.qty; e.sites.push(siteNames.get(v.request.siteId) ?? v.request.siteId);
    byProduct.set(v.request.productId, e);
  }
  const lines = [...byProduct.values()].map((e) => `- ${e.qty} x ${e.product ? productLabel(e.product) : "?"}`);
  return [`PHO & CO order ${taskCode(t)}${supplier ? ` for ${supplier.name}` : ""}${t.requiredBy ? `, needed by ${t.requiredBy}` : ""}`, ...lines].join("\n");
}

/** Every request with where it stands. */
export function withProgress(d: { requests: StockRequest[]; lines: TaskLine[]; events: StockEvent[]; receipts: Receipt[]; tasks: Pick<PurchaseTask, "id" | "cancelledAt">[] }): { request: StockRequest; progress: Progress }[] {
  return d.requests.map((request) => ({ request, progress: progress(request, d.lines, d.events, d.receipts, d.tasks) }));
}
