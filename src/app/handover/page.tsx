import Link from "next/link";
import { store } from "@/lib/data";
import { currentNotes, noteOrder } from "@/lib/domain/handover";
import { reportOrder, shiftLabel } from "@/lib/domain/prep";
import { BottomNav, TopBar } from "@/components/Chrome";
import { HandoverList } from "./HandoverList";
import { NoteForm } from "./NoteForm";
import { handoverPage } from "./load";
import { noteTile, prepTile } from "./tiles";

export const dynamic = "force-dynamic";

const when = (t: number) => new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

/**
 * The Handover tab: everything outstanding for this shift (prep items from the last handover and notes) in one list,
 * a box to add a note at any time, and the way into the closing prep handover.
 */
export default async function Handover({ searchParams }: { searchParams: { sent?: string } }) {
  const { ctx, prepOn } = await handoverPage();
  const db = store();
  const now = Date.now();
  const [items, history, draft, notes] = await Promise.all([
    prepOn ? db.prepItems() : Promise.resolve([]),
    prepOn ? db.prepHandovers(ctx.site.id, 15) : Promise.resolve([]),
    prepOn ? db.prepDraft(ctx.site.id) : Promise.resolve(undefined),
    db.handover(ctx.site.id),
  ]);
  const latest = history[0];
  const byId = new Map(items.map((i) => [i.id, i]));
  const sentTimes = history.map((h) => h.submittedAt!);

  const prepOpen = latest ? reportOrder(latest.entries.filter((e) => e.status === "outstanding"), items) : [];
  const notesOpen = noteOrder(currentNotes(notes, sentTimes, now));
  const open = [
    ...notesOpen.filter((n) => n.category === "Food safety" && n.needsAction).map(noteTile),
    ...prepOpen.filter((e) => e.urgent).map((e) => prepTile(e, byId)),
    ...notesOpen.filter((n) => !(n.category === "Food safety" && n.needsAction)).map(noteTile),
    ...prepOpen.filter((e) => !e.urgent).map((e) => prepTile(e, byId)),
  ];
  const doneSince = latest?.submittedAt ?? now - 24 * 3_600_000;
  const done = [
    ...(latest?.entries.filter((e) => e.status === "completed").map((e) => prepTile(e, byId)) ?? []),
    ...notes.filter((n) => n.closedAt && n.closedAt > doneSince).map(noteTile),
  ].sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  const toDo = open.filter((t) => !t.info).length;
  const picked = draft?.entries.length ?? 0;

  return (
    <>
      <TopBar ctx={ctx} />
      <main className="wide">
        {searchParams.sent && <div className="alert good" role="status"><div className="strong">Handover sent. The next shift sees it here.</div></div>}
        <header className="prep-head">
          <div className="eyebrow">PHO &amp; CO · Shift handover</div>
          <div className="prep-head-row">
            <div className="grow">
              <h1 className="h-display">{ctx.site.name}</h1>
              {latest
                ? (
                  <dl className="prep-meta">
                    <div><dt>Last handover</dt><dd>{when(latest.submittedAt!)}</dd></div>
                    <div><dt>For</dt><dd>{shiftLabel(latest.shift)}</dd></div>
                    <div><dt>From</dt><dd>{latest.submittedByName}</dd></div>
                    <div><dt>Stocked</dt><dd>{latest.stockedCount} items confirmed</dd></div>
                  </dl>
                )
                : <div className="prep-meta" style={{ display: "block" }}>{prepOn ? "No prep handover sent yet." : "Notes for the next shift."}</div>}
            </div>
            <div className="prep-big"><b>{toDo}</b><span>to do</span></div>
          </div>
        </header>

        <HandoverList handoverId={latest?.id} open={open} done={done} canAct />

        <NoteForm />

        {prepOn && (
          <Link href="/handover/prep" className="list-btn" style={{ textDecoration: "none" }}>
            <span className="ring">{picked || "→"}</span>
            <span className="grow">
              <span className="strong" style={{ display: "block" }}>{picked ? "Continue the prep handover" : "Closing up? Start the prep handover"}</span>
              <span className="muted">{picked ? `${picked} item${picked > 1 ? "s" : ""} picked so far${draft?.createdByName ? ` (started by ${draft.createdByName})` : ""}` : "Tap only what the next shift needs to prep, then send"}</span>
            </span>
          </Link>
        )}

        {history.length > 1 && (
          <section className="stack">
            <h2 className="h-sec">Earlier handovers</h2>
            <div className="card log">
              {history.slice(1).map((x) => (
                <div key={x.id}>
                  <Link href={`/handover/report?id=${x.id}`} className="grow">{when(x.submittedAt!)} · {shiftLabel(x.shift)} · {x.submittedByName}</Link>
                  <span className="muted">{x.entries.length} prep</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
      <BottomNav ctx={ctx} current="handover" />
    </>
  );
}
