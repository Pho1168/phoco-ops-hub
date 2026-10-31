import { brandOf } from "@/lib/domain/brand";
import Link from "next/link";
import { store } from "@/lib/data";
import type { HandoverItem } from "@/lib/data/store";
import { forLabel, NEXT_SHIFT_DAYS, pickPeriod, targetPeriod } from "@/lib/domain/assign";
import { currentNotes, noteOrder } from "@/lib/domain/handover";
import { reportOrder, shiftLabel } from "@/lib/domain/prep";
import { seesRecipes } from "@/lib/domain/recipes";
import { phoneShows } from "@/lib/domain/reminders";
import { faultsOf, sinceText, SEVERITY_LABEL } from "@/lib/domain/equipment";
import { givablePeople, pickFor, rotaAround } from "@/lib/handover-service";
import { BottomNav, PhoneTopBar, TopBar } from "@/components/Chrome";
import { Icon } from "@/components/Icon";
import { HandoverList } from "./HandoverList";
import { NoteForm } from "./NoteForm";
import { handoverView } from "./load";
import { noteTile, prepTile } from "./tiles";

export const dynamic = "force-dynamic";

const when = (t: number) => new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

/**
 * The Handover tab: notes for this shift and the next (with a box to add one), the prep still to do from the last
 * handover with who each item is for, kit problems and the recent handovers, side by side on a tablet. The way into
 * the closing prep handover sits under the prep. Managers can read it on their own phone: no ticking, notes or prep
 * there, and staff notes and complaint details stay on the tablet.
 */
export default async function Handover(props: { searchParams: Promise<{ sent?: string; site?: string }> }) {
  const searchParams = await props.searchParams;
  const { ctx, site, prepOn, readOnly, sites } = await handoverView(searchParams.site);
  const db = store();
  const now = Date.now();
  const [items, history, draft, notes, kit, kitOpen, people] = await Promise.all([
    prepOn ? db.prepItems(brandOf(site).id) : Promise.resolve([]),
    prepOn ? db.prepHandovers(site.id, 15) : Promise.resolve([]),
    prepOn && !readOnly ? db.prepDraft(site.id) : Promise.resolve(undefined),
    db.handover(site.id),
    db.equipment(site.id),
    db.equipmentEvents({ siteId: site.id, openFaultsOnly: true }),
    db.people(),
  ]);
  const kitName = new Map(kit.map((e) => [e.id, e.name]));
  const kitFaults = faultsOf(kitOpen).filter((f) => kitName.has(f.fault.equipmentId))
    .sort((a, b) => (a.fault.severity === b.fault.severity ? a.fault.createdAt - b.fault.createdAt : a.fault.severity === "down" ? -1 : 1));
  const latest = history[0];
  // The rota from the last prep handover (to say which shift it's for), but no further back than a next shift can be.
  const rota = await rotaAround(site.id, Math.max(Math.min(now, latest?.submittedAt ?? now), now - (NEXT_SHIFT_DAYS + 1) * 86_400_000), now, db);
  const byId = new Map(items.map((i) => [i.id, i]));
  // Recipe sheets open from a prep item for anyone who reads recipes here (the kitchen, on the full app): published, live prep recipes.
  const recipes = !readOnly && seesRecipes(ctx.person, sites) && items.some((i) => i.recipeId)
    ? new Set((await db.libraryDocs("prep", { light: true })).filter((d) => d.published && !d.retiredAt).map((d) => d.id)) : undefined;
  const sentTimes = history.map((h) => h.submittedAt!);
  // Anyone on the tablet can give something to someone: the people working the shift it's about come first.
  const pick = readOnly ? undefined : pickFor(site, pickPeriod(latest && { shift: latest.shift, submittedAt: latest.submittedAt! }, now, rota), rota, people, now);
  // Who can be given things here now: anyone else an item is for has left or is frozen, so it's for anyone.
  const here = new Set(givablePeople(people, site.id).map((p) => p.id));
  // On a phone, staff notes and complaints are only counted: they're read on the tablet.
  const onPhone = (n: HandoverItem) => !readOnly || phoneShows(n);

  const prepOpen = latest ? reportOrder(latest.entries.filter((e) => e.status === "outstanding"), items) : [];
  const allNotes = noteOrder(currentNotes(notes, sentTimes, now));
  const notesOpen = allNotes.filter(onPhone);
  const notesHidden = allNotes.length - notesOpen.length;
  // Food-safety notes first, then the rest; urgent prep first, then the rest.
  const noteTiles = [
    ...notesOpen.filter((n) => n.category === "Food safety" && n.needsAction).map((n) => noteTile(n, here)),
    ...notesOpen.filter((n) => !(n.category === "Food safety" && n.needsAction)).map((n) => noteTile(n, here)),
  ];
  const prepTiles = [...prepOpen.filter((e) => e.urgent), ...prepOpen.filter((e) => !e.urgent)].map((e) => prepTile(e, byId, here, recipes));
  const doneSince = latest?.submittedAt ?? now - 24 * 3_600_000;
  const byDone = (a: { completedAt?: number }, b: { completedAt?: number }) => (b.completedAt ?? 0) - (a.completedAt ?? 0);
  const doneNotes = notes.filter((n) => n.closedAt && n.closedAt > doneSince && onPhone(n)).map((n) => noteTile(n, here)).sort(byDone);
  const donePrep = (latest?.entries.filter((e) => e.status === "completed").map((e) => prepTile(e, byId, here, recipes)) ?? []).sort(byDone);
  const hiddenToDo = allNotes.filter((n) => n.needsAction && !onPhone(n)).length;
  const notesToDo = noteTiles.filter((t) => !t.info).length + hiddenToDo;
  const toDo = notesToDo + prepTiles.length;
  const picked = draft?.entries.length ?? 0;
  const Bar = readOnly ? PhoneTopBar : TopBar;

  return (
    <>
      <Bar ctx={ctx} title="Handover" eyebrow={`${site.name} · shift handover${readOnly ? " · read-only" : ""}`}>
        {toDo > 0 && <span className="chip warn">{toDo} to do</span>}
        {latest && <span className="muted hide-narrow" style={{ color: "inherit", opacity: .8 }}>Last sent {when(latest.submittedAt!)} by {latest.submittedByName}</span>}
      </Bar>
      <main className="wide">
        {searchParams.sent && !readOnly && <div className="alert good" role="status"><div className="strong">Handover sent. The next shift sees it here.</div></div>}

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

        {prepOn && !readOnly && (
          <div className="row wrap no-print" style={{ gap: 8, alignItems: "center" }}>
            <span className="muted lead grow" style={{ fontSize: 14 }}>The whole handover list on paper, with a box to tick for every item.</span>
            <a className="btn small" href="/handover/list" target="_blank" rel="noreferrer"><Icon name="print" /> Print handover list (80 mm receipt)</a>
          </div>
        )}

        <div className="cols three">
          <section className="stack" aria-label="Notes" style={{ gap: 10 }}>
            <h2 className="grp-h">Notes <span>for this shift and the next</span></h2>
            {!readOnly && <NoteForm pick={pick} />}
            <HandoverList handoverId={latest?.id} open={noteTiles} done={doneNotes} canAct={!readOnly} pick={pick}
              empty={hiddenToDo
                ? <div className="alert"><div className="strong">{hiddenToDo} note{hiddenToDo > 1 ? "s" : ""} to do, to read on the tablet</div></div>
                : <div className="card muted">No notes waiting.</div>} />
          </section>

          <section className="stack" aria-label="Prep to do" style={{ gap: 10 }}>
            <h2 className="grp-h">Prep to do <span>{prepOn ? (latest ? `from the ${shiftLabel(latest.shift).toLowerCase()} handover` : "no handover sent yet") : "not used at this site"}</span></h2>
            {prepOn && (
              <HandoverList handoverId={latest?.id} open={prepTiles} done={donePrep} canAct={!readOnly} pick={pick}
                empty={<div className="card muted">{latest ? "All the prep from the last handover is done." : "Nothing carried over yet."}</div>} />
            )}
            {prepOn && !readOnly && pick && (
              <div className="card" style={{ background: "color-mix(in srgb, var(--teal-tint) 55%, var(--surface))", fontSize: 13 }}>
                Each item keeps who it&apos;s for. Change &ldquo;For&rdquo; to pass it on; the person sees it on their shift screen and phone.
              </div>
            )}
            {prepOn && !readOnly && (
              <Link href="/handover/prep" className="cta-dark">
                <Icon name="handover" />
                <span className="grow">
                  <span className="strong" style={{ display: "block" }}>{picked ? "Continue the prep handover" : "Closing up? Start the prep handover"}</span>
                  <span style={{ fontSize: 13, opacity: .85 }}>{picked ? `${picked} item${picked > 1 ? "s" : ""} picked so far${draft?.createdByName ? ` (started by ${draft.createdByName})` : ""}` : "Tick what the next shift needs to prep, review, send"}</span>
                </span>
                <span className="pill-btn" style={{ background: "var(--amber)", color: "var(--amber-ink)" }}>{picked ? "Continue" : "Start"}</span>
              </Link>
            )}
          </section>

          <aside className="aside panel">
            <section className="stack" aria-label="Equipment problems" style={{ gap: 8 }}>
              <h2 className="grp-h">Kit <span>{kitFaults.length ? `${kitFaults.length} open` : "all working"}</span></h2>
              {kitFaults.map((f) => (
                <Link key={f.fault.id} href={`/equipment/${f.fault.equipmentId}`} className={`alert ${f.fault.severity === "down" ? "bad" : ""}`} style={{ textDecoration: "none", padding: "10px 12px" }}>
                  <Icon name="wrench" />
                  <span className="grow">
                    <span className="strong" style={{ display: "block", fontSize: 14 }}>{kitName.get(f.fault.equipmentId)} · {f.fault.body}</span>
                    <span style={{ fontSize: 12 }}>{SEVERITY_LABEL[f.fault.severity!]} · {f.fault.createdByName} · {sinceText(f.fault.createdAt, now)} ago{f.updates.length ? ` · ${f.updates[f.updates.length - 1].body}` : ""}</span>
                  </span>
                </Link>
              ))}
              {!readOnly && <Link className="btn ghost small" href="/equipment" style={{ justifyContent: "flex-start" }}><Icon name="wrench" />Report a problem with kit</Link>}
            </section>

            {prepOn && (
              <section className="stack" aria-label="Recent handovers" style={{ gap: 8 }}>
                <h2 className="grp-h">Recent handovers</h2>
                {latest
                  ? (
                    <div className="card hist">
                      {history.slice(0, 4).map((x, i) => (
                        <div key={x.id}>
                          <Link href={`/handover/report?id=${x.id}`} className="strong grow" style={{ fontSize: 14 }}>{when(x.submittedAt!)} · {shiftLabel(x.shift)}</Link>
                          <span className="muted">{x.submittedByName}</span>
                          <span className="muted" style={{ flexBasis: "100%" }}>
                            {i === 0 ? `For ${forLabel(x.shift, targetPeriod(x.shift, x.submittedAt!, rota))} · ` : ""}{x.entries.length} prep · {x.stockedCount} stocked
                          </span>
                        </div>
                      ))}
                    </div>
                  )
                  : <div className="card muted">No prep handover sent yet.</div>}
              </section>
            )}
          </aside>
        </div>
      </main>
      {readOnly ? null : <BottomNav ctx={ctx} current="handover" />}
    </>
  );
}
