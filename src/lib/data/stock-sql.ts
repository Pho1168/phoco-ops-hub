import type postgres from "postgres";
import { checkLineEnd, checkReceipt, checkTaskLines, canCancelRequest, canChangeSupplier, laterReportNote, lineEnd, onTopNote, planOnTop, planSubmit, progress, reqCode, shortOf, TERMINAL, withProgress,
  type DraftLine, type EventKind, type NewItem, type NewItemLine, type Price, type Product, type PurchaseTask, type Receipt, type StockEvent, type StockReport, type StockRequest, type Supplier, type TaskLine } from "@/lib/domain/stock";
import type { CountLine, StockCount } from "@/lib/domain/stock-count";
import { londonDate } from "@/lib/domain/time";
import { sql, withTx } from "./pg";
import type { StockData, StockStore } from "./stock-store";

/** Postgres implementation of the stock records (migration 0033). */

type Q = postgres.Sql | postgres.ReservedSql;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const opt = <T,>(v: T | null) => (v === null ? undefined : v);
const num = (v: string | number | null) => (v === null ? undefined : Number(v));
const day = (d: Date | string | null) => (d === null ? undefined : typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

interface SupplierRow { id: string; name: string; method: Supplier["method"]; site_id: string | null; note: string | null; link: string | null; active: boolean; delivery_days: number[] | null; brand: string }
const toSupplier = (r: SupplierRow): Supplier => ({ id: r.id, name: r.name, method: r.method, brand: r.brand === "clv" ? "clv" : "phoco", siteId: opt(r.site_id), note: opt(r.note), link: opt(r.link), active: r.active,
  ...(r.delivery_days?.length ? { deliveryDays: r.delivery_days.map(Number) } : {}) });
interface ProductRow { id: string; name: string; size: string | null; category: string | null; supplier_id: string | null; active: boolean; link: string | null; import_name: string | null; for_restaurants: boolean; also_from: string[] | null; copy_of: string | null; brand: string }
const toProduct = (r: ProductRow): Product => ({ id: r.id, name: r.name, brand: r.brand === "clv" ? "clv" : "phoco", size: opt(r.size), category: opt(r.category), supplierId: opt(r.supplier_id), active: r.active, link: opt(r.link), importName: opt(r.import_name),
  ...(r.for_restaurants === false ? { forRestaurants: false } : {}), ...(r.also_from?.length ? { alsoFrom: r.also_from } : {}), ...(r.copy_of ? { copyOf: r.copy_of } : {}) });

interface ReportRow { id: string; site_id: string; person_id: string; person_name: string | null; business_date: string; lines: DraftLine[]; no_issues: boolean; submitted_at: Date | null; updated_at: Date; extras: NewItemLine[] | null }
const toReport = (r: ReportRow): StockReport => ({ id: r.id, siteId: r.site_id, personId: r.person_id, personName: opt(r.person_name), date: day(r.business_date)!, lines: r.lines ?? [], noIssues: r.no_issues, submittedAt: r.submitted_at?.getTime(), updatedAt: r.updated_at.getTime(), extras: r.extras ?? [] });
const reportSelect = (q: Q) => q`select r.id, r.site_id, r.person_id, p.display_name as person_name, to_char(r.business_date, 'YYYY-MM-DD') as business_date, r.lines, r.no_issues, r.submitted_at, r.updated_at, r.extras
  from stock_reports r left join people p on p.id = r.person_id`;
interface NewItemRow { id: string; site_id: string; report_id: string | null; name: string; size: string | null; qty: string; note: string | null; requested_by: string; requested_by_name: string | null;
  created_at: Date; decided_at: Date | null; decided_by: string | null; product_id: string | null; request_id: string | null; dismissed: string | null }
const toNewItem = (r: NewItemRow): NewItem => ({ id: r.id, siteId: r.site_id, reportId: opt(r.report_id), name: r.name, size: opt(r.size), qty: Number(r.qty), note: opt(r.note),
  requestedBy: r.requested_by, requestedByName: opt(r.requested_by_name), createdAt: r.created_at.getTime(), decidedAt: r.decided_at?.getTime(), decidedBy: opt(r.decided_by),
  productId: opt(r.product_id), requestId: opt(r.request_id), dismissed: opt(r.dismissed) });
const newItemSelect = (q: Q) => q`select n.id, n.site_id, n.report_id, n.name, n.size, n.qty::text, n.note, n.requested_by, p.display_name as requested_by_name, n.created_at,
  n.decided_at, n.decided_by, n.product_id, n.request_id, n.dismissed from stock_new_items n left join people p on p.id = n.requested_by`;

interface CountRow { id: string; site_id: string; counted_by: string; counted_by_name: string | null; business_date: string; lines: CountLine[]; note: string | null; created_at: Date; supplier_id: string | null }
const toCount = (r: CountRow): StockCount => ({ id: r.id, siteId: r.site_id, countedBy: r.counted_by, countedByName: opt(r.counted_by_name), date: r.business_date,
  lines: (r.lines ?? []).map((l) => ({ productId: l.productId, qty: Number(l.qty) })), note: opt(r.note), createdAt: r.created_at.getTime(), ...(r.supplier_id ? { supplierId: r.supplier_id } : {}) });
const countSelect = (q: Q) => q`select c.id, c.site_id, c.counted_by, p.display_name as counted_by_name, to_char(c.business_date, 'YYYY-MM-DD') as business_date, c.lines, c.note, c.created_at, c.supplier_id
  from stock_counts c left join people p on p.id = c.counted_by`;
interface TargetRow { site_id: string; product_id: string; qty: string | null; set_by: string; set_by_name: string | null; set_at: Date }

interface RequestRow { id: string; code: number; site_id: string; product_id: string; level: "low" | "out"; qty: string | null; fixed_qty: string | null; note: string | null; photo_id: string | null; report_id: string | null;
  requested_by: string; requested_by_name: string | null; supplier_id: string | null; created_at: Date; cancelled_at: Date | null; cancel_reason: string | null; reopens_line: string | null }
const toRequest = (r: RequestRow): StockRequest => ({ id: r.id, code: r.code, siteId: r.site_id, productId: r.product_id, level: r.level, qty: num(r.qty), fixedQty: num(r.fixed_qty), note: opt(r.note), photoId: opt(r.photo_id),
  reportId: opt(r.report_id), requestedBy: r.requested_by, requestedByName: opt(r.requested_by_name), supplierId: opt(r.supplier_id), createdAt: r.created_at.getTime(), cancelledAt: r.cancelled_at?.getTime(), cancelReason: opt(r.cancel_reason),
  ...(r.reopens_line ? { reopensLine: r.reopens_line } : {}) });
const requestSelect = (q: Q) => q`select r.id, r.code, r.site_id, r.product_id, r.level, r.qty::text, r.fixed_qty::text, r.note, r.photo_id, r.report_id, r.requested_by, p.display_name as requested_by_name,
  r.supplier_id, r.created_at, r.cancelled_at, r.cancel_reason, r.reopens_line from stock_requests r left join people p on p.id = r.requested_by`;

interface TaskRow { id: string; code: number; supplier_id: string | null; method: PurchaseTask["method"]; assignee_id: string | null; assignee_name: string | null; driver_id: string | null; driver_name: string | null;
  required_by: string | null; priority: PurchaseTask["priority"]; note: string | null; destination: string | null; created_by: string; created_at: Date; cancelled_at: Date | null; cancel_reason: string | null;
  round_at: Date | null }
const toTask = (r: TaskRow): PurchaseTask => ({ id: r.id, code: r.code, supplierId: opt(r.supplier_id), method: r.method, assigneeId: opt(r.assignee_id), assigneeName: opt(r.assignee_name), driverId: opt(r.driver_id),
  driverName: opt(r.driver_name), requiredBy: opt(r.required_by), priority: r.priority, note: opt(r.note), destination: opt(r.destination), createdBy: r.created_by, createdAt: r.created_at.getTime(),
  cancelledAt: r.cancelled_at?.getTime(), cancelReason: opt(r.cancel_reason), ...(r.round_at ? { roundAt: r.round_at.getTime() } : {}) });
const taskSelect = (q: Q) => q`select t.id, t.code, t.supplier_id, t.method, t.assignee_id, a.display_name as assignee_name, t.driver_id, d.display_name as driver_name,
  to_char(t.required_by, 'YYYY-MM-DD') as required_by, t.priority, t.note, t.destination, t.created_by, t.created_at, t.cancelled_at, t.cancel_reason, t.round_at
  from stock_tasks t left join people a on a.id = t.assignee_id left join people d on d.id = t.driver_id`;

interface LineRow { id: string; task_id: string; request_id: string; qty: string; redoes?: string | null }
const toLine = (r: LineRow): TaskLine => ({ id: r.id, taskId: r.task_id, requestId: r.request_id, qty: Number(r.qty), ...(r.redoes ? { redoes: r.redoes } : {}) });
interface EventRow { id: string; at: Date; by: string; by_name: string | null; kind: EventKind; task_id: string | null; line_id: string | null; request_id: string | null; qty: string | null; pence: number | null;
  text: string | null; media_id: string | null; ref: string | null; on_date: string | null }
const toEvent = (r: EventRow): StockEvent => ({ id: r.id, at: r.at.getTime(), by: r.by, byName: opt(r.by_name), kind: r.kind, taskId: opt(r.task_id), lineId: opt(r.line_id), requestId: opt(r.request_id),
  qty: num(r.qty), pence: opt(r.pence), text: opt(r.text), mediaId: opt(r.media_id), ref: opt(r.ref), on: opt(r.on_date) });
interface ReceiptRow { id: string; request_id: string; qty: string; by: string; by_name: string | null; at: Date; note: string | null }
const toReceipt = (r: ReceiptRow): Receipt => ({ id: r.id, requestId: r.request_id, qty: Number(r.qty), by: r.by, byName: opt(r.by_name), at: r.at.getTime(), note: opt(r.note) });

/** Everything about these requests and tasks: the lines of either, the other side of those lines, events, receipts. */
async function gather(q: Q, requestIds: string[], taskIds: string[]): Promise<StockData> {
  const lines = (await q<LineRow[]>`select id, task_id, request_id, qty::text, redoes from stock_task_lines
    where request_id = any(${requestIds}::uuid[]) or task_id = any(${taskIds}::uuid[])`).map(toLine);
  const reqIds = [...new Set([...requestIds, ...lines.map((l) => l.requestId)])];
  const tIds = [...new Set([...taskIds, ...lines.map((l) => l.taskId)])];
  const [requests, tasks, events, receipts] = [
    (await q<RequestRow[]>`${requestSelect(q)} where r.id = any(${reqIds}::uuid[]) order by r.created_at desc`).map(toRequest),
    (await q<TaskRow[]>`${taskSelect(q)} where t.id = any(${tIds}::uuid[]) order by t.created_at desc`).map(toTask),
    (await q<EventRow[]>`select e.id, e.at, e.by, p.display_name as by_name, e.kind, e.task_id, e.line_id, e.request_id, e.qty::text, e.pence, e.text, e.media_id, e.ref,
        to_char(e.on_date, 'YYYY-MM-DD') as on_date
      from stock_events e left join people p on p.id = e.by
      where e.request_id = any(${reqIds}::uuid[]) or e.task_id = any(${tIds}::uuid[]) order by e.at`).map(toEvent),
    (await q<ReceiptRow[]>`select x.id, x.request_id, x.qty::text, x.by, p.display_name as by_name, x.at, x.note from stock_receipts x left join people p on p.id = x.by
      where x.request_id = any(${reqIds}::uuid[]) order by x.at`).map(toReceipt),
  ];
  return { requests, tasks, lines, events, receipts };
}

/** Locks the requests (in a stable order, so two writers never wait on each other) and loads them with their history. */
async function lockRequests(tx: postgres.ReservedSql, ids: string[]): Promise<StockData> {
  const sorted = [...new Set(ids)].filter((id) => UUID.test(id)).sort();
  if (sorted.length) await tx`select id from stock_requests where id = any(${sorted}::uuid[]) order by id for update`;
  return gather(tx, sorted, []);
}

export const stockSql: StockStore = {
  async stockCatalog() {
    const q = sql();
    const suppliers = (await q<SupplierRow[]>`select id, name, method, site_id, note, link, active, delivery_days, brand from stock_suppliers order by lower(name)`).map(toSupplier);
    const products = (await q<ProductRow[]>`select id, name, size, category, supplier_id, active, link, import_name, for_restaurants, also_from, copy_of, brand from stock_products order by lower(name), lower(coalesce(size, '')), position`).map(toProduct);
    const prices = (await q<{ product_id: string; pence: number; on_date: string; note: string | null }[]>`
      select product_id, pence, to_char(on_date, 'YYYY-MM-DD') as on_date, note from stock_prices order by on_date desc, created_at desc`)
      .map((r): Price => ({ productId: r.product_id, pence: r.pence, on: r.on_date, note: opt(r.note) }));
    return { suppliers, products, prices };
  },
  async saveSupplier(id, s, active) {
    const q = sql();
    if (id && UUID.test(id)) {
      await q`update stock_suppliers set name = ${s.name}, method = ${s.method}, site_id = ${s.siteId ?? null}, note = ${s.note ?? null}, link = ${s.link ?? null}, active = ${active} where id = ${id}`;
      return id;
    }
    const [r] = await q<{ id: string }[]>`insert into stock_suppliers (name, method, site_id, note, link, active, brand) values (${s.name}, ${s.method}, ${s.siteId ?? null}, ${s.note ?? null}, ${s.link ?? null}, ${active}, ${s.brand ?? "phoco"}) returning id`;
    return r.id;
  },
  async saveProduct(id, p, active) {
    const q = sql();
    try {
      if (id && UUID.test(id)) {
        await q`update stock_products set name = ${p.name}, size = ${p.size ?? null}, category = ${p.category ?? null}, supplier_id = ${p.supplierId ?? null}, link = ${p.link ?? null}, active = ${active},
          for_restaurants = ${p.forRestaurants !== false} ${p.alsoFrom ? q`, also_from = ${p.alsoFrom}::uuid[]` : q``} where id = ${id}`;
        return id;
      }
      const [r] = await q<{ id: string }[]>`insert into stock_products (brand, name, size, category, supplier_id, link, active, for_restaurants, also_from, position)
        values (${p.brand ?? "phoco"}, ${p.name}, ${p.size ?? null}, ${p.category ?? null}, ${p.supplierId ?? null}, ${p.link ?? null}, ${active}, ${p.forRestaurants !== false}, ${p.alsoFrom ?? []}::uuid[], (select coalesce(max(position), 0) + 1 from stock_products)) returning id`;
      return r.id;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") return false;
      throw e;
    }
  },
  async addPrice(p, by) {
    await sql()`insert into stock_prices (product_id, pence, on_date, note, created_by) values (${p.productId}, ${p.pence}, ${p.on}, ${p.note ?? null}, ${by})`;
  },
  async purchaserIds() {
    return (await sql()<{ id: string }[]>`select id from people where purchaser and status = 'active'`).map((r) => r.id);
  },
  async setPurchaser(personId, on) {
    if (!UUID.test(personId)) return;
    await sql()`update people set purchaser = ${on} where id = ${personId}`;
  },
  async setSiteStockReminder(siteId, on) {
    await sql()`update sites set stock_reminder = ${on} where id = ${siteId}`;
  },

  async stockDraft(siteId, personId) {
    if (!UUID.test(personId)) return undefined;
    const q = sql();
    const [r] = await q<ReportRow[]>`${reportSelect(q)} where r.site_id = ${siteId} and r.person_id = ${personId} and r.submitted_at is null`;
    return r ? toReport(r) : undefined;
  },
  async saveStockDraft(siteId, personId, date, lines, noIssues, extras) {
    const q = sql();
    const ex = q.json((extras ?? []) as unknown as postgres.JSONValue);
    const [r] = await q<{ id: string }[]>`
      insert into stock_reports (site_id, person_id, business_date, lines, no_issues, extras) values (${siteId}, ${personId}, ${date}, ${q.json(lines as unknown as postgres.JSONValue)}, ${noIssues}, ${ex})
      on conflict (site_id, person_id) where submitted_at is null
      do update set lines = excluded.lines, no_issues = excluded.no_issues, business_date = excluded.business_date, updated_at = now()
        ${extras ? q`, extras = excluded.extras` : q``}
      returning id`;
    const [row] = await q<ReportRow[]>`${reportSelect(q)} where r.id = ${r.id}`;
    return toReport(row);
  },
  async stockReports(siteIds, since) {
    if (!siteIds.length) return [];
    const q = sql();
    return (await q<ReportRow[]>`${reportSelect(q)} where r.site_id = any(${siteIds}::text[]) and r.submitted_at >= ${new Date(since)} order by r.submitted_at desc limit 500`).map(toReport);
  },
  async submitStockReport(reportId, by, lines, products, extras = []) {
    if (!UUID.test(reportId)) return false;
    return withTx(async (tx) => {
      const [rep] = await tx<{ site_id: string }[]>`update stock_reports set submitted_at = now(), updated_at = now() where id = ${reportId} and submitted_at is null returning site_id`;
      if (!rep) return false;
      // One sender at a time per site: what's already asked for is read after the others have finished.
      await tx`select pg_advisory_xact_lock(hashtext(${"stock-report:" + rep.site_id}))`;
      const ids = (await tx<{ id: string }[]>`select id from stock_requests where site_id = ${rep.site_id} and cancelled_at is null
        and product_id = any(${lines.map((l) => l.productId)}::uuid[])`).map((r) => r.id);
      const plan = planSubmit(lines, rep.site_id, withProgress(await gather(tx, ids, [])), products);
      const made: string[] = [];
      for (const l of plan.create) {
        const [r] = await tx<{ id: string }[]>`insert into stock_requests (site_id, product_id, level, qty, note, photo_id, report_id, requested_by, supplier_id)
          values (${rep.site_id}, ${l.productId}, ${l.level}, ${l.qty ?? null}, ${l.note ?? null}, ${l.photoId ?? null}, ${reportId}, ${by}, ${l.supplierId ?? null}) returning id`;
        made.push(r.id);
      }
      for (const a of plan.again) {
        await tx`insert into stock_events (by, kind, request_id, qty, text, media_id) values (${by}, 'reported_again', ${a.requestId}, ${a.line.qty ?? null}, ${a.line.level}, ${a.line.photoId ?? null})`;
        if (a.line.note) await tx`insert into stock_events (by, kind, request_id, text) values (${by}, 'note', ${a.requestId}, ${a.line.note})`;
        if (a.setQty !== undefined) {
          await tx`update stock_requests set fixed_qty = ${a.setQty} where id = ${a.requestId}`;
          await tx`insert into stock_events (by, kind, request_id, qty, text) values (${by}, 'qty_changed', ${a.requestId}, ${a.setQty}, ${laterReportNote(a.was)})`;
        }
      }
      const created = (await tx<RequestRow[]>`${requestSelect(tx)} where r.id = any(${made}::uuid[]) order by r.code`).map(toRequest);
      const newIds: string[] = [];
      for (const x of extras) {
        if (x.qty === undefined) continue;
        const [n] = await tx<{ id: string }[]>`insert into stock_new_items (site_id, report_id, name, size, qty, note, requested_by)
          values (${rep.site_id}, ${reportId}, ${x.name}, ${x.size ?? null}, ${x.qty}, ${x.note ?? null}, ${by}) returning id`;
        newIds.push(n.id);
      }
      const newItems = newIds.length ? (await tx<NewItemRow[]>`${newItemSelect(tx)} where n.id = any(${newIds}::uuid[]) order by n.created_at`).map(toNewItem) : [];
      return { created, again: plan.again.length, newItems };
    });
  },

  async addOnTop(siteId, by, lines, products) {
    return withTx(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${"stock-report:" + siteId}))`;
      const ids = (await tx<{ id: string }[]>`select id from stock_requests where site_id = ${siteId} and cancelled_at is null
        and product_id = any(${lines.map((l) => l.productId)}::uuid[])`).map((r) => r.id);
      const plan = planOnTop(lines, siteId, withProgress(await lockRequests(tx, ids)), products);
      const made: string[] = [];
      for (const l of plan.create) {
        const [r] = await tx<{ id: string }[]>`insert into stock_requests (site_id, product_id, level, qty, requested_by, supplier_id)
          values (${siteId}, ${l.productId}, 'low', ${l.qty}, ${by}, ${l.supplierId ?? null}) returning id`;
        made.push(r.id);
      }
      for (const b of plan.bump) {
        await tx`update stock_requests set fixed_qty = ${b.to} where id = ${b.requestId}`;
        await tx`insert into stock_events (by, kind, request_id, qty, text) values (${by}, 'qty_changed', ${b.requestId}, ${b.to}, ${onTopNote(b.add, b.was)})`;
      }
      const created = made.length ? (await tx<RequestRow[]>`${requestSelect(tx)} where r.id = any(${made}::uuid[]) order by r.code`).map(toRequest) : [];
      return { created, raised: plan.bump };
    });
  },

  async stockNewItems(f) {
    const q = sql();
    return (await q<NewItemRow[]>`${newItemSelect(q)} where true
      ${f.open ? q`and n.decided_at is null` : q``}
      ${f.since !== undefined ? q`and (n.created_at >= ${new Date(f.since)} or n.decided_at is null)` : q``}
      ${f.siteIds ? q`and n.site_id = any(${f.siteIds}::text[])` : q``}
      order by n.created_at limit 500`).map(toNewItem);
  },
  async decideNewItem(id, by, d) {
    if (!UUID.test(id)) return { ok: false, error: "That new item isn't there" };
    return withTx(async (tx) => {
      const [n] = await tx<{ site_id: string; report_id: string | null; qty: string; note: string | null; requested_by: string; decided_at: Date | null }[]>`
        select site_id, report_id, qty::text, note, requested_by, decided_at from stock_new_items where id = ${id} for update`;
      if (!n) return { ok: false as const, error: "That new item isn't there" };
      if (n.decided_at) return { ok: false as const, error: "That new item has already been dealt with" };
      if ("dismiss" in d) {
        await tx`update stock_new_items set decided_at = now(), decided_by = ${by}, dismissed = ${d.dismiss} where id = ${id}`;
        return { ok: true as const, value: {} };
      }
      const [r] = await tx<{ id: string }[]>`insert into stock_requests (site_id, product_id, level, qty, note, report_id, requested_by, supplier_id)
        values (${n.site_id}, ${d.productId}, 'low', ${d.qty}, ${n.note}, ${n.report_id}, ${n.requested_by}, ${d.supplierId ?? null}) returning id`;
      await tx`insert into stock_events (by, kind, request_id, text) values (${by}, 'note', ${r.id}, ${"New item, added to the catalogue"})`;
      await tx`update stock_new_items set decided_at = now(), decided_by = ${by}, product_id = ${d.productId}, request_id = ${r.id} where id = ${id}`;
      const [req] = (await tx<RequestRow[]>`${requestSelect(tx)} where r.id = ${r.id}`).map(toRequest);
      return { ok: true as const, value: { request: req } };
    });
  },

  async stockData(f) {
    const q = sql();
    const since = new Date(f.since);
    // Made since then, or still in hand however old (not cancelled, and not yet received in full).
    const reqIds = (await q<{ id: string }[]>`select r.id from stock_requests r
      where (r.created_at >= ${since} or (r.cancelled_at is null and (coalesce(r.fixed_qty, r.qty) is null
        or coalesce((select sum(x.qty) from stock_receipts x where x.request_id = r.id), 0) < coalesce(r.fixed_qty, r.qty))))
      ${f.siteIds ? q`and r.site_id = any(${f.siteIds}::text[])` : q``}`).map((r) => r.id);
    const taskIds = f.siteIds ? [] : (await q<{ id: string }[]>`select id from stock_tasks where created_at >= ${since}`).map((r) => r.id);
    const d = await gather(q, reqIds, taskIds);
    if (!f.siteIds) return d;
    // At some sites only: tasks keep just the lines (and events) for those sites' requests.
    const mine = new Set(d.requests.filter((r) => f.siteIds!.includes(r.siteId)).map((r) => r.id));
    const lines = d.lines.filter((l) => mine.has(l.requestId));
    const lineIds = new Set(lines.map((l) => l.id));
    return { requests: d.requests.filter((r) => mine.has(r.id)), tasks: d.tasks.filter((t) => lines.some((l) => l.taskId === t.id)), lines,
      events: d.events.filter((e) => (e.requestId && mine.has(e.requestId)) || (e.lineId && lineIds.has(e.lineId)) || (!e.lineId && !e.requestId && e.taskId && lines.some((l) => l.taskId === e.taskId))),
      receipts: d.receipts.filter((x) => mine.has(x.requestId)) };
  },
  async stockTask(taskId) {
    if (!UUID.test(taskId)) return undefined;
    const d = await gather(sql(), [], [taskId]);
    return d.tasks.some((t) => t.id === taskId) ? d : undefined;
  },

  async createStockTask(t, lines) {
    return withTx(async (tx) => {
      const d = await lockRequests(tx, lines.map((l) => l.requestId));
      const check = checkTaskLines(lines, withProgress(d), t.supplierId, t.method);
      if (!check.ok) return check;
      const [row] = await tx<{ id: string }[]>`insert into stock_tasks (supplier_id, method, assignee_id, driver_id, required_by, priority, note, destination, created_by)
        values (${t.supplierId ?? null}, ${t.method}, ${t.assigneeId ?? null}, ${t.driverId ?? null}, ${t.requiredBy ?? null}, ${t.priority}, ${t.note ?? null}, ${t.destination ?? null}, ${t.createdBy})
        returning id`;
      for (const l of check.value) await tx`insert into stock_task_lines (task_id, request_id, qty) values (${row.id}, ${l.requestId}, ${l.qty})`;
      if (t.assigneeId || t.driverId) await tx`insert into stock_events (by, kind, task_id, text) values (${t.createdBy}, 'assigned', ${row.id}, ${"created"})`;
      return { ok: true as const, value: row.id };
    });
  },
  async addToProductionOrder(supplierId, destination, date, requestIds, by) {
    return withTx(async (tx) => {
      const d = await lockRequests(tx, requestIds);
      const lines = withProgress(d).filter((x) => x.request.siteId === destination && x.request.supplierId === supplierId && x.progress.toPlan > 0)
        .map((x) => ({ requestId: x.request.id, qty: x.progress.toPlan }));
      if (!lines.length) return undefined;
      await tx`select id from stock_suppliers where id = ${supplierId} for update`;
      const [open] = await tx<{ id: string }[]>`select t.id from stock_tasks t where t.method = 'production' and t.supplier_id = ${supplierId} and t.destination = ${destination}
        and t.required_by = ${date} and t.cancelled_at is null
        and not exists (select 1 from stock_task_lines l join stock_events e on e.line_id = l.id and e.kind = any(${[...TERMINAL]}::text[]) where l.task_id = t.id)
        and not exists (select 1 from stock_events e where e.task_id = t.id and e.kind in ('picked', 'packed'))
        order by t.created_at limit 1`;
      const id = open?.id ?? (await tx<{ id: string }[]>`insert into stock_tasks (supplier_id, method, required_by, priority, destination, created_by)
        values (${supplierId}, 'production', ${date}, 'normal', ${destination}, ${by}) returning id`)[0].id;
      for (const l of lines) await tx`insert into stock_task_lines (task_id, request_id, qty) values (${id}, ${l.requestId}, ${l.qty})`;
      return id;
    });
  },
  async orderPlaced(taskId, by, ref, on) {
    if (!UUID.test(taskId)) return { ok: false, error: "That task isn't there" };
    return withTx(async (tx) => {
      const ids = (await tx<{ request_id: string }[]>`select request_id from stock_task_lines where task_id = ${taskId}`).map((r) => r.request_id);
      await lockRequests(tx, ids);
      const [t] = await tx<{ id: string }[]>`select id from stock_tasks where id = ${taskId} and cancelled_at is null for update`;
      if (!t) return { ok: false as const, error: "That task has been cancelled" };
      await tx`insert into stock_events (by, kind, task_id, ref, on_date) values (${by}, 'ordered', ${taskId}, ${ref ?? null}, ${on ?? null})`;
      const open = await tx<{ id: string; request_id: string; qty: string }[]>`select l.id, l.request_id, l.qty::text from stock_task_lines l where l.task_id = ${taskId}
        and not exists (select 1 from stock_events e where e.line_id = l.id and e.kind = any(${[...TERMINAL]}::text[]))`;
      for (const l of open) {
        await tx`insert into stock_events (by, kind, task_id, line_id, request_id, qty, text) values (${by}, 'bought', ${taskId}, ${l.id}, ${l.request_id}, ${l.qty}, ${ref ? `order ${ref}` : "ordered"})`;
      }
      return { ok: true as const, value: undefined };
    });
  },
  async updateStockTask(id, patch, by) {
    if (!UUID.test(id)) return false;
    return withTx(async (tx) => {
      const [t] = await tx<{ assignee_id: string | null; driver_id: string | null }[]>`select assignee_id, driver_id from stock_tasks where id = ${id} and cancelled_at is null for update`;
      if (!t) return false;
      const next = { assignee: "assigneeId" in patch ? patch.assigneeId ?? null : t.assignee_id, driver: "driverId" in patch ? patch.driverId ?? null : t.driver_id };
      await tx`update stock_tasks set assignee_id = ${next.assignee}, driver_id = ${next.driver},
        required_by = ${"requiredBy" in patch ? patch.requiredBy ?? null : tx`required_by`}, priority = ${patch.priority ?? tx`priority`},
        note = ${"note" in patch ? patch.note ?? null : tx`note`} where id = ${id}`;
      if (next.assignee !== t.assignee_id || next.driver !== t.driver_id) await tx`insert into stock_events (by, kind, task_id, text) values (${by}, 'assigned', ${id}, ${"changed"})`;
      return true;
    });
  },
  async cancelStockTask(id, by, reason) {
    if (!UUID.test(id)) return false;
    return withTx(async (tx) => {
      await lockRequests(tx, (await tx<{ request_id: string }[]>`select request_id from stock_task_lines where task_id = ${id}`).map((r) => r.request_id));
      const [t] = await tx<{ id: string }[]>`select id from stock_tasks where id = ${id} and cancelled_at is null for update`;
      if (!t) return false;
      const open = await tx<{ id: string; request_id: string }[]>`select l.id, l.request_id from stock_task_lines l where l.task_id = ${id}
        and not exists (select 1 from stock_events e where e.line_id = l.id and e.kind = any(${[...TERMINAL]}::text[]))`;
      for (const l of open) await tx`insert into stock_events (by, kind, task_id, line_id, request_id, text) values (${by}, 'line_cancelled', ${id}, ${l.id}, ${l.request_id}, ${reason})`;
      await tx`insert into stock_events (by, kind, task_id, text) values (${by}, 'task_cancelled', ${id}, ${reason})`;
      await tx`update stock_tasks set cancelled_at = now(), cancelled_by = ${by}, cancel_reason = ${reason} where id = ${id}`;
      return true;
    });
  },
  async addStockEvent(e) {
    for (const id of [e.lineId, e.taskId, e.requestId, e.mediaId]) if (id !== undefined && !UUID.test(id)) return { ok: false, error: "That isn't there any more" };
    return withTx(async (tx) => {
      if (e.lineId) {
        const [l] = await tx<LineRow[]>`select id, task_id, request_id, qty::text from stock_task_lines where id = ${e.lineId}`;
        if (!l) return { ok: false as const, error: "That line isn't there any more" };
        await tx`select id from stock_requests where id = ${l.request_id} for update`;
        if ((TERMINAL as readonly string[]).includes(e.kind) && e.kind !== "line_cancelled") {
          const events = (await tx<EventRow[]>`select e.id, e.at, e.by, null as by_name, e.kind, e.task_id, e.line_id, e.request_id, e.qty::text, e.pence, e.text, e.media_id, e.ref, null as on_date
            from stock_events e where e.line_id = ${e.lineId}`).map(toEvent);
          const check = checkLineEnd(e.kind as "bought" | "unavailable" | "dispatched", e.qty, toLine(l), events);
          if (!check.ok) return check;
          e = { ...e, qty: check.qty };
        }
        e = { ...e, taskId: l.task_id, requestId: l.request_id };
      }
      try {
        await tx`insert into stock_events (by, kind, task_id, line_id, request_id, qty, pence, text, media_id, ref, on_date)
          values (${e.by}, ${e.kind}, ${e.taskId ?? null}, ${e.lineId ?? null}, ${e.requestId ?? null}, ${e.qty ?? null}, ${e.pence ?? null}, ${e.text ?? null}, ${e.mediaId ?? null}, ${e.ref ?? null}, ${e.on ?? null})`;
      } catch (err) {
        if ((err as { code?: string }).code === "23505") return { ok: false as const, error: "That's already been recorded" };
        if ((err as { code?: string }).code === "23503") return { ok: false as const, error: "That photo or record isn't there any more. Try again" };
        throw err;
      }
      return { ok: true as const, value: undefined };
    });
  },
  async addStockReceipt(requestId, qty, by, note) {
    if (!UUID.test(requestId)) return { ok: false, error: "That request isn't there" };
    return withTx(async (tx) => {
      const d = await lockRequests(tx, [requestId]);
      const r = d.requests.find((x) => x.id === requestId);
      if (!r) return { ok: false as const, error: "That request isn't there" };
      const check = checkReceipt(qty, progress(r, d.lines, d.events, d.receipts, d.tasks));
      if (!check.ok) return check;
      await tx`insert into stock_receipts (request_id, qty, by, note) values (${requestId}, ${check.qty}, ${by}, ${note ?? null})`;
      return { ok: true as const, value: undefined };
    });
  },
  async untickLine(lineId, by, back) {
    if (!UUID.test(lineId)) return { ok: false, error: "That isn't there any more" };
    try {
      return await withTx(async (tx) => {
        const [l] = await tx<LineRow[]>`select id, task_id, request_id, qty::text, redoes from stock_task_lines where id = ${lineId}`;
        if (!l) return { ok: false as const, error: "That isn't there any more" };
        const d = await lockRequests(tx, [l.request_id]);
        const [t] = await tx<{ supplier_id: string | null; cancelled_at: Date | null }[]>`select supplier_id, cancelled_at from stock_tasks where id = ${l.task_id} for update`;
        if (back === "task" && t?.cancelled_at) return { ok: false as const, error: "That list has been taken back" };
        const [again] = await tx`select 1 from stock_requests where reopens_line = ${lineId} union all select 1 from stock_task_lines where redoes = ${lineId} limit 1`;
        if (again) return { ok: false as const, error: "That's already been unticked" };
        const line = toLine(l);
        const end = lineEnd(line, d.events);
        const r = d.requests.find((x) => x.id === l.request_id);
        if (!r || !end || end.kind === "line_cancelled") return { ok: false as const, error: "That isn't ticked" };
        if (end.kind === "unavailable") {
          if (back !== "task") return { ok: false as const, error: "That isn't ticked" };
          const p = progress(r, d.lines, d.events, d.receipts, d.tasks);
          if (r.cancelledAt || p.toPlan < line.qty) return { ok: false as const, error: "It's been ordered or given to someone since, so it stays where it is" };
          await tx`insert into stock_task_lines (task_id, request_id, qty, redoes) values (${l.task_id}, ${r.id}, ${line.qty}, ${lineId})`;
          await tx`insert into stock_events (by, kind, task_id, request_id, text) values (${by}, 'note', ${l.task_id}, ${r.id}, ${"Unticked: back on the list"})`;
          return { ok: true as const, value: { requestId: r.id } };
        }
        const qty = Math.round(Math.max(0, end.qty - shortOf(line, d.events)) * 100) / 100;
        if (!(qty > 0)) return { ok: false as const, error: "That isn't ticked" };
        const [n] = await tx<{ id: string; code: number }[]>`insert into stock_requests (site_id, product_id, level, qty, note, photo_id, report_id, requested_by, supplier_id, reopens_line)
          values (${r.siteId}, ${r.productId}, ${r.level}, ${qty}, ${r.note ?? null}, ${r.photoId ?? null}, ${r.reportId ?? null}, ${r.requestedBy}, ${r.supplierId ?? t?.supplier_id ?? null}, ${lineId})
          returning id, code`;
        await tx`insert into stock_events (by, kind, request_id, text) values (${by}, 'note', ${r.id}, ${`Unticked: back on the list as ${reqCode(n)}`})`;
        await tx`insert into stock_events (by, kind, request_id, text) values (${by}, 'note', ${n.id}, ${`Put back after an untick of ${reqCode(r)}`})`;
        if (back === "task") await tx`insert into stock_task_lines (task_id, request_id, qty, redoes) values (${l.task_id}, ${n.id}, ${qty}, ${lineId})`;
        return { ok: true as const, value: { requestId: n.id } };
      });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") return { ok: false, error: "That's already been unticked" };
      throw err;
    }
  },
  async changeStockRequest(id, change, by) {
    if (!UUID.test(id)) return { ok: false, error: "That request isn't there" };
    return withTx(async (tx) => {
      const d = await lockRequests(tx, [id]);
      const r = d.requests.find((x) => x.id === id);
      if (!r) return { ok: false as const, error: "That request isn't there" };
      const p = progress(r, d.lines, d.events, d.receipts, d.tasks);
      if (p.state === "cancelled") return { ok: false as const, error: "That request is cancelled" };
      if ("fixedQty" in change) {
        const q = Math.round(change.fixedQty * 100) / 100;
        if (!(q > 0) || q > 9999) return { ok: false as const, error: "Give a quantity above 0" };
        if (q < p.planned + p.obtained) return { ok: false as const, error: `${p.planned + p.obtained} is already assigned or bought. Cancel those lines first` };
        await tx`update stock_requests set fixed_qty = ${q} where id = ${id}`;
        await tx`insert into stock_events (by, kind, request_id, qty, text) values (${by}, 'qty_changed', ${id}, ${q}, ${p.wanted === undefined ? "was not sure" : `was ${p.wanted}`})`;
      } else if ("supplierId" in change) {
        if (!canChangeSupplier(p)) return { ok: false as const, error: "Part of it is already assigned or bought. Cancel those lines first" };
        await tx`update stock_requests set supplier_id = ${change.supplierId} where id = ${id}`;
        const [s] = change.supplierId ? await tx<{ name: string }[]>`select name from stock_suppliers where id = ${change.supplierId}` : [];
        await tx`insert into stock_events (by, kind, request_id, text) values (${by}, 'supplier_changed', ${id}, ${s?.name ?? "no supplier"})`;
      } else {
        if (!canCancelRequest(p)) return { ok: false as const, error: "Part of it is already bought. Confirm what arrived, or cancel just what's left" };
        const open = d.lines.filter((l) => l.requestId === id && !d.events.some((e) => e.lineId === l.id && (TERMINAL as readonly string[]).includes(e.kind)));
        for (const l of open) await tx`insert into stock_events (by, kind, task_id, line_id, request_id, text) values (${by}, 'line_cancelled', ${l.taskId}, ${l.id}, ${id}, ${change.cancel})`;
        await tx`insert into stock_events (by, kind, request_id, text) values (${by}, 'request_cancelled', ${id}, ${change.cancel})`;
        await tx`update stock_requests set cancelled_at = now(), cancelled_by = ${by}, cancel_reason = ${change.cancel} where id = ${id}`;
      }
      return { ok: true as const, value: undefined };
    });
  },

  async stockCounts(siteId, since, supplierId) {
    const q = sql();
    if (supplierId !== undefined && !UUID.test(supplierId)) return [];
    const which = supplierId === undefined ? q`c.supplier_id is null` : q`c.supplier_id = ${supplierId}`;
    return (await q<CountRow[]>`${countSelect(q)} where c.site_id = ${siteId} and ${which} and c.created_at >= ${new Date(since)} order by c.created_at desc limit 200`).map(toCount);
  },
  async addStockCount(c) {
    const q = sql();
    const [r] = await q<{ id: string }[]>`insert into stock_counts (site_id, counted_by, business_date, lines, note, supplier_id)
      values (${c.siteId}, ${c.countedBy}, ${c.date}, ${q.json(c.lines as unknown as postgres.JSONValue)}, ${c.note ?? null}, ${c.supplierId ?? null}) returning id`;
    const [row] = await q<CountRow[]>`${countSelect(q)} where c.id = ${r.id}`;
    return toCount(row);
  },
  async stockTargets(siteId) {
    const q = sql();
    const rows = await q<TargetRow[]>`select distinct on (t.product_id) t.site_id, t.product_id, t.qty::text, t.set_by, p.display_name as set_by_name, t.set_at
      from stock_targets t left join people p on p.id = t.set_by where t.site_id = ${siteId} order by t.product_id, t.set_at desc, t.id desc`;
    return rows.map((r) => ({ siteId: r.site_id, productId: r.product_id, qty: num(r.qty), setBy: r.set_by, setByName: opt(r.set_by_name), setAt: r.set_at.getTime() }));
  },
  async setStockTargets(siteId, targets, by) {
    if (!targets.length) return 0;
    return withTx(async (tx) => {
      for (const t of targets) await tx`insert into stock_targets (site_id, product_id, qty, set_by) values (${siteId}, ${t.productId}, ${t.qty ?? null}, ${by})`;
      return targets.length;
    });
  },

  async supplierDelivers() {
    const rows = await sql()<{ supplier_id: string; delivers_to: string | null }[]>`select supplier_id, delivers_to from stock_supplier_orders`;
    return rows.map((r) => ({ supplierId: r.supplier_id, ...(r.delivers_to ? { deliversTo: r.delivers_to } : {}) }));
  },
};

/** Today's London date, for a report's business date. */
export const stockToday = (now = Date.now()) => londonDate(now);
