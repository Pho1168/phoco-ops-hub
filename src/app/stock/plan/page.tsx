import Link from "next/link";
import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { countAge, countIsOld } from "@/lib/domain/stock-count";
import { londonDate, londonHM, shortDay } from "@/lib/domain/time";
import { kitchenPlan } from "@/lib/stock-service";
import { StockBar, StockNav } from "../Bar";
import { stockCtx } from "../load";
import { PlanTable } from "./PlanTable";

export const dynamic = "force-dynamic";

/**
 * The production plan: from the kitchen's latest count, what's on the shelf, the target, what the restaurants still
 * need sending, and what to make. Owners, the kitchen's managers and operations managers; they also set the targets.
 */
export default async function PlanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { ctx, onPhone, can } = await stockCtx();
  if (!can.planSites.length) redirect("/stock");
  const params = await searchParams;
  const asked = typeof params.site === "string" ? params.site : undefined;
  const siteId = asked && can.planSites.includes(asked) ? asked : can.planSites.includes(ctx.site.id) ? ctx.site.id : can.planSites[0];
  const db = store();
  const now = Date.now();
  const today = londonDate(now);
  const [plan, sites] = await Promise.all([kitchenPlan(db, siteId, now), db.sites()]);
  const site = sites.find((s) => s.id === siteId)!;
  const { latest, rows, counts, products } = plan;
  const make = rows.filter((r) => (r.make ?? 0) > 0).length;
  const notCounted = rows.filter((r) => r.state === "not_counted").length;
  const noTarget = rows.filter((r) => r.target === undefined).length;
  const old = countIsOld(latest?.date, today);

  return (
    <>
      <StockBar ctx={ctx} onPhone={onPhone} title="Production plan" back="/stock" eyebrow={`${site.name} · ${shortDay(today)}`} />
      <main className="wide stack">
        {can.planSites.length > 1 && (
          <div className="seg" role="group" aria-label="Kitchen">
            {can.planSites.map((id) => <Link key={id} href={`/stock/plan?site=${id}`} aria-current={id === siteId ? "page" : undefined} className={id === siteId ? "sm-seg-on" : undefined}>{sites.find((s) => s.id === id)?.name ?? id}</Link>)}
          </div>
        )}
        <div className="cols two">
          <section className="stack" aria-label="Plan" style={{ gap: 12 }}>
            <div className={`card stack ${old ? "plan-old" : ""}`} style={{ gap: 6 }}>
              {latest ? (
                <>
                  <div className="strong" style={{ fontSize: 18 }}>Counted {countAge(latest.date, today)} at {londonHM(latest.createdAt)}{latest.countedByName ? ` by ${latest.countedByName.split(" ")[0]}` : ""}</div>
                  <div className="muted">{latest.lines.length} of {products.length} items counted{latest.note ? ` · “${latest.note}”` : ""}</div>
                  {old && <div className="err-text">This count is more than a day old. Ask the closers to count before you plan from it.</div>}
                </>
              ) : (
                <>
                  <div className="strong" style={{ fontSize: 18 }}>No count yet at {site.name}</div>
                  <div className="muted">The closers are asked to count on their shift screen. Until then, set the targets below.</div>
                </>
              )}
              <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
                <span className={`chip ${make ? "late" : "done"}`}>{make ? `${make} to make` : "Nothing to make"}</span>
                {notCounted > 0 && latest && <span className="chip warn">{notCounted} not counted</span>}
                {noTarget > 0 && <span className="chip">{noTarget} without a target</span>}
              </div>
            </div>
            <PlanTable siteId={siteId} rows={rows.map((r) => ({ id: r.product.id, name: r.product.name, size: r.product.size, category: r.product.category, onHand: r.onHand, target: r.target, toSend: r.toSend, make: r.make, state: r.state }))} />
          </section>
          <aside className="aside panel stack" aria-label="How it works and recent counts">
            <h2 className="grp-h">How “to make” works</h2>
            <p style={{ margin: 0 }}><b>Target</b> + <b>still to send</b> to the restaurants − <b>on the shelf</b>. With no target, just enough for what&apos;s still to send.</p>
            <p className="muted" style={{ margin: 0 }}>Still to send is what the restaurants have ordered on {site.name}&apos;s production orders and hasn&apos;t gone in the van yet.</p>
            <div className="row wrap" style={{ gap: 8 }}>
              {can.count && ctx.site.id === siteId && <Link className="btn small" href="/stock/count">Count now</Link>}
              <Link className="btn ghost small" href="/stock/production">Production orders</Link>
            </div>
            <h2 className="grp-h" style={{ marginTop: 8 }}>Recent counts</h2>
            {!counts.length && <div className="muted">None in the last 30 days.</div>}
            <ul className="stock-timeline">
              {counts.slice(0, 8).map((c) => (
                <li key={c.id}><span className="strong" style={{ minWidth: 92 }}>{shortDay(c.date)} {londonHM(c.createdAt)}</span><span>{c.countedByName?.split(" ")[0] ?? "?"} · {c.lines.length} of {products.length}{c.note ? ` · ${c.note}` : ""}</span></li>
              ))}
            </ul>
          </aside>
        </div>
      </main>
      <StockNav ctx={ctx} onPhone={onPhone} />
    </>
  );
}
