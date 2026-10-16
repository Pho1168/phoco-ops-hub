import { store } from "@/lib/data";
import { buyFrom, lineEnd } from "@/lib/domain/stock";
import { londonDate, shortDay } from "@/lib/domain/time";
import { stockView } from "@/lib/stock-service";
import { StockBar, StockNav } from "../Bar";
import { stockCtx } from "../load";
import { DriverList, type DriverStop } from "./DriverList";

export const dynamic = "force-dynamic";

/** My shopping list: the shop runs given to me, one card per shop, each item with where it goes. Tick when bought (today's finished lists stay). */
export default async function MyShopping() {
  const { ctx, onPhone } = await stockCtx();
  const db = store();
  const now = Date.now();
  const [{ catalog, data }, sites] = await Promise.all([stockView(db, now), db.sites()]);
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  const mine = data.tasks.filter((t) => !t.cancelledAt && t.method !== "production" && (t.assigneeId === ctx.person.id || t.driverId === ctx.person.id));
  const stops: DriverStop[] = [];
  for (const t of mine.sort((a, b) => a.createdAt - b.createdAt)) {
    // Lines taken off (the request was cancelled) aren't the driver's any more.
    const lines = data.lines.filter((l) => l.taskId === t.id && lineEnd(l, data.events)?.kind !== "line_cancelled");
    const open = lines.filter((l) => !lineEnd(l, data.events));
    // Finished lists stay until the end of the day they were given, so the driver sees they're done.
    if (!lines.length || (!open.length && londonDate(t.createdAt) !== londonDate(now))) continue;
    const sup = catalog.suppliers.find((s) => s.id === t.supplierId);
    stops.push({
      taskId: t.id, shop: sup?.name ?? "Shopping", note: t.note,
      items: lines.map((l) => {
        const r = data.requests.find((x) => x.id === l.requestId);
        const p = r && catalog.products.find((x) => x.id === r.productId);
        const end = lineEnd(l, data.events);
        return { lineId: l.id, qty: l.qty, name: p?.name ?? "?", pack: p?.size, to: r ? siteName.get(r.siteId) ?? r.siteId : "", note: r?.note,
          end: end ? (end.kind === "unavailable" ? "missing" as const : "got" as const) : undefined,
          boughtAt: end?.kind === "bought" && end.event.text?.startsWith("Bought at ") ? end.event.text.slice(10) : undefined,
          alsoAt: p ? buyFrom(p, catalog.suppliers).filter((x) => x.id !== t.supplierId).map((x) => ({ id: x.id, name: x.name })) : [] };
      }),
    });
  }
  const first = ctx.person.name.split(" ")[0];
  return (
    <>
      <StockBar ctx={ctx} onPhone={onPhone} title="My shopping list" back="/stock" eyebrow={`${first} · ${shortDay(londonDate(now))}`} />
      <main className="stack">
        {stops.length
          ? <DriverList stops={stops} />
          : <div className="card muted">Nothing for you right now. When the owner or operations manager gives you a shopping run, it shows here.</div>}
      </main>
      <StockNav ctx={ctx} onPhone={onPhone} />
    </>
  );
}
