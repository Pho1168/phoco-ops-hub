import { isOwner } from "./access";
import { onProductionTeam, type ProductionRow, type Product, type Supplier } from "./stock";
import { addDays } from "./time";
import type { Person, Site, SiteId } from "./types";

/**
 * The production stock count. At a production kitchen the team counts what is on the shelf at close, in each
 * product's own unit (the product's size: "10L", "25pcs"). The people who plan the day set a target per product, and
 * the plan works out what to make:
 *
 *   to make = target + still to send to the restaurants − on the shelf   (never below 0)
 *
 * "Still to send" is what the restaurants have ordered on the kitchen's production orders and has not been
 * dispatched yet, because that will come off the shelf. Counts and targets are only ever added: a recount or a new
 * target is a new record, and the latest one counts.
 */

export interface CountLine { productId: string; qty: number }
export interface StockCount {
  id: string; siteId: SiteId; countedBy: string; countedByName?: string; date: string;
  /** One per product counted. A product left out was not counted. */
  lines: CountLine[]; note?: string; createdAt: number;
  /** A supplier's products counted on an order day. Unset: the kitchen's own production list. */
  supplierId?: string;
}
/** The latest target for a product at a kitchen. No qty: the target was taken off. */
export interface StockTarget { siteId: SiteId; productId: string; qty?: number; setBy: string; setByName?: string; setAt: number }

export const COUNT_MAX = 99_999;
export const COUNT_NOTE_MAX = 300;

/** A production kitchen: a site of kind production. */
export const isKitchen = (site: Pick<Site, "kind">) => site.kind === "production";

/** What the team counts at a kitchen: every active product whose supplier is that kitchen, in catalogue order. */
export function countProducts<P extends Pick<Product, "id" | "active" | "supplierId">>(products: P[], suppliers: Pick<Supplier, "id" | "method" | "siteId">[], siteId: SiteId): P[] {
  const own = new Set(suppliers.filter((s) => s.method === "production" && s.siteId === siteId).map((s) => s.id));
  return products.filter((p) => p.active && !!p.supplierId && own.has(p.supplierId));
}

/** Counting: the production team (production staff there, its managers, ops and owners) at an open kitchen. */
export const canCount = (p: Pick<Person, "status" | "access">, site: Pick<Site, "id" | "kind" | "status">) =>
  isKitchen(site) && site.status === "open" && onProductionTeam(p, site.id);

/** Planning the day and setting targets: owners, and the kitchen's managers and operations managers. */
export const plansProduction = (p: Pick<Person, "status" | "access">, siteId: SiteId) =>
  p.status === "active" && (isOwner(p) || p.access.some((a) => a.siteId === siteId && (a.role === "manager" || a.role === "ops")));

const round2 = (n: number) => Math.round(n * 100) / 100;
const qtyOk = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= COUNT_MAX;

/**
 * A count, checked: products the kitchen counts, once each, a number from 0 (a 0 is counted: there is none), at
 * least one product counted, a short note.
 */
export function cleanCount(lines: { productId: string; qty: number | null | undefined }[], allowed: Pick<Product, "id">[], note?: string):
  { ok: true; value: { lines: CountLine[]; note?: string } } | { ok: false; error: string } {
  if (lines.length > 500) return { ok: false, error: "That's too many lines for one count" };
  const ids = new Set(allowed.map((p) => p.id));
  const out: CountLine[] = [];
  for (const l of lines) {
    if (l.qty === null || l.qty === undefined) continue;
    if (!ids.has(l.productId)) return { ok: false, error: "One of the products isn't counted here any more. Reload the page and try again" };
    if (!qtyOk(l.qty)) return { ok: false, error: `Counts are a number from 0 to ${COUNT_MAX}` };
    if (out.some((o) => o.productId === l.productId)) continue;
    out.push({ productId: l.productId, qty: round2(l.qty) });
  }
  if (!out.length) return { ok: false, error: "Count at least one item. Put 0 for anything that has run out" };
  const n = note?.trim().replace(/\s+/g, " ").slice(0, COUNT_NOTE_MAX) || undefined;
  return { ok: true, value: { lines: out, ...(n ? { note: n } : {}) } };
}

/** Targets to set, checked: products the kitchen counts, a number from 0, or none to take the target off. */
export function cleanTargets(entries: { productId: string; qty: number | null | undefined }[], allowed: Pick<Product, "id">[]):
  { ok: true; value: { productId: string; qty?: number }[] } | { ok: false; error: string } {
  if (entries.length > 500) return { ok: false, error: "That's too many targets at once" };
  const ids = new Set(allowed.map((p) => p.id));
  const out: { productId: string; qty?: number }[] = [];
  for (const e of entries) {
    if (!ids.has(e.productId)) return { ok: false, error: "One of the products isn't counted here any more. Reload the page and try again" };
    if (out.some((o) => o.productId === e.productId)) continue;
    if (e.qty === null || e.qty === undefined) { out.push({ productId: e.productId }); continue; }
    if (!qtyOk(e.qty)) return { ok: false, error: `Targets are a number from 0 to ${COUNT_MAX}, or leave it empty for no target` };
    out.push({ productId: e.productId, qty: round2(e.qty) });
  }
  return { ok: true, value: out };
}

/** Only the targets that differ from the ones in use (a new record for each; the rest stay as they are). */
export function changedTargets(next: { productId: string; qty?: number }[], current: Pick<StockTarget, "productId" | "qty">[]) {
  const now = new Map(current.map((t) => [t.productId, t.qty]));
  return next.filter((t) => (now.has(t.productId) ? now.get(t.productId) : undefined) !== t.qty);
}

export type PlanState = "make" | "ok" | "not_counted" | "no_target";
export interface PlanRow {
  product: Product;
  /** On the shelf at the latest count. Unset: not counted then. */
  onHand?: number;
  target?: number;
  /** Ordered by the restaurants and not dispatched yet. */
  toSend: number;
  /** What to make or restock. Unset when it wasn't counted. */
  make?: number;
  state: PlanState;
}

/**
 * The plan from the latest count: per product, what's on the shelf, the target, what the restaurants still need
 * sending, and what to make. Without a target, enough to cover what's still to send. Not counted: no number.
 * Order: to make first, then not counted, then no target, then enough; catalogue order within each.
 */
export function productionPlan(products: Product[], targets: Pick<StockTarget, "productId" | "qty">[], count: Pick<StockCount, "lines"> | undefined, orders: Pick<ProductionRow, "product" | "outstanding">[]): PlanRow[] {
  const target = new Map(targets.filter((t) => t.qty !== undefined).map((t) => [t.productId, t.qty!]));
  const onHand = new Map((count?.lines ?? []).map((l) => [l.productId, l.qty]));
  const toSend = new Map<string, number>();
  for (const o of orders) toSend.set(o.product.id, round2((toSend.get(o.product.id) ?? 0) + o.outstanding));
  const rows = products.map((product, i): PlanRow & { i: number } => {
    const t = target.get(product.id), h = onHand.get(product.id), s = toSend.get(product.id) ?? 0;
    if (h === undefined) return { i, product, target: t, toSend: s, state: "not_counted" };
    const make = round2(Math.max(0, (t ?? 0) + s - h));
    return { i, product, onHand: h, target: t, toSend: s, make, state: make > 0 ? "make" : t === undefined ? "no_target" : "ok" };
  });
  const rank: Record<PlanState, number> = { make: 0, not_counted: 1, no_target: 2, ok: 3 };
  return rows.sort((a, b) => rank[a.state] - rank[b.state] || a.i - b.i).map(({ i, ...r }) => { void i; return r; });
}

/** Counted below its target (what the message to the planners counts). */
export const belowTarget = (rows: PlanRow[]) => rows.filter((r) => r.onHand !== undefined && r.target !== undefined && r.onHand < r.target);

/** How old a count is, in words, from its business date: "today", "yesterday", "3 days ago". */
export function countAge(date: string, today: string): string {
  if (date >= today) return "today";
  if (date === addDays(today, -1)) return "yesterday";
  const days = Math.round((Date.parse(today) - Date.parse(date)) / 86_400_000);
  return `${days} days ago`;
}

/** A count older than yesterday's is too old to plan from without a warning. */
export const countIsOld = (date: string | undefined, today: string) => !date || date < addDays(today, -1);
