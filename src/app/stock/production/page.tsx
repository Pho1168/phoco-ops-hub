import Link from "next/link";
import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { canSeeTask, lineEnd, productionQueue, productLabel, TASK_LABEL, taskCode, taskState } from "@/lib/domain/stock";
import { londonDate, shortDay } from "@/lib/domain/time";
import { stockView } from "@/lib/stock-service";
import { StockBar, StockNav } from "../Bar";
import { qtyText, stockCtx } from "../load";

export const dynamic = "force-dynamic";

/**
 * The production kitchen's orders from the restaurants: what to prepare or pick, by product, with each restaurant's
 * share (requested, dispatched, still to send), the orders themselves, and a packing list per restaurant for the van.
 */
export default async function Production() {
  const { ctx, onPhone, can } = await stockCtx();
  if (!can.productionSites.length && !can.purchasing) redirect("/stock");
  const db = store();
  const now = Date.now();
  const today = londonDate(now);
  const [{ catalog, data }, sites] = await Promise.all([stockView(db, now), db.sites()]);
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  const tasks = data.tasks.filter((t) => t.method === "production" && canSeeTask(ctx.person, t, catalog.suppliers.find((s) => s.id === t.supplierId)));
  const rows = productionQueue(tasks, data.lines, data.requests, data.events, catalog.products);
  const open = tasks.filter((t) => !t.cancelledAt && taskState(t, data.lines, data.events) !== "done").sort((a, b) => (a.requiredBy ?? "").localeCompare(b.requiredBy ?? ""));
  // The van: per restaurant, everything not yet dispatched.
  const packing = new Map<string, { product: string; qty: number; task: string }[]>();
  for (const t of open) for (const l of data.lines.filter((x) => x.taskId === t.id && !lineEnd(x, data.events))) {
    const r = data.requests.find((x) => x.id === l.requestId);
    const p = r && catalog.products.find((x) => x.id === r.productId);
    if (!r || !p) continue;
    const list = packing.get(r.siteId) ?? [];
    list.push({ product: productLabel(p), qty: l.qty, task: t.id });
    packing.set(r.siteId, list);
  }

  return (
    <>
      <StockBar ctx={ctx} onPhone={onPhone} title="Production orders" back="/stock" eyebrow={`Production kitchen · ${shortDay(today)}`} />
      <main className="wide stack">
        <div className="cols two">
          <section className="stack" aria-label="To prepare" style={{ gap: 10 }}>
            <h2 className="grp-h">To prepare or pick <span>by product, every restaurant together</span></h2>
            {!rows.length && <div className="card muted">No orders from the restaurants.</div>}
            {rows.map((r) => (
              <div key={r.product.id} className="stock-group">
                <div className="stock-group-head">
                  <h3 className="grow">{r.product.name}{r.product.size ? ` · ${r.product.size}` : ""}</h3>
                  <span className="stock-qty">{qtyText(r.outstanding)}</span>
                </div>
                <div className="muted" style={{ fontSize: 13 }}>Requested {qtyText(r.requested)} · dispatched {qtyText(r.dispatched)} · still to send {qtyText(r.outstanding)}</div>
                {r.sites.map((s) => (
                  <div key={s.siteId} className="stock-site">
                    <span className="grow">{siteName.get(s.siteId) ?? s.siteId}: {qtyText(s.requested)} requested{s.dispatched ? `, ${qtyText(s.dispatched)} sent` : ""}</span>
                    {s.lines.filter((x) => !x.view.end).slice(0, 1).map((x) => <Link key={x.view.line.id} className="btn small" href={`/stock/tasks/${x.task.id}`}>Open {taskCode(x.task)}</Link>)}
                  </div>
                ))}
              </div>
            ))}
          </section>
          <aside className="aside panel stack" aria-label="Orders">
            <h2 className="grp-h">Orders</h2>
            {!open.length && <div className="muted">None open.</div>}
            {open.map((t) => (
              <Link key={t.id} href={`/stock/tasks/${t.id}`} className="row" style={{ gap: 8, color: "inherit", textDecoration: "none" }}>
                <span className="grow strong">{taskCode(t)} → {siteName.get(t.destination ?? "") ?? "?"}</span>
                <span className={`chip ${t.requiredBy && t.requiredBy < today ? "bad" : "late"}`}>{TASK_LABEL[taskState(t, data.lines, data.events)]}{t.requiredBy ? ` · ${shortDay(t.requiredBy)}` : ""}</span>
              </Link>
            ))}
            <h2 className="grp-h" style={{ marginTop: 12 }}>Packing list for the van</h2>
            {![...packing.keys()].length && <div className="muted">Nothing to pack.</div>}
            {[...packing.entries()].map(([siteId, list]) => (
              <div key={siteId} className="stack" style={{ gap: 4 }}>
                <div className="strong">{siteName.get(siteId) ?? siteId}</div>
                <ul className="chk-list" style={{ margin: 0, paddingLeft: 18 }}>{list.map((x, i) => <li key={i}>{qtyText(x.qty)} × {x.product}</li>)}</ul>
              </div>
            ))}
          </aside>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>Stock on hand at the kitchen isn&apos;t counted in the app yet, so the list shows what&apos;s asked for, not what&apos;s on the shelf.</p>
      </main>
      <StockNav ctx={ctx} onPhone={onPhone} />
    </>
  );
}
