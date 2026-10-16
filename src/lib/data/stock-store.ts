import type { DraftLine, Price, Product, PurchaseTask, Receipt, StockEvent, StockReport, StockRequest, Supplier, TaskLine } from "@/lib/domain/stock";
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
  saveProduct(id: string | undefined, p: Pick<Product, "name" | "size" | "category" | "supplierId" | "link">, active: boolean): Promise<string | false>;
  addPrice(p: Price, by: string): Promise<void>;
  purchaserIds(): Promise<string[]>;
  setPurchaser(personId: string, on: boolean): Promise<void>;
  setSiteStockReminder(siteId: SiteId, on: boolean): Promise<void>;

  /** The person's unsent report at the site, if any. */
  stockDraft(siteId: SiteId, personId: string): Promise<StockReport | undefined>;
  saveStockDraft(siteId: SiteId, personId: string, date: string, lines: DraftLine[], noIssues: boolean): Promise<StockReport>;
  /** Sent reports at these sites from a time, newest first. */
  stockReports(siteIds: SiteId[], since: number): Promise<StockReport[]>;
  /**
   * Sends the draft, once, with these (checked) lines. Planned inside the transaction with the site's requests for
   * those products locked (`planSubmit`), so two people sending at once never make two requests for one need. False
   * if it was already sent (a second tap, another tab).
   */
  submitStockReport(reportId: string, by: string, lines: DraftLine[], products: Pick<Product, "id" | "supplierId">[]): Promise<{ created: StockRequest[]; again: number } | false>;

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
  /** The owner sets a quantity, changes the supplier, or cancels (each logged as an event with the reason). */
  changeStockRequest(id: string, change: { fixedQty: number } | { supplierId: string | null } | { cancel: string }, by: string): Promise<Done>;

  /** Production counts at a kitchen from a time, newest first (with who counted). */
  stockCounts(siteId: SiteId, since: number): Promise<StockCount[]>;
  /** Adds a count (counts are never changed: a recount is another one). */
  addStockCount(c: Omit<StockCount, "id" | "createdAt" | "countedByName">): Promise<StockCount>;
  /** The target in use for each product at a kitchen (the latest set; none if it was taken off). */
  stockTargets(siteId: SiteId): Promise<StockTarget[]>;
  /** Adds a target record for each of these (already checked and only the changed ones). Returns how many. */
  setStockTargets(siteId: SiteId, targets: { productId: string; qty?: number }[], by: string): Promise<number>;
}
