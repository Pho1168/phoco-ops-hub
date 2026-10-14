import Link from "next/link";
import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { canApprove, canDraft, canReview, docReach, isContributor, mustRead, readsAny, reviewState, versionLabel, type LibraryDoc } from "@/lib/domain/library";
import { sectionsFor } from "@/lib/domain/staff";
import { londonDate } from "@/lib/domain/time";
import { current } from "@/lib/session";
import { BottomNav, PhoneTopBar, TopBar } from "@/components/Chrome";
import { Icon } from "@/components/Icon";
import { MustRead } from "@/components/MustRead";
import { LibraryList, type LibItem } from "./LibraryList";
import { LibraryTabs } from "./LibraryTabs";
import { seesRecipes } from "@/lib/domain/recipes";
import { allergenChangesToConfirm } from "@/lib/library-service";
import { myTraining } from "@/lib/training-service";
import { dayMonth as when, whoFor } from "./format";

export const dynamic = "force-dynamic";

/**
 * The library's home: what's to read first, then the published SOPs to search, with the recipe handbook, the
 * allergen matrix and training as doors beside them. Everyone reads published SOPs; managers also see drafts and
 * what's waiting for approval, which owners and operations managers approve.
 */
export default async function Library() {
  const ctx = await current();
  if (!ctx) redirect("/login");
  if (ctx.person.pinMustChange) redirect("/pin");
  const db = store();
  const [docs, myAcks, sites] = await Promise.all([db.libraryDocs("sop", { light: true }), db.libraryAcks({ personId: ctx.person.id }), db.sites()]);
  const full = ctx.scope === "full";
  const writer = full && canDraft(ctx.person);
  const approver = full && canApprove(ctx.person);
  const recipes = full && seesRecipes(ctx.person, sites);
  const today = londonDate(Date.now());
  const acked = new Set(myAcks.map((a) => a.versionId));
  const toRead = mustRead(ctx.person, docs, acked, sites);
  const live = docs.filter((d) => d.published && !d.retiredAt).sort((a, b) => a.published!.title.localeCompare(b.published!.title));
  const items: LibItem[] = live.map((d) => {
    const v = d.published!;
    const forMe = readsAny(v.body.sections, ctx.person, sites);
    return {
      id: d.id, code: d.code, title: v.title, who: whoFor(v.body.sections), sections: v.body.sections,
      read: forMe ? (acked.has(v.id) ? "done" : "todo") : undefined,
      review: writer ? reviewState(v.reviewBy, today) : undefined,
      draft: writer && d.open ? versionLabel(d.open) : undefined,
    };
  });
  const mySections = Array.from(new Set(ctx.person.access.flatMap((a) => {
    const site = sites.find((s) => s.id === a.siteId);
    return a.role === "staff" || !site ? a.sections : sectionsFor(site.kind);
  })));
  const open = (d: LibraryDoc) => !!d.open && !d.retiredAt;
  const waiting = writer ? docs.filter((d) => open(d) && d.open!.status === "in_review") : [];
  const drafts = writer ? docs.filter((d) => open(d) && d.open!.status === "draft") : [];
  // Retired SOPs that were published (one dropped as a first draft has nothing to show).
  const retired = writer ? docs.filter((d) => d.retiredAt && d.published) : [];
  // The doors beside the list: the handbook's size, allergen changes to confirm, where my training stands.
  const [preps, dishes, allergenChanges, training] = await Promise.all([
    recipes ? db.libraryDocs("prep", { light: true }) : Promise.resolve([]),
    recipes ? db.libraryDocs("dish", { light: true }) : Promise.resolve([]),
    allergenChangesToConfirm(ctx.person, db),
    myTraining(ctx.person, sites, db),
  ]);
  const published = (xs: LibraryDoc[]) => xs.filter((d) => d.published && !d.retiredAt).length;
  const t = training.tally;
  /** For whoever looks: approve it, or who does. */
  const waitingChip = (d: LibraryDoc) => {
    const v = d.open!;
    if (approver && canReview(ctx.person, v, docReach(d, sites), d.kind).ok) return { text: d.published ? "New version" : "New SOP", tone: "late" };
    if (approver && isContributor(ctx.person, v)) return { text: "Another approver checks it", tone: "" };
    if (approver) return { text: "The owner approves it", tone: "" };
    return { text: "Waiting", tone: "" };
  };
  const row = (d: LibraryDoc, note: string, chip?: { text: string; tone: string }) => (
    <Link key={d.id} href={`/library/${d.id}/draft`} className="list-btn lib-item">
      <span className="grow">
        <span className="strong" style={{ display: "block" }}>{d.open!.title}</span>
        <span className="muted"><span className="lib-code">{d.code}</span> · {note}</span>
      </span>
      {chip && <span className="chips"><span className={`chip ${chip.tone}`}>{chip.text}</span></span>}
    </Link>
  );
  const Bar = full ? TopBar : PhoneTopBar;

  return (
    <>
      <Bar ctx={ctx} title="Library" eyebrow="How we do things · SOPs">
        {writer && <Link className="pill-btn top-extra" href="/library/new" style={{ background: "var(--amber)", color: "var(--amber-ink)" }}>New SOP</Link>}
      </Bar>
      <main className="wide">
        <LibraryTabs current="sops" recipes={recipes} />
        <div className="cols two">
          <div className="stack" style={{ gap: 14 }}>
            <MustRead docs={toRead} allergens={allergenChanges} />

            {waiting.length > 0 && (
              <section className="stack" aria-label="Waiting for approval" style={{ gap: 8 }}>
                <h2 className="grp-h">Waiting for approval <span>{waiting.length}</span></h2>
                {!approver && <div className="muted">The owner or an operations manager approves them. To change one, open it and take it back.</div>}
                {waiting.map((d) => row(d, `${d.open!.authorName}${d.open!.submittedAt ? ` · sent ${when(d.open!.submittedAt)}` : ""}`, waitingChip(d)))}
              </section>
            )}

            {drafts.length > 0 && (
              <section className="stack" aria-label="Drafts" style={{ gap: 8 }}>
                <h2 className="grp-h">Drafts <span>{drafts.length}</span></h2>
                {drafts.map((d) => row(d, `${d.open!.authorName} · changed ${when(d.open!.updatedAt)}`, d.open!.reviewNote ? { text: "Sent back", tone: "late" } : { text: "Draft", tone: "" }))}
              </section>
            )}

            <LibraryList items={items} sections={mySections} />

            {retired.length > 0 && (
              <details className="card">
                <summary className="strong" style={{ cursor: "pointer" }}>Retired ({retired.length})</summary>
                <div className="stack" style={{ marginTop: 10 }}>
                  {retired.map((d) => (
                    <Link key={d.id} href={`/library/${d.id}`} className="row" style={{ gap: 8 }}>
                      <span className="grow">{d.published!.title}</span><span className="muted lib-code">{d.code}</span>
                    </Link>
                  ))}
                </div>
              </details>
            )}
          </div>

          <aside className="aside panel">
            {recipes && (
              <Link href="/library/recipes" className="card stack" style={{ gap: 8, textDecoration: "none" }}>
                <div className="row"><span className="h-sec grow" style={{ fontSize: 17 }}>Recipe handbook</span><Icon name="book" /></div>
                <div className="row" style={{ gap: 18 }}>
                  <span className="stack" style={{ gap: 0 }}><span className="stat" style={{ fontSize: 28 }}>{published(preps)}</span><span className="muted">prep recipes</span></span>
                  <span className="stack" style={{ gap: 0 }}><span className="stat" style={{ fontSize: 28 }}>{published(dishes)}</span><span className="muted">dish specs</span></span>
                </div>
                <div className="muted">Kitchen only. One-screen cards, scaled amounts, print A4.</div>
              </Link>
            )}
            <Link href="/library/allergens" className="card stack" style={{ gap: 8, textDecoration: "none" }}>
              <div className="row"><span className="h-sec grow" style={{ fontSize: 17 }}>Allergen matrix</span>{allergenChanges.length > 0 && <span className="chip late">{allergenChanges.length} to confirm</span>}</div>
              <div className="muted">Every dish against the 14 allergens, and &ldquo;a guest avoids…&rdquo; for a quick answer at the table.</div>
            </Link>
            <Link href="/library/training" className="card stack" style={{ gap: 8, textDecoration: "none" }}>
              <div className="row"><span className="h-sec grow" style={{ fontSize: 17 }}>Training</span>{t.overdue > 0 ? <span className="chip bad">{t.overdue} overdue</span> : t.again > 0 ? <span className="chip warn">{t.again} to do again</span> : null}</div>
              {t.total > 0 && <div className="train-bar"><i style={{ width: `${Math.round((t.done / t.total) * 100)}%` }} /></div>}
              <div className="muted">{t.total > 0 ? `Your passport: ${t.done} of ${t.total} skills` : "Skills, quizzes and refreshers for your section."}</div>
            </Link>
            {writer && (
              <div className="card stack" style={{ gap: 6 }}>
                <div className="eyebrow" style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, fontSize: 12 }}>For managers</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {waiting.length ? `${waiting.length} version${waiting.length > 1 ? "s" : ""} waiting for approval. ` : "Nothing waiting for approval. "}
                  {approver ? "You can approve what you didn't write or send." : "The owner or an operations manager approves."}
                </div>
                <Link className="btn ghost small" href="/library/new" style={{ alignSelf: "flex-start" }}>New SOP</Link>
              </div>
            )}
          </aside>
        </div>
      </main>
      {full && <BottomNav ctx={ctx} current="library" />}
    </>
  );
}
