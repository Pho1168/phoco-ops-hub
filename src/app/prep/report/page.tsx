import Link from "next/link";
import { notFound } from "next/navigation";
import { store } from "@/lib/data";
import { categoryLabel, reportOrder, shiftLabel } from "@/lib/domain/prep";
import { BottomNav, TopBar } from "@/components/Chrome";
import { prepPage } from "../load";
import { ReportItems, type ReportEntry } from "./ReportItems";

export const dynamic = "force-dynamic";

const when = (t: number) => new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

export default async function PrepReport({ searchParams }: { searchParams: { id?: string; sent?: string } }) {
  const { ctx } = await prepPage();
  const db = store();
  const [items, history] = await Promise.all([db.prepItems(), db.prepHandovers(ctx.site.id, 15)]);
  const h = searchParams.id ? await db.prepHandover(searchParams.id) : history[0];
  if (searchParams.id && (!h || h.siteId !== ctx.site.id || h.status !== "submitted")) notFound();
  const byId = new Map(items.map((i) => [i.id, i]));
  const view = (e: NonNullable<typeof h>["entries"][number]): ReportEntry => ({
    id: e.id, itemId: e.itemId, name: byId.get(e.itemId)?.name ?? e.itemId, category: categoryLabel(byId.get(e.itemId)?.category ?? "cooking"),
    urgent: e.urgent, note: e.note, carried: !!e.carriedFrom, completedAt: e.completedAt, completedByName: e.completedByName,
  });
  const outstanding = h ? reportOrder(h.entries.filter((e) => e.status === "outstanding"), items).map(view) : [];
  const completed = h ? h.entries.filter((e) => e.status === "completed").sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)).map(view) : [];
  const handedOn = h ? h.entries.filter((e) => e.status === "carried").length : 0;
  const isLatest = !!h && h.id === history[0]?.id;

  return (
    <>
      <TopBar ctx={ctx} />
      <main className="wide">
        {searchParams.sent && <div className="alert good" role="status"><div className="strong">Handover sent. The next shift sees this report.</div></div>}
        {!h && (
          <div className="card stack">
            <div className="strong">No kitchen prep handover yet at {ctx.site.name}</div>
            <Link className="btn accent" href="/prep">Start one</Link>
          </div>
        )}
        {h && (
          <>
            <header className="prep-head">
              <div className="eyebrow">PHO &amp; CO · Kitchen prep handover</div>
              <div className="prep-head-row">
                <div className="grow">
                  <h1 className="h-display">{ctx.site.name}</h1>
                  <dl className="prep-meta">
                    <div><dt>Shift</dt><dd>{shiftLabel(h.shift)}</dd></div>
                    <div><dt>Sent</dt><dd>{when(h.submittedAt!)}</dd></div>
                    <div><dt>From</dt><dd>{h.submittedByName}</dd></div>
                    <div><dt>Stocked</dt><dd>{h.stockedCount} items confirmed</dd></div>
                  </dl>
                </div>
                <div className="prep-big"><b>{outstanding.length}</b><span>outstanding</span></div>
              </div>
            </header>
            {!isLatest && <div className="alert"><div className="grow">This is an older handover. Anything left on it was carried into a newer one.</div><Link className="btn small" href="/prep/report">Latest</Link></div>}
            <ReportItems handoverId={h.id} outstanding={outstanding} completed={completed} canAct={isLatest} />
            {handedOn > 0 && <div className="muted">{handedOn} item{handedOn > 1 ? "s were" : " was"} carried on to the next handover.</div>}
          </>
        )}
        <div className="row wrap">
          <Link className="btn accent grow" href="/prep">New handover</Link>
        </div>
        {history.length > 1 && (
          <section className="stack">
            <h2 className="h-sec">Earlier handovers</h2>
            <div className="card log">
              {history.filter((x) => x.id !== h?.id).map((x) => (
                <div key={x.id}>
                  <Link href={`/prep/report?id=${x.id}`} className="grow">{when(x.submittedAt!)} · {shiftLabel(x.shift)} · {x.submittedByName}</Link>
                  <span className="muted">{x.entries.length} needed</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
      <BottomNav ctx={ctx} current="prep" />
    </>
  );
}
