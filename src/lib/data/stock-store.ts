import type { CatalogueLine, DraftLine, OnTopPlan, NewItem, NewItemLine, Price, Product, PurchaseTask, Receipt, StockEvent, StockReport, StockRequest, Supplier, TaskLine } from "@/lib/domain/stock";
import type { StockCount, StockTarget } from "@/lib/domain/stock-count";
import type { SiteId } from "@/lib/domain/types";

/** Requests and what's happened to them: the raw records the stock rules (src/lib/domain/stock.ts) work from. */
export interface StockData { requests: StockRequest[]; tasks: PurchaseTask[]; lines: TaskLine[]; events: StockEvent[]; receipts: Receipt[] }

export type Done<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Stock & Purchasing records. Part of Store (both stores implement it). Writes that depend on what's already there
 * (a task's lines, a receipt, ending a line) run the stock rules again inside one transaction, with the requests
 * locked, so two people at once can't buy or confirm the same quantity twice.
 */
export interface StockStore {
  stockCatalog(): Promise<{ suppliers: Supplier[]; products: Product[]; prices: Price[] }>;
  saveSupplier(id: string | undefined, s: Omit<Supplier, "id" | "active">, active: boolean): Promise<string>;
  /** False when that name, size and supplier is already another product. */
  /** Adds or changes a product. `alsoFrom` given: its other suppliers are set; left out: they stay as they are. */
  saveProduct(id: string | undefined, p: Pick<Product, "name" | "size" | "category" | "supplierId" | "link" | "forRestaurants" | "alsoFrom">, active: boolean): Promise<string | false>;
  addPrice(p: Price, by: string): Promise<void>;
  purchaserIds(): Promise<string[]>;
  setPurchaser(personId: string, on: boolean): Promise<void>;
  setSiteStockReminder(siteId: SiteId, on: boolean): Promise<void>;

  /** The person's unsent report at the site, if any. */
  stockDraft(siteId: SiteId, personId: string): Promise<StockReport | undefined>;
  /** Saves the draft: its lines and, when given, its new items (left as they are when not). */
  saveStockDraft(siteId: SiteId, personId: string, date: string, lines: DraftLine[], noIssues: boolean, extras?: NewItemLine[]): Promise<StockReport>;
  /** Sent reports at these sites from a time, newest first. */
  stockReports(siteIds: SiteId[], since: number): Promise<StockReport[]>;
  /**
   * Sends the draft, once, with these (checked) lines. Planned inside the transaction with the site's requests for
   * those products locked (`planSubmit`), so two people sending at once never make two requests for one need. False
   * if it was already sent (a second tap, another tab).
   */
  submitStockReport(reportId: string, by: string, lines: DraftLine[], products: Pick<Product, "id" | "supplierId">[], extras?: NewItemLine[]): Promise<{ created: StockRequest[]; again: number; newItems: NewItem[] } | false>;

  /**
   * Adds what was picked from a round supplier's catalogue to the order at the delivery site, on top of what's already
   * waiting there (`planOnTop`, planned inside the transaction with the site's requests for those products locked, like
   * sending a report). New requests have no report.
   */
  addOnTop(siteId: SiteId, by: string, lines: CatalogueLine[], products: Pick<Product, "id" | "supplierId">[]): Promise<{ created: StockRequest[]; raised: OnTopPlan["bump"] }>;

  /** New items (not in the catalogue): still waiting for the owner, or every one from a time, optionally at some sites. Oldest first. */
  stockNewItems(f: { open?: boolean; since?: number; siteIds?: SiteId[] }): Promise<NewItem[]>;
  /**
   * The owner's decision on a new item, once: added (a request for its restaurant for the product, which is already in
   * the catalogue, with this quantity and supplier) or not needed. Refused if it's already been decided.
   */
  decideNewItem(id: string, by: string, d: { productId: string; supplierId?: string; qty: number } | { dismiss: string }): Promise<Done<{ request?: StockRequest }>>;

  /**
   * Requests and tasks made from a time, plus any request still in hand however old (with every line, event and
   * receipt of them), optionally only at some sites.
   */
  stockData(f: { since: number; siteIds?: SiteId[] }): Promise<StockData>;
  /** One task with its lines, their requests, events and receipts. */
  stockTask(taskId: string): Promise<StockData | undefined>;

  /** A task and its lines, after checking every line against the requests as they are now (`checkTaskLines`). */
  createStockTask(t: Omit<PurchaseTask, "id" | "code" | "createdAt" | "cancelledAt" | "cancelReason" | "assigneeName" | "driverName">, lines: { requestId: string; qty: number }[]): Promise<Done<string>>;
  /**
   * Adds what's still to plan of these requests to the open production order for that kitchen, restaurant and day
   * (making one if there's none). Worked out inside the transaction, so a double tap can't add it twice.
   */
  addToProductionOrder(supplierId: string, destination: SiteId, date: string, requestIds: string[], by: string): Promise<string | undefined>;
  /** Order placed (online or with the supplier): the order event and every open line bought in full, together. */
  orderPlaced(taskId: string, by: string, ref?: string, on?: string): Promise<Done>;
  updateStockTask(id: string, patch: Partial<Pick<PurchaseTask, "assigneeId" | "driverId" | "requiredBy" | "priority" | "note">>, by: string): Promise<boolean>;
  /** Cancels the task and ends its open lines (their quantities go back to waiting). */
  cancelStockTask(id: string, by: string, reason: string): Promise<boolean>;
  /** Adds an event. Ending a line runs `checkLineEnd` first, inside the transaction. */
  addStockEvent(e: Omit<StockEvent, "id" | "at" | "byName">): Promise<Done>;
  addStockReceipt(requestId: string, qty: number, by: string, note?: string): Promise<Done>;
  /**
   * Takes a tick back, adding (never changing) what puts it back. Bought or sent: a new request for the same restaurant,
   * product and amount, linked to the line (`reopensLine`); `back: "task"` also puts it on the same driver's list (a new
   * line, `redoes`). Couldn't get (`back: "task"` only): a new line on the list for the same request, if it's still
   * waiting. Refused if the line wasn't ticked or was unticked already (one each, also guarded by the database).
   */
  untickLine(lineId: string, by: string, back: "list" | "task"): Promise<Done<{ requestId: string }>>;
  /** The owner sets a quantity, changes the supplier, or cancels (each logged as an event with the reason). */
  changeStockRequest(id: string, change: { fixedQty: number } | { supplierId: string | null } | { cancel: string }, by: string): Promise<Done>;

  /** Counts at a kitchen from a time, newest first (with who counted): its production list, or one supplier's products. */
  stockCounts(siteId: SiteId, since: number, supplierId?: string): Promise<StockCount[]>;
  /** Adds a count (counts are never changed: a recount is another one). */
  addStockCount(c: Omit<StockCount, "id" | "createdAt" | "countedByName">): Promise<StockCount>;
  /** The target in use for each product at a kitchen (the latest set; none if it was taken off). */
  stockTargets(siteId: SiteId): Promise<StockTarget[]>;
  /** Adds a target record for each of these (already checked and only the changed ones). Returns how many. */
  setStockTargets(siteId: SiteId, targets: { productId: string; qty?: number }[], by: string): Promise<number>;

  /** Where suppliers deliver, when it's a production kitchen rather than each restaurant (shown on the order sheet). */
  supplierDelivers(): Promise<{ supplierId: string; deliversTo?: SiteId }[]>;
}
