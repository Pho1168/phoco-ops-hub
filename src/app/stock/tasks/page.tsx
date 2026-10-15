import Link from "next/link";
import { store } from "@/lib/data";
import { lineEnd, methodOf, productLabel, TASK_LABEL, taskCode, taskState } from "@/lib/domain/stock";
import { londonDate, shortDay } from "@/lib/domain/time";
import { stockView } from "@/lib/stock-service";
import { StockBar, StockNav } from "../Bar";
import { qtyText, stockCtx } from "../load";

export const dynamic = "force-dynamic";

/** My shopping list: the tasks given to me (or that I drive), each supplier's items with what each restaurant needs. */
export default async function MyTasks() {
  const { ctx, onPhone } = await stockCtx();
  const db = store();
  const now = Date.now();
  const today = londonDate(now);
  const [{ catalog, data }, sites] = await Promise.all([stockView(db, now), db.sites()]);
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  const mine = data.tasks.filter((t) => !t.cancelledAt && (t.assigneeId === ctx.person.id || t.driverId === ctx.person.id));
  const open = mine.filter((t) => taskState(t, data.lines, data.events) !== "done").sort((a, b) => (a.requiredBy ?? "9").localeCompare(b.requiredBy ?? "9") || Number(b.priority === "urgent") - Number(a.priority === "urgent"));
  const done = mine.filter((t) => taskState(t, data.lines, data.events) === "done" && now - t.createdAt < 14 * 86_400_000);
  const first = ctx.person.name.split(" ")[0];

  return (
    <>
      <StockBar ctx={ctx} onPhone={onPhone} title="My shopping list" back="/stock" eyebrow={`${first} · ${shortDay(today)}`} />
      <main className="stack">
        {!open.length && <div className="card muted">Nothing for you right now. When the owner gives you a shopping trip or an order, it shows here.</div>}
        {open.map((t) => {
          const sup = catalog.suppliers.find((s) => s.id === t.supplierId);
          const lines = data.lines.filter((l) => l.taskId === t.id);
          const todo = lines.filter((l) => !lineEnd(l, data.events));
          const byProduct = new Map<string, { name: string; qty: number; sites: Map<string, number> }>();
          for (const l of todo) {
            const r = data.requests.find((x) => x.id === l.requestId);
            if (!r) continue;
            const p = catalog.products.find((x) => x.id === r.productId);
            const e = byProduct.get(r.productId) ?? { name: p ? productLabel(p) : "?", qty: 0, sites: new Map() };
            e.qty += l.qty; e.sites.set(r.siteId, (e.sites.get(r.siteId) ?? 0) + l.qty);
            byProduct.set(r.productId, e);
          }
          const late = t.requiredBy && t.requiredBy < today;
          const role = t.assigneeId === ctx.person.id ? methodOf(t.method)?.who : "Driver";
          return (
            <Link key={t.id} href={`/stock/tasks/${t.id}`} className="stock-group" style={{ textDecoration: "none", color: "inherit" }}>
              <div className="stock-group-head">
                <h3 className="grow">{sup?.name ?? "Purchasing"} · {todo.length} item{todo.length === 1 ? "" : "s"}</h3>
                {t.priority === "urgent" && <span className="chip bad">Urgent</span>}
                <span className={`chip ${late ? "bad" : "late"}`}>{t.requiredBy ? (late ? `Late: was ${shortDay(t.requiredBy)}` : `By ${shortDay(t.requiredBy)}`) : TASK_LABEL[taskState(t, data.lines, data.events)]}</span>
              </div>
              <div className="muted" style={{ fontSize: 13 }}>{taskCode(t)} · {methodOf(t.method)?.label} · you&apos;re the {role?.toLowerCase()}{t.note ? ` · ${t.note}` : ""}</div>
              <ul className="stock-timeline">
                {[...byProduct.values()].map((e) => (
                  <li key={e.name}><span className="strong" style={{ minWidth: 40 }}>{qtyText(e.qty)}</span><span>{e.name}{e.sites.size > 1 ? ` (${[...e.sites.entries()].map(([s, q]) => `${siteName.get(s) ?? s} ${qtyText(q)}`).join(", ")})` : ` → ${siteName.get([...e.sites.keys()][0]) ?? ""}`}</span></li>
                ))}
              </ul>
            </Link>
          );
        })}
        {done.length > 0 && (
          <section className="stack" style={{ gap: 8 }} aria-label="Done">
            <h2 className="h-sec">Done in the last 2 weeks</h2>
            {done.map((t) => <Link key={t.id} className="stock-line done" href={`/stock/tasks/${t.id}`} style={{ textDecoration: "none", color: "inherit" }}>{taskCode(t)} · {catalog.suppliers.find((s) => s.id === t.supplierId)?.name ?? ""}</Link>)}
          </section>
        )}
        <div className="muted" style={{ fontSize: 13 }}>Shops are listed by when they&apos;re needed. A driving route between them isn&apos;t worked out yet.</div>
      </main>
      <StockNav ctx={ctx} onPhone={onPhone} />
    </>
  );
}
