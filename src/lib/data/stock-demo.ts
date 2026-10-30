import { randomUUID } from "node:crypto";
import { checkLineEnd, checkReceipt, checkTaskLines, canCancelRequest, canChangeSupplier, laterReportNote, lineEnd, onTopNote, planOnTop, planSubmit, progress, reqCode, sameProduct, shortOf, TERMINAL, withProgress,
  type NewItem, type Price, type Product, type PurchaseTask, type Receipt, type StockEvent, type StockReport, type StockRequest, type Supplier, type TaskLine } from "@/lib/domain/stock";
import type { StockCount, StockTarget } from "@/lib/domain/stock-count";
import type { SiteId } from "@/lib/domain/types";
import type { StockData, StockStore } from "./stock-store";

/** The stock records in demo mode: in memory, with the same rules as the database. Demo products are a small sample. */

interface StockState {
  suppliers: Supplier[]; products: (Product & { position: number })[]; prices: Price[];
  reports: StockReport[]; requests: StockRequest[]; tasks: PurchaseTask[]; lines: TaskLine[]; events: StockEvent[]; receipts: Receipt[];
  purchasers: Set<string>; nextRequest: number; nextTask: number;
  /** Production counts and every target ever set (the latest per product counts). */
  counts: StockCount[]; targets: StockTarget[];
  /** Where a supplier delivers (a production kitchen), shown on its order sheet. */
  delivers: { supplierId: string; deliversTo?: SiteId }[];
  /** Items asked for that aren't in the catalogue, for the owner. */
  newItems: NewItem[];
}

function seed(): StockState {
  const sup = (name: string, method: Supplier["method"], extra: Partial<Supplier> = {}): Supplier => ({ id: randomUUID(), name, method, active: true, ...extra });
  const suppliers = [
    sup("Production (demo)", "production", { siteId: "WEM", note: "The Wembley production kitchen" }),
    sup("Surelygrow (demo)", "delivery", { deliveryDays: [1, 5] }), sup("Wing Yip (demo)", "shop"), sup("Lidl/Aldi (demo)", "shop"),
    sup("Amazon (demo)", "online", { link: "https://www.amazon.co.uk" }),
  ];
  const [prod, main, wy, lidl, amz] = suppliers;
  let position = 0;
  const p = (name: string, size: string | undefined, s: Supplier, category?: string): Product & { position: number } =>
    ({ id: randomUUID(), name, size, supplierId: s.id, category, active: true, position: ++position });
  const products = [
    p("Soup", "10L", prod, "Production"), p("Beef Brisket", "1kg", prod, "Production"), p("Chicken Spring Rolls", "25pcs", prod, "Production"),
    p("Spicy Paste", "Container", prod, "Production"),
    p("Lime", "Case", main, "Fruit & veg"), p("Spring Onions", "Case x 14", main, "Fruit & veg"), p("Tofu", "Pack", main, "Chilled"),
    p("Squid Brand Fish Sauce", "Case", main, "Sauces"), p("Pride Rapeseed Oil", "20L", main, "Dry"),
    p("Coconut Milk", "Can", wy, "Che"), p("Sweet Hoisin Sauce", "Unit", wy, "Sauces"), p("Che Lychee", "Can", wy, "Che"),
    p("Wings", "1kg", lidl, "Meat"), p("Condensed Milk", "Can", lidl, "Che"),
    p("Z-Fold Tissue", "Pack", amz, "Cleaning"), p("Blue Rolls", "Pack", amz, "Cleaning"),
  ];
  // The kitchen's copies of the main supplier's products, which restaurants order from the kitchen.
  products.push({ ...p("Tofu", "Pack", prod, "From production"), copyOf: products[6].id }, { ...p("Lime", "Case", prod, "From production"), copyOf: products[4].id });
  // Some products are sold at more than one shop.
  products[9].alsoFrom = [lidl.id]; // Coconut Milk: Wing Yip, or Lidl/Aldi
  products[13].alsoFrom = [wy.id]; // Condensed Milk: Lidl/Aldi, or Wing Yip
  const prices: Price[] = [
    { productId: products[7].id, pence: 2385, on: "2025-09-03", note: "12 x 725ml" },
    { productId: products[9].id, pence: 115, on: "2025-09-03" },
  ];
  // Wembley's targets for its production products, so the plan has something to work from.
  const targets: StockTarget[] = [[0, 4], [1, 10], [2, 8], [3, 3]].map(([i, qty]) => ({ siteId: "WEM", productId: products[i].id, qty, setBy: "DEMO-OWN", setAt: Date.now() - 86_400_000 }));
  return { suppliers, products, prices, reports: [], requests: [], tasks: [], lines: [], events: [], receipts: [], purchasers: new Set(["DEMO-MGR", "DEMO-FLT"]), nextRequest: 1, nextTask: 1,
    counts: [], targets, newItems: [],
    // The main supplier delivers to the Wembley kitchen.
    delivers: [{ supplierId: main.id, deliversTo: "WEM" }] };
}

const g = globalThis as unknown as { __phocoStockDemo?: StockState };
const S = (): StockState => (g.__phocoStockDemo ??= seed());
export function resetStockDemo() { g.__phocoStockDemo = seed(); }
/** Photo ids the stock records use (kept by the demo's photo clean-up). */
export const stockMediaUsed = () => [...S().requests.map((r) => r.photoId), ...S().events.map((e) => e.mediaId), ...S().reports.filter((r) => !r.submittedAt).flatMap((r) => r.lines.map((l) => l.photoId))].filter(Boolean).join(",");

const isEnd = (e: StockEvent) => (TERMINAL as readonly string[]).includes(e.kind);

/** Everything about these requests and tasks, as in the database (the lines of either and the other side of them). */
function gather(requestIds: string[], taskIds: string[]): StockData {
  const s = S();
  const lines = s.lines.filter((l) => requestIds.includes(l.requestId) || taskIds.includes(l.taskId));
  const reqIds = new Set([...requestIds, ...lines.map((l) => l.requestId)]);
  const tIds = new Set([...taskIds, ...lines.map((l) => l.taskId)]);
  return {
    requests: s.requests.filter((r) => reqIds.has(r.id)).sort((a, b) => b.createdAt - a.createdAt),
    tasks: s.tasks.filter((t) => tIds.has(t.id)).sort((a, b) => b.createdAt - a.createdAt),
    lines: lines.map((l) => ({ ...l })),
    events: s.events.filter((e) => (e.requestId && reqIds.has(e.requestId)) || (e.taskId && tIds.has(e.taskId))).sort((a, b) => a.at - b.at),
    receipts: s.receipts.filter((x) => reqIds.has(x.requestId)),
  };
}

export function makeStockDemo(deps: { personName: (id: string) => string | undefined; setStockReminder: (siteId: SiteId, on: boolean) => void }): StockStore {
  const named = <T extends { assigneeId?: string; driverId?: string }>(t: T) => ({ ...t, assigneeName: t.assigneeId ? deps.personName(t.assigneeId) : undefined, driverName: t.driverId ? deps.personName(t.driverId) : undefined });
  const event = (e: Omit<StockEvent, "id" | "at" | "byName">, at = Date.now()) => { S().events.push({ ...e, id: randomUUID(), at, byName: deps.personName(e.by) }); };
  const view = (d: StockData): StockData => ({ ...d, tasks: d.tasks.map(named), requests: d.requests.map((r) => ({ ...r, requestedByName: deps.personName(r.requestedBy) })),
    receipts: d.receipts.map((x) => ({ ...x, byName: deps.personName(x.by) })) });
  return {
    async stockCatalog() {
      const s = S();
      return { suppliers: [...s.suppliers].sort((a, b) => a.name.localeCompare(b.name)), products: [...s.products].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || (a.size ?? "").localeCompare(b.size ?? "", "en", { sensitivity: "base" }) || a.position - b.position).map(({ position, ...p }) => { void position; return p; }),
        prices: [...s.prices].sort((a, b) => b.on.localeCompare(a.on)) };
    },
    async saveSupplier(id, sup, active) {
      const s = S();
      const existing = id ? s.suppliers.find((x) => x.id === id) : undefined;
      if (existing) { Object.assign(existing, { siteId: undefined, note: undefined, link: undefined }, sup, { active }); return existing.id; }
      const n = { id: randomUUID(), ...sup, active };
      s.suppliers.push(n);
      return n.id;
    },
    async saveProduct(id, p, active) {
      const s = S();
      if (s.products.some((x) => x.id !== id && sameProduct(x, p))) return false;
      const existing = id ? s.products.find((x) => x.id === id) : undefined;
      const flag = p.forRestaurants === false ? { forRestaurants: false } : { forRestaurants: undefined };
      const also = p.alsoFrom ? { alsoFrom: p.alsoFrom.length ? [...p.alsoFrom] : undefined } : {};
      const { alsoFrom: _ignored, ...rest } = p; void _ignored;
      if (existing) { Object.assign(existing, { size: undefined, category: undefined, supplierId: undefined, link: undefined }, rest, flag, also, { active }); return existing.id; }
      const n = { id: randomUUID(), ...rest, ...flag, ...also, active, position: s.products.length + 1 };
      s.products.push(n);
      return n.id;
    },
    async addPrice(p) { S().prices.push({ ...p }); },
    async purchaserIds() { return [...S().purchasers]; },
    async setPurchaser(personId, on) { if (on) S().purchasers.add(personId); else S().purchasers.delete(personId); },
    async setSiteStockReminder(siteId, on) { deps.setStockReminder(siteId, on); },

    async stockDraft(siteId, personId) {
      const r = S().reports.find((x) => x.siteId === siteId && x.personId === personId && !x.submittedAt);
      return r && { ...r, personName: deps.personName(r.personId), lines: r.lines.map((l) => ({ ...l })), extras: r.extras.map((x) => ({ ...x })) };
    },
    async saveStockDraft(siteId, personId, date, lines, noIssues, extras) {
      const s = S();
      let r = s.reports.find((x) => x.siteId === siteId && x.personId === personId && !x.submittedAt);
      if (!r) { r = { id: randomUUID(), siteId, personId, date, lines: [], noIssues: false, updatedAt: Date.now(), extras: [] }; s.reports.push(r); }
      Object.assign(r, { date, lines: lines.map((l) => ({ ...l })), noIssues, updatedAt: Date.now() }, extras ? { extras: extras.map((x) => ({ ...x })) } : {});
      return { ...r, personName: deps.personName(personId) };
    },
    async stockReports(siteIds, since) {
      return S().reports.filter((r) => r.submittedAt && siteIds.includes(r.siteId) && r.submittedAt >= since).sort((a, b) => b.submittedAt! - a.submittedAt!)
        .map((r) => ({ ...r, personName: deps.personName(r.personId) }));
    },
    async submitStockReport(reportId, by, lines, products, extras = []) {
      const s = S();
      const rep = s.reports.find((r) => r.id === reportId);
      if (!rep || rep.submittedAt) return false;
      rep.submittedAt = Date.now(); rep.updatedAt = rep.submittedAt;
      const ids = s.requests.filter((r) => r.siteId === rep.siteId && !r.cancelledAt && lines.some((l) => l.productId === r.productId)).map((r) => r.id);
      const plan = planSubmit(lines, rep.siteId, withProgress(gather(ids, [])), products);
      const made: StockRequest[] = [];
      for (const l of plan.create) {
        const r: StockRequest = { id: randomUUID(), code: s.nextRequest++, siteId: rep.siteId, productId: l.productId, level: l.level, qty: l.qty, note: l.note, photoId: l.photoId,
          reportId, requestedBy: by, supplierId: l.supplierId, createdAt: Date.now() };
        s.requests.push(r); made.push({ ...r, requestedByName: deps.personName(by) });
      }
      for (const a of plan.again) {
        event({ by, kind: "reported_again", requestId: a.requestId, qty: a.line.qty, text: a.line.level, mediaId: a.line.photoId });
        if (a.line.note) event({ by, kind: "note", requestId: a.requestId, text: a.line.note });
        if (a.setQty !== undefined) {
          const r = s.requests.find((x) => x.id === a.requestId)!;
          r.fixedQty = a.setQty;
          event({ by, kind: "qty_changed", requestId: a.requestId, qty: a.setQty, text: laterReportNote(a.was) });
        }
      }
      const newItems: NewItem[] = [];
      for (const x of extras) {
        if (x.qty === undefined) continue;
        const n: NewItem = { id: randomUUID(), siteId: rep.siteId, reportId, name: x.name, size: x.size, qty: x.qty, note: x.note, requestedBy: by, createdAt: Date.now() };
        s.newItems.push(n); newItems.push({ ...n, requestedByName: deps.personName(by) });
      }
      return { created: made, again: plan.again.length, newItems };
    },
    async addOnTop(siteId, by, lines, products) {
      const s = S();
      const ids = s.requests.filter((r) => r.siteId === siteId && !r.cancelledAt && lines.some((l) => l.productId === r.productId)).map((r) => r.id);
      const plan = planOnTop(lines, siteId, withProgress(gather(ids, [])), products);
      const created: StockRequest[] = [];
      for (const l of plan.create) {
        const r: StockRequest = { id: randomUUID(), code: s.nextRequest++, siteId, productId: l.productId, level: "low", qty: l.qty, requestedBy: by, supplierId: l.supplierId, createdAt: Date.now() };
        s.requests.push(r); created.push({ ...r, requestedByName: deps.personName(by) });
      }
      for (const b of plan.bump) {
        s.requests.find((x) => x.id === b.requestId)!.fixedQty = b.to;
        event({ by, kind: "qty_changed", requestId: b.requestId, qty: b.to, text: onTopNote(b.add, b.was) });
      }
      return { created, raised: plan.bump };
    },
    async stockNewItems(f) {
      return S().newItems.filter((n) => (!f.open || !n.decidedAt) && (f.since === undefined || n.createdAt >= f.since || !n.decidedAt) && (!f.siteIds || f.siteIds.includes(n.siteId)))
        .sort((a, b) => a.createdAt - b.createdAt).map((n) => ({ ...n, requestedByName: deps.personName(n.requestedBy) }));
    },
    async decideNewItem(id, by, d) {
      const s = S();
      const n = s.newItems.find((x) => x.id === id);
      if (!n) return { ok: false, error: "That new item isn't there" };
      if (n.decidedAt) return { ok: false, error: "That new item has already been dealt with" };
      if ("dismiss" in d) { Object.assign(n, { decidedAt: Date.now(), decidedBy: by, dismissed: d.dismiss }); return { ok: true, value: {} }; }
      if (!s.products.some((p) => p.id === d.productId)) return { ok: false, error: "That product isn't in the catalogue" };
      const r: StockRequest = { id: randomUUID(), code: s.nextRequest++, siteId: n.siteId, productId: d.productId, level: "low", qty: d.qty, note: n.note,
        reportId: n.reportId, requestedBy: n.requestedBy, supplierId: d.supplierId, createdAt: Date.now() };
      s.requests.push(r);
      event({ by, kind: "note", requestId: r.id, text: "New item, added to the catalogue" });
      Object.assign(n, { decidedAt: Date.now(), decidedBy: by, productId: d.productId, requestId: r.id });
      return { ok: true, value: { request: { ...r, requestedByName: deps.personName(n.requestedBy) } } };
    },

    async stockData(f) {
      const s = S();
      // Made since then, or still in hand however old (not cancelled, and not yet received in full).
      const inHand = (r: StockRequest) => { if (r.cancelledAt) return false; const w = r.fixedQty ?? r.qty; return w === undefined || s.receipts.filter((x) => x.requestId === r.id).reduce((t, x) => t + x.qty, 0) < w; };
      const reqIds = s.requests.filter((r) => (r.createdAt >= f.since || inHand(r)) && (!f.siteIds || f.siteIds.includes(r.siteId))).map((r) => r.id);
      const taskIds = f.siteIds ? [] : s.tasks.filter((t) => t.createdAt >= f.since).map((t) => t.id);
      const d = gather(reqIds, taskIds);
      if (!f.siteIds) return view(d);
      const mine = new Set(d.requests.filter((r) => f.siteIds!.includes(r.siteId)).map((r) => r.id));
      const lines = d.lines.filter((l) => mine.has(l.requestId));
      const lineIds = new Set(lines.map((l) => l.id));
      return view({ requests: d.requests.filter((r) => mine.has(r.id)), tasks: d.tasks.filter((t) => lines.some((l) => l.taskId === t.id)), lines,
        events: d.events.filter((e) => (e.requestId && mine.has(e.requestId)) || (e.lineId && lineIds.has(e.lineId)) || (!e.lineId && !e.requestId && e.taskId && lines.some((l) => l.taskId === e.taskId))),
        receipts: d.receipts.filter((x) => mine.has(x.requestId)) });
    },
    async stockTask(taskId) {
      if (!S().tasks.some((t) => t.id === taskId)) return undefined;
      return view(gather([], [taskId]));
    },

    async createStockTask(t, lines) {
      const s = S();
      const check = checkTaskLines(lines, withProgress(gather(lines.map((l) => l.requestId), [])), t.supplierId, t.method);
      if (!check.ok) return check;
      const task: PurchaseTask = { ...t, id: randomUUID(), code: s.nextTask++, createdAt: Date.now() };
      s.tasks.push(task);
      for (const l of check.value) s.lines.push({ id: randomUUID(), taskId: task.id, requestId: l.requestId, qty: l.qty });
      if (t.assigneeId || t.driverId) event({ by: t.createdBy, kind: "assigned", taskId: task.id, text: "created" });
      return { ok: true, value: task.id };
    },
    async addToProductionOrder(supplierId, destination, date, requestIds, by) {
      const s = S();
      const lines = withProgress(gather(requestIds, [])).filter((x) => requestIds.includes(x.request.id) && x.request.siteId === destination && x.request.supplierId === supplierId && x.progress.toPlan > 0)
        .map((x) => ({ requestId: x.request.id, qty: x.progress.toPlan }));
      if (!lines.length) return undefined;
      const open = s.tasks.filter((t) => t.method === "production" && t.supplierId === supplierId && t.destination === destination && t.requiredBy === date && !t.cancelledAt)
        .sort((a, b) => a.createdAt - b.createdAt)
        .find((t) => !s.lines.some((l) => l.taskId === t.id && s.events.some((e) => e.lineId === l.id && isEnd(e)))
          && !s.events.some((e) => e.taskId === t.id && (e.kind === "picked" || e.kind === "packed")));
      let id = open?.id;
      if (!id) {
        const task: PurchaseTask = { id: randomUUID(), code: s.nextTask++, supplierId, method: "production", requiredBy: date, priority: "normal", destination, createdBy: by, createdAt: Date.now() };
        s.tasks.push(task); id = task.id;
      }
      for (const l of lines) s.lines.push({ id: randomUUID(), taskId: id, requestId: l.requestId, qty: l.qty });
      return id;
    },
    async orderPlaced(taskId, by, ref, on) {
      const s = S();
      const t = s.tasks.find((x) => x.id === taskId);
      if (!t || t.cancelledAt) return { ok: false, error: "That task has been cancelled" };
      event({ by, kind: "ordered", taskId, ref, on });
      for (const l of s.lines.filter((x) => x.taskId === taskId && !s.events.some((e) => e.lineId === x.id && isEnd(e)))) {
        event({ by, kind: "bought", taskId, lineId: l.id, requestId: l.requestId, qty: l.qty, text: ref ? `order ${ref}` : "ordered" });
      }
      return { ok: true, value: undefined };
    },
    async updateStockTask(id, patch, by) {
      const t = S().tasks.find((x) => x.id === id && !x.cancelledAt);
      if (!t) return false;
      const before = [t.assigneeId, t.driverId];
      for (const k of ["assigneeId", "driverId", "requiredBy", "note"] as const) if (k in patch) t[k] = patch[k] ?? undefined;
      if (patch.priority) t.priority = patch.priority;
      if (before[0] !== t.assigneeId || before[1] !== t.driverId) event({ by, kind: "assigned", taskId: id, text: "changed" });
      return true;
    },
    async cancelStockTask(id, by, reason) {
      const s = S();
      const t = s.tasks.find((x) => x.id === id && !x.cancelledAt);
      if (!t) return false;
      for (const l of s.lines.filter((x) => x.taskId === id && !s.events.some((e) => e.lineId === x.id && isEnd(e)))) {
        event({ by, kind: "line_cancelled", taskId: id, lineId: l.id, requestId: l.requestId, text: reason });
      }
      event({ by, kind: "task_cancelled", taskId: id, text: reason });
      Object.assign(t, { cancelledAt: Date.now(), cancelReason: reason });
      return true;
    },
    async addStockEvent(e) {
      const s = S();
      if (e.lineId) {
        const l = s.lines.find((x) => x.id === e.lineId);
        if (!l) return { ok: false, error: "That line isn't there any more" };
        if ((TERMINAL as readonly string[]).includes(e.kind)) {
          if (s.events.some((x) => x.lineId === l.id && isEnd(x))) return { ok: false, error: "That's already been recorded" };
          if (e.kind !== "line_cancelled") {
            const check = checkLineEnd(e.kind as "bought" | "unavailable" | "dispatched", e.qty, l, s.events);
            if (!check.ok) return check;
            e = { ...e, qty: check.qty };
          }
        }
        e = { ...e, taskId: l.taskId, requestId: l.requestId };
      }
      event(e);
      return { ok: true, value: undefined };
    },
    async addStockReceipt(requestId, qty, by, note) {
      const d = gather([requestId], []);
      const r = d.requests.find((x) => x.id === requestId);
      if (!r) return { ok: false, error: "That request isn't there" };
      const check = checkReceipt(qty, progress(r, d.lines, d.events, d.receipts, d.tasks));
      if (!check.ok) return check;
      S().receipts.push({ id: randomUUID(), requestId, qty: check.qty, by, at: Date.now(), note });
      return { ok: true, value: undefined };
    },
    async untickLine(lineId, by, back) {
      const s = S();
      const line = s.lines.find((x) => x.id === lineId);
      if (!line) return { ok: false, error: "That isn't there any more" };
      const t = s.tasks.find((x) => x.id === line.taskId);
      if (back === "task" && t?.cancelledAt) return { ok: false, error: "That list has been taken back" };
      if (s.requests.some((r) => r.reopensLine === lineId) || s.lines.some((l) => l.redoes === lineId)) return { ok: false, error: "That's already been unticked" };
      const d = gather([line.requestId], []);
      const end = lineEnd(line, d.events);
      const r = s.requests.find((x) => x.id === line.requestId);
      if (!r || !end || end.kind === "line_cancelled") return { ok: false, error: "That isn't ticked" };
      if (end.kind === "unavailable") {
        if (back !== "task") return { ok: false, error: "That isn't ticked" };
        const p = progress(r, d.lines, d.events, d.receipts, d.tasks);
        if (r.cancelledAt || p.toPlan < line.qty) return { ok: false, error: "It's been ordered or given to someone since, so it stays where it is" };
        s.lines.push({ id: randomUUID(), taskId: line.taskId, requestId: r.id, qty: line.qty, redoes: lineId });
        event({ by, kind: "note", taskId: line.taskId, requestId: r.id, text: "Unticked: back on the list" });
        return { ok: true, value: { requestId: r.id } };
      }
      const qty = Math.round(Math.max(0, end.qty - shortOf(line, d.events)) * 100) / 100;
      if (!(qty > 0)) return { ok: false, error: "That isn't ticked" };
      const n: StockRequest = { id: randomUUID(), code: s.nextRequest++, siteId: r.siteId, productId: r.productId, level: r.level, qty, note: r.note, photoId: r.photoId,
        reportId: r.reportId, requestedBy: r.requestedBy, supplierId: r.supplierId ?? t?.supplierId, createdAt: Date.now(), reopensLine: lineId };
      s.requests.push(n);
      event({ by, kind: "note", requestId: r.id, text: `Unticked: back on the list as ${reqCode(n)}` });
      event({ by, kind: "note", requestId: n.id, text: `Put back after an untick of ${reqCode(r)}` });
      if (back === "task") s.lines.push({ id: randomUUID(), taskId: line.taskId, requestId: n.id, qty, redoes: lineId });
      return { ok: true, value: { requestId: n.id } };
    },
    async changeStockRequest(id, change, by) {
      const s = S();
      const d = gather([id], []);
      const r = s.requests.find((x) => x.id === id);
      if (!r) return { ok: false, error: "That request isn't there" };
      const p = progress(r, d.lines, d.events, d.receipts, d.tasks);
      if (p.state === "cancelled") return { ok: false, error: "That request is cancelled" };
      if ("fixedQty" in change) {
        const q = Math.round(change.fixedQty * 100) / 100;
        if (!(q > 0) || q > 9999) return { ok: false, error: "Give a quantity above 0" };
        if (q < p.planned + p.obtained) return { ok: false, error: `${p.planned + p.obtained} is already assigned or bought. Cancel those lines first` };
        r.fixedQty = q;
        event({ by, kind: "qty_changed", requestId: id, qty: q, text: p.wanted === undefined ? "was not sure" : `was ${p.wanted}` });
      } else if ("supplierId" in change) {
        if (!canChangeSupplier(p)) return { ok: false, error: "Part of it is already assigned or bought. Cancel those lines first" };
        r.supplierId = change.supplierId ?? undefined;
        event({ by, kind: "supplier_changed", requestId: id, text: s.suppliers.find((x) => x.id === change.supplierId)?.name ?? "no supplier" });
      } else {
        if (!canCancelRequest(p)) return { ok: false, error: "Part of it is already bought. Confirm what arrived, or cancel just what's left" };
        for (const l of d.lines.filter((x) => x.requestId === id && !d.events.some((e) => e.lineId === x.id && isEnd(e)))) {
          event({ by, kind: "line_cancelled", taskId: l.taskId, lineId: l.id, requestId: id, text: change.cancel });
        }
        event({ by, kind: "request_cancelled", requestId: id, text: change.cancel });
        Object.assign(r, { cancelledAt: Date.now(), cancelReason: change.cancel });
      }
      return { ok: true, value: undefined };
    },

    async stockCounts(siteId, since, supplierId) {
      return S().counts.filter((c) => c.siteId === siteId && c.supplierId === supplierId && c.createdAt >= since).sort((a, b) => b.createdAt - a.createdAt)
        .map((c) => ({ ...c, lines: c.lines.map((l) => ({ ...l })), countedByName: deps.personName(c.countedBy) }));
    },
    async addStockCount(c) {
      const s = S();
      const at = Math.max(Date.now(), (s.counts.at(-1)?.createdAt ?? 0) + 1);
      const n: StockCount = { ...c, lines: c.lines.map((l) => ({ ...l })), id: randomUUID(), createdAt: at };
      s.counts.push(n);
      return { ...n, countedByName: deps.personName(n.countedBy) };
    },
    async stockTargets(siteId) {
      const latest = new Map<string, StockTarget>();
      for (const t of S().targets.filter((x) => x.siteId === siteId)) if (!latest.has(t.productId) || latest.get(t.productId)!.setAt <= t.setAt) latest.set(t.productId, t);
      return [...latest.values()].map((t) => ({ ...t, setByName: deps.personName(t.setBy) }));
    },
    async setStockTargets(siteId, targets, by) {
      const s = S();
      const at = Date.now();
      for (const t of targets) s.targets.push({ siteId, productId: t.productId, ...(t.qty !== undefined ? { qty: t.qty } : {}), setBy: by, setAt: at });
      return targets.length;
    },

    async supplierDelivers() { return S().delivers.map((d) => ({ ...d })); },
  };
}
