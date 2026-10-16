import { notFound } from "next/navigation";
import { store } from "@/lib/data";
import { canPurchase, canSeeTask, methodOf, onProductionTeam, orderSummary, productLabel, TASK_LABEL, taskCode, taskLines, taskState } from "@/lib/domain/stock";
import { londonDate, londonHM, shortDay } from "@/lib/domain/time";
import { StockBar, StockNav } from "../../Bar";
import { stockCtx } from "../../load";
import { TaskView, type TaskLineItem } from "./TaskView";

export const dynamic = "force-dynamic";

/** One task: its lines with what to record, its log, and the owner's controls. */
export default async function TaskPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const { ctx, onPhone, can } = await stockCtx();
  const db = store();
  const d = await db.stockTask(id);
  const t = d?.tasks.find((x) => x.id === id);
  if (!d || !t) notFound();
  const [{ suppliers, products }, sites, people, purchasers] = await Promise.all([db.stockCatalog(), db.sites(), db.people(), db.purchaserIds()]);
  const sup = suppliers.find((s) => s.id === t.supplierId);
  if (!canSeeTask(ctx.person, t, sup)) notFound();
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  const views = taskLines(t, d.lines, d.requests, d.events);
  const state = taskState(t, d.lines, d.events);
  const lines: TaskLineItem[] = views.map((v) => {
    const p = products.find((x) => x.id === v.request.productId);
    return {
      id: v.line.id, requestId: v.request.id, product: p ? productLabel(p) : "?", link: p?.link, site: siteName.get(v.request.siteId) ?? v.request.siteId, qty: v.line.qty,
      note: v.request.note, end: v.end ? { kind: v.end.kind, qty: v.end.qty, text: v.end.event.text, ref: v.end.event.ref } : undefined, picked: v.picked, packed: v.packed,
      substitute: v.substitute?.text, substituteAnswer: v.substituteAnswer ? { ok: v.substituteAnswer.kind === "substitute_ok", text: v.substituteAnswer.text } : undefined,
    };
  });
  const isMine = t.assigneeId === ctx.person.id || t.driverId === ctx.person.id || (t.method === "production" && !!sup?.siteId && onProductionTeam(ctx.person, sup.siteId));
  const log = d.events.filter((e) => e.taskId === t.id).map((e) => ({
    at: `${shortDay(londonDate(e.at))} ${londonHM(e.at)}`, who: e.byName ?? "", kind: e.kind, qty: e.qty, pence: can.purchasing || isMine ? e.pence : undefined,
    text: e.text, ref: e.ref, on: e.on, mediaId: e.mediaId,
    product: e.lineId ? lines.find((l) => l.id === e.lineId)?.product : undefined,
  })).reverse();
  const people2 = people.filter((p) => canPurchase({ ...p, purchaser: purchasers.includes(p.id) }) || (t.method === "production" && sup?.siteId && onProductionTeam(p, sup.siteId))).map((p) => ({ id: p.id, name: p.name }));

  return (
    <>
      <StockBar ctx={ctx} onPhone={onPhone} title={`${sup?.name ?? "Task"}`} eyebrow={`${taskCode(t)} · ${methodOf(t.method)?.label}${t.destination ? ` → ${siteName.get(t.destination)}` : ""}`}
        back={can.purchasing ? "/stock/purchasing" : t.method === "production" && !isMineAs(t, ctx.person.id) ? "/stock/production" : "/stock/tasks"} />
      <TaskView
        task={{ id: t.id, code: taskCode(t), method: t.method, state: TASK_LABEL[state], cancelled: !!t.cancelledAt, cancelReason: t.cancelReason, requiredBy: t.requiredBy, priority: t.priority, note: t.note,
          assigneeId: t.assigneeId, assigneeName: t.assigneeName, driverId: t.driverId, driverName: t.driverName, link: sup?.link, supplierNote: sup?.note,
          acknowledged: d.events.some((e) => e.taskId === t.id && e.kind === "acknowledged"), ordered: d.events.find((e) => e.taskId === t.id && e.kind === "ordered")?.ref ?? (d.events.some((e) => e.taskId === t.id && e.kind === "ordered") ? "" : undefined) }}
        lines={lines} log={log} summary={orderSummary(t, views, products, sup, siteName)}
        me={{ owner: can.purchasing, assignee: t.assigneeId === ctx.person.id, driver: t.driverId === ctx.person.id, team: t.method === "production" && isMine }}
        people={people2} />
      <StockNav ctx={ctx} onPhone={onPhone} />
    </>
  );
}

const isMineAs = (t: { assigneeId?: string; driverId?: string }, id: string) => t.assigneeId === id || t.driverId === id;
