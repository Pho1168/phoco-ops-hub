import Link from "next/link";
import { store } from "@/lib/data";
import type { HandoverItem } from "@/lib/data/store";
import { forLabel, NEXT_SHIFT_DAYS, pickPeriod, targetPeriod } from "@/lib/domain/assign";
import { currentNotes, noteOrder } from "@/lib/domain/handover";
import { reportOrder, shiftLabel } from "@/lib/domain/prep";
import { phoneShows } from "@/lib/domain/reminders";
import { faultsOf, sinceText, SEVERITY_LABEL } from "@/lib/domain/equipment";
import { pickFor, rotaAround } from "@/lib/handover-service";
import { BottomNav, PhoneTopBar, TopBar } from "@/components/Chrome";
import { HandoverList } from "./HandoverList";
import { NoteForm } from "./NoteForm";
import { handoverView } from "./load";
import { noteTile, prepTile } from "./tiles";

export const dynamic = "force-dynamic";

const when = (t: number) => new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

/**
 * The Handover tab: everything outstanding for this shift (prep items from the last handover and notes) in one list,
 * who each one is for, a box to add a note at any time, and the way into the closing prep handover. Managers can
 * read it on their own phone: no ticking, notes or prep there, and staff notes and complaint details stay on the tablet.
 */
export default async function Handover(props: { searchParams: Promise<{ sent?: string; site?: string }> }) {
  const searchParams = await props.searchParams;
  const { ctx, site, prepOn, readOnly, sites } = await handoverView(searchParams.site);
  const db = store();
  const now = Date.now();
  const [items, history, draft, notes, kit, kitOpen, people] = await Promise.all([
    prepOn ? db.prepItems() : Promise.resolve([]),
    prepOn ? db.prepHandovers(site.id, 15) : Promise.resolve([]),
    prepOn && !readOnly ? db.prepDraft(site.id) : Promise.resolve(undefined),
    db.handover(site.id),
    db.equipment(site.id),
    db.equipmentEvents({ siteId: site.id, openFaultsOnly: true }),
    readOnly ? Promise.resolve([]) : db.people(),
  ]);
  const kitName = new Map(kit.map((e) => [e.id, e.name]));
  const kitFaults = faultsOf(kitOpen).filter((f) => kitName.has(f.fault.equipmentId))
    .sort((a, b) => (a.fault.severity === b.fault.severity ? a.fault.createdAt - b.fault.createdAt : a.fault.severity === "down" ? -1 : 1));
  const latest = history[0];
  // The rota from the last prep handover (to say which shift it's for), but no further back than a next shift can be.
  const rota = await rotaAround(site.id, Math.max(Math.min(now, latest?.submittedAt ?? now), now - (NEXT_SHIFT_DAYS + 1) * 86_400_000), now, db);
  const byId = new Map(items.map((i) => [i.id, i]));
  const sentTimes = history.map((h) => h.submittedAt!);
  // Anyone on the tablet can give something to someone: the people working the shift it's about come first.
  const pick = readOnly ? undefined : pickFor(site, pickPeriod(latest && { shift: latest.shift, submittedAt: latest.submittedAt! }, now, rota), rota, people, now);
  // On a phone, staff notes and complaints are only counted: they're read on the tablet.
  const onPhone = (n: HandoverItem) => !readOnly || phoneShows(n);

  const prepOpen = latest ? reportOrder(latest.entries.filter((e) => e.status === "outstanding"), items) : [];
  const allNotes = noteOrder(currentNotes(notes, sentTimes, now));
  const notesOpen = allNotes.filter(onPhone);
  const notesHidden = allNotes.length - notesOpen.length;
  const open = [
    ...notesOpen.filter((n) => n.category === "Food safety" && n.needsAction).map(noteTile),
    ...prepOpen.filter((e) => e.urgent).map((e) => prepTile(e, byId)),
    ...notesOpen.filter((n) => !(n.category === "Food safety" && n.needsAction)).map(noteTile),
    ...prepOpen.filter((e) => !e.urgent).map((e) => prepTile(e, byId)),
  ];
  const doneSince = latest?.submittedAt ?? now - 24 * 3_600_000;
  const done = [
    ...(latest?.entries.filter((e) => e.status === "completed").map((e) => prepTile(e, byId)) ?? []),
    ...notes.filter((n) => n.closedAt && n.closedAt > doneSince && onPhone(n)).map(noteTile),
  ].sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  const hiddenToDo = allNotes.filter((n) => n.needsAction && !onPhone(n)).length;
  const toDo = open.filter((t) => !t.info).length + hiddenToDo;
  const picked = draft?.entries.length ?? 0;

  return (
    <>
      {readOnly ? <PhoneTopBar ctx={ctx} /> : <TopBar ctx={ctx} />}
      <main className="wide">
        {searchParams.sent && !readOnly && <div className="alert good" role="status"><div className="strong">Handover sent. The next shift sees it here.</div></div>}
        <header className="prep-head">
          <div className="eyebrow">PHO &amp; CO · Shift handover{readOnly ? " · read-only" : ""}</div>
          <div className="prep-head-row">
            <div className="grow">
              <h1 className="h-display">{site.name}</h1>
              {latest
                ? (
                  <dl className="prep-meta">
                    <div><dt>Last handover</dt><dd>{when(latest.submittedAt!)}</dd></div>
                    <div><dt>For</dt><dd>{forLabel(latest.shift, targetPeriod(latest.shift, latest.submittedAt!, rota))}</dd></div>
                    <div><dt>From</dt><dd>{latest.submittedByName}</dd></div>
                    <div><dt>Stocked</dt><dd>{latest.stockedCount} items confirmed</dd></div>
                  </dl>
                )
                : <div className="prep-meta" style={{ display: "block" }}>{prepOn ? "No prep handover sent yet." : "Notes for the next shift."}</div>}
            </div>
            <div className="prep-big"><b>{toDo}</b><span>to do</span></div>
          </div>
        </header>

        {readOnly && (
          <div className="card stack" style={{ gap: 6 }}>
            {sites.length > 1 && (
              <nav className="row wrap" aria-label="Site" style={{ gap: 8 }}>
                {sites.map((s) => <Link key={s.id} className={`btn small ${s.id === site.id ? "" : "ghost"}`} aria-current={s.id === site.id ? "page" : undefined} href={`/handover?site=${s.id}`}>{s.name}</Link>)}
              </nav>
            )}
            <div className="muted" style={{ fontSize: 14 }}>
              Read-only on your phone. Ticking things off, notes and the prep handover are on the tablet.
              {notesHidden > 0 && ` ${notesHidden} more note${notesHidden > 1 ? "s" : ""} (staff notes or customer complaints) can be read there.`}
            </div>
          </div>
        )}

        <HandoverList handoverId={latest?.id} open={open} done={done} canAct={!readOnly} pick={pick}
          empty={hiddenToDo ? <div className="alert"><div className="strong">{hiddenToDo} note{hiddenToDo > 1 ? "s" : ""} to do, to read on the tablet</div></div> : undefined} />

        {!readOnly && <NoteForm pick={pick} />}

        <section className="stack" aria-label="Equipment problems">
          <div className="row"><h2 className="h-sec grow">Equipment</h2>{!readOnly && <Link className="btn ghost small" href="/equipment">Report a problem</Link>}</div>
          {kitFaults.length === 0
            ? <div className="muted">No equipment problems open.</div>
            : kitFaults.map((f) => (
              <Link key={f.fault.id} href={`/equipment/${f.fault.equipmentId}`} className="list-btn">
                <span className="grow">
                  <span className="strong" style={{ display: "block" }}>{kitName.get(f.fault.equipmentId)}: {f.fault.body}</span>
                  <span className="muted">{f.fault.createdByName} · {sinceText(f.fault.createdAt, now)} ago{f.updates.length ? ` · ${f.updates[f.updates.length - 1].body}` : ""}</span>
                </span>
                <span className={`chip ${f.fault.severity === "down" ? "bad" : "warn"}`}>{SEVERITY_LABEL[f.fault.severity!]}</span>
              </Link>
            ))}
        </section>

        {prepOn && !readOnly && (
          <Link href="/handover/prep" className="list-btn" style={{ textDecoration: "none" }}>
            <span className="ring">{picked || "→"}</span>
            <span className="grow">
              <span className="strong" style={{ display: "block" }}>{picked ? "Continue the prep handover" : "Closing up? Start the prep handover"}</span>
              <span className="muted">{picked ? `${picked} item${picked > 1 ? "s" : ""} picked so far${draft?.createdByName ? ` (started by ${draft.createdByName})` : ""}` : "Tap only what the next shift needs to prep, then send"}</span>
            </span>
          </Link>
        )}

        {history.length > 1 && !readOnly && (
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
      {readOnly ? null : <BottomNav ctx={ctx} current="handover" />}
    </>
  );
}
