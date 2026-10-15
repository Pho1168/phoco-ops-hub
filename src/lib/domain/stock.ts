import { isOwner } from "./access";
import type { Person, Site, SiteId } from "./types";

/**
 * Stock & Purchasing. Staff report what's low or out (a report of lines); each line becomes a request with a
 * permanent code (SR-…). The owner groups what's still needed by supplier and gives it to someone as a purchase task
 * (PT-…) of lines: one line per request and quantity, so a combined buy keeps each restaurant's share. What happens
 * next is a log of events that are only ever added (bought, unavailable, dispatched, cost, …), and the restaurant
 * confirms what arrived (receipts). Quantities are never mixed up: wanted, planned, obtained, received.
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

/** The purchasing dashboard, catalogue, suppliers and assignments: the owner only. */
export const runsPurchasing = (p: Pick<Person, "status" | "access">) => p.status === "active" && isOwner(p);

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
}
export const QTY_MAX = 9999;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A report's lines, checked: known active products, once each, a quantity above 0 or none ("not sure"), short notes. */
export function cleanLines(lines: DraftLine[], products: Pick<Product, "id" | "active">[]): { ok: true; value: DraftLine[] } | { ok: false; error: string } {
  if (lines.length > 200) return { ok: false, error: "That's too many lines for one report" };
  const out: DraftLine[] = [];
  for (const l of lines) {
    const p = products.find((x) => x.id === l.productId);
    if (!p || !p.active) return { ok: false, error: "One of the products isn't in the catalogue any more. Take it off and try again" };
    if (out.some((o) => o.productId === l.productId)) continue;
    if (l.level !== "low" && l.level !== "out") return { ok: false, error: "Choose low or out for every product" };
    let qty: number | undefined;
    if (l.qty !== undefined && l.qty !== null) {
      qty = Number(l.qty);
      if (!Number.isFinite(qty) || qty <= 0 || qty > QTY_MAX) return { ok: false, error: "Quantities are above 0, or leave it as not sure" };
      qty = Math.round(qty * 100) / 100;
    }
    const note = l.note?.trim().slice(0, 200) || undefined;
    const photoId = l.photoId && UUID.test(l.photoId) ? l.photoId : undefined;
    out.push({ productId: l.productId, level: l.level, ...(qty !== undefined ? { qty } : {}), ...(note ? { note } : {}), ...(photoId ? { photoId } : {}) });
  }
  return { ok: true, value: out };
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
}
export type Priority = "normal" | "urgent";
export interface PurchaseTask {
  id: string; code: number; supplierId?: string; method: SupplyMethod;
  /** Driver (shop), buyer (online), whoever orders (delivery), or the production lead. */
  assigneeId?: string; assigneeName?: string;
  /** Collects an online order, or drives a production order over. */
  driverId?: string; driverName?: string;
  requiredBy?: string; priority: Priority; note?: string;
  /** Production orders: the restaurant it's for. */
  destination?: SiteId;
  createdBy: string; createdAt: number; cancelledAt?: number; cancelReason?: string;
}
export interface TaskLine { id: string; taskId: string; requestId: string; qty: number }
export const TERMINAL = ["bought", "unavailable", "dispatched", "line_cancelled"] as const;
export type Terminal = (typeof TERMINAL)[number];
export type EventKind = Terminal
  | "reported_again" | "qty_changed" | "supplier_changed" | "request_cancelled"
  | "assigned" | "acknowledged" | "ordered" | "cost" | "collected" | "delivered" | "task_cancelled"
  | "picked" | "packed" | "substitute" | "substitute_ok" | "substitute_no" | "note";
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
  cancelled: "Cancelled", needs_qty: "Needs a quantity", waiting: "Waiting to be assigned", part_assigned: "Partly assigned",
  assigned: "Assigned", part_bought: "Partly bought", on_the_way: "Bought, on its way", part_received: "Partly received", received: "Received",
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

/** Where a request stands, from its lines (on tasks not cancelled), their events and its receipts. */
export function progress(r: StockRequest, lines: TaskLine[], events: StockEvent[], receipts: Receipt[], tasks: Pick<PurchaseTask, "id" | "cancelledAt">[]): Progress {
  const live = new Set(tasks.filter((t) => !t.cancelledAt).map((t) => t.id));
  let planned = 0, obtained = 0;
  let unavailable: StockEvent | undefined;
  for (const l of lines.filter((x) => x.requestId === r.id)) {
    const end = lineEnd(l, events);
    if (end) {
      obtained += end.qty;
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

// ---------- submitting a report ----------

export interface SubmitPlan { create: (DraftLine & { supplierId?: string })[]; again: { requestId: string; line: DraftLine; setQty?: number }[] }

/**
 * What a submitted report does. A product already requested at that site and still waiting (nothing of it assigned or
 * bought yet) isn't requested twice: it's noted on that request (an "out" makes it urgent), and a quantity given now
 * fills one that was "not sure". Once part of it is assigned or bought, a new report of it is a new need: a new
 * request. Everything new gets the product's preferred supplier.
 */
export function planSubmit(lines: DraftLine[], siteId: SiteId, open: { request: StockRequest; progress: Progress }[], products: Pick<Product, "id" | "supplierId">[]): SubmitPlan {
  const plan: SubmitPlan = { create: [], again: [] };
  for (const l of lines) {
    const existing = open.find((o) => o.request.siteId === siteId && o.request.productId === l.productId && !o.request.cancelledAt
      && (o.progress.state === "waiting" || o.progress.state === "needs_qty"));
    if (existing) plan.again.push({ requestId: existing.request.id, line: l, ...(existing.progress.wanted === undefined && l.qty !== undefined ? { setQty: l.qty } : {}) });
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
