import Link from "next/link";
import { notFound } from "next/navigation";
import { store } from "@/lib/data";
import { noteOrder, notesForHandover } from "@/lib/domain/handover";
import { reportOrder } from "@/lib/domain/prep";
import { sentForLabel } from "@/lib/domain/assign";
import { givablePeople } from "@/lib/handover-service";
import { BottomNav, TopBar } from "@/components/Chrome";
import { HandoverList } from "../HandoverList";
import { handoverPage } from "../load";
import { noteTile, prepTile } from "../tiles";

export const dynamic = "force-dynamic";

const when = (t: number) => new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

/** A sent handover as it was: its prep items and the notes written in its shift. Read-only. */
export default async function HandoverReport(props: { searchParams: Promise<{ id?: string }> }) {
  const searchParams = await props.searchParams;
  const { ctx } = await handoverPage();
  const db = store();
  const h = searchParams.id ? await db.prepHandover(searchParams.id) : undefined;
  if (!h || h.siteId !== ctx.site.id || h.status !== "submitted") notFound();
  const history = await db.prepHandovers(ctx.site.id, 50);
  const i = history.findIndex((x) => x.id === h.id);
  const prevSentAt = i >= 0 ? history[i + 1]?.submittedAt : undefined;
  const [items, notes, people] = await Promise.all([db.prepItems(), db.handover(ctx.site.id, prevSentAt ?? h.submittedAt! - 14 * 86_400_000), db.people()]);
  const here = new Set(givablePeople(people, ctx.site.id).map((p) => p.id));
  const byId = new Map(items.map((x) => [x.id, x]));
  const theirs = noteOrder(notesForHandover(notes, h.submittedAt!, prevSentAt));
  const prep = reportOrder(h.entries, items).map((e) => ({ e, t: prepTile(e, byId, here) }));
  const open = [...theirs.map((n) => noteTile(n, here)), ...prep.filter(({ e }) => e.status !== "completed").map(({ e, t }) => ({ ...t, carried: e.status === "carried" ? false : t.carried, detail: e.status === "carried" ? "Carried on to the next handover" : t.detail }))];
  const done = prep.filter(({ e }) => e.status === "completed").map(({ t }) => t);

  return (
    <>
      <TopBar ctx={ctx} />
      <main className="wide">
        <header className="prep-head">
          <div className="eyebrow">PHO &amp; CO · Earlier handover</div>
          <div className="prep-head-row">
            <div className="grow">
              <h1 className="h-display">{ctx.site.name}</h1>
              <dl className="prep-meta">
                <div><dt>Sent</dt><dd>{when(h.submittedAt!)}</dd></div>
                <div><dt>For</dt><dd>{sentForLabel(h.shift, h.submittedAt!)}</dd></div>
                <div><dt>From</dt><dd>{h.submittedByName}</dd></div>
                <div><dt>Stocked</dt><dd>{h.stockedCount} items confirmed</dd></div>
              </dl>
            </div>
          </div>
        </header>
        <div className="alert"><div className="grow">This is a record of an earlier handover. Anything left on it was carried into a newer one.</div><Link className="btn small" href="/handover">Current</Link></div>
        <HandoverList open={open} done={done} canAct={false} />
      </main>
      <BottomNav ctx={ctx} current="handover" />
    </>
  );
}
