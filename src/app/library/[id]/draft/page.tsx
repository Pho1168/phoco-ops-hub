import { notFound, redirect } from "next/navigation";
import { store } from "@/lib/data";
import { approvesKind, canDiscard, canDraft, canReview, canWithdraw, defaultReviewBy, docReach, isKind, KIND_TEXT, ownerApproves, reachedSites, readsAt, type LibraryDoc, type SopBody } from "@/lib/domain/library";
import { ALLERGEN_NAME, alertedAt, allergenChanges, dishesAtOdds, dishWarnings, type DishBody, type PrepBody, type RecipeKind } from "@/lib/domain/recipes";
import { addDays, londonDate } from "@/lib/domain/time";
import { requireCtx } from "@/lib/session";
import { erasedPhotos, recipeLinks } from "@/lib/library-service";
import { TopBar } from "@/components/Chrome";
import { SopView } from "../../SopView";
import { SopEditor } from "../../SopEditor";
import { RecipeEditor } from "../../RecipeEditor";
import { RecipeBodyView } from "../../RecipeBodyView";
import { AllergenChanges } from "../../RecipeParts";
import { dayMonthYearAt, whoFor } from "../../format";
import { editorLists } from "../../editor-lists";
import { ReviewPanel, TakeBack } from "./ReviewPanel";

export const dynamic = "force-dynamic";

/**
 * The open version of an SOP, prep recipe or dish (managers, owners, operations managers; full app): a draft to edit
 * and send for approval, or one waiting for approval, which an approver publishes or sends back. The approver sees
 * who it will reach first: who reads an SOP, and for a dish whose allergens change, who will confirm it.
 */
export default async function LibraryDraft(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await requireCtx();
  if (!canDraft(ctx.person)) redirect(`/library/${id}`);
  const db = store();
  const doc = await db.libraryDoc(id);
  if (!doc) notFound();
  const home = doc.kind === "sop" ? "/library" : "/library/recipes";
  const v = doc.open;
  if (!v || doc.retiredAt) redirect(doc.published ? `/library/${doc.id}` : home);
  const today = londonDate(Date.now());
  const [gone, sites] = await Promise.all([erasedPhotos(v.body as SopBody | PrepBody, db), db.sites()]);
  const covers = docReach(doc, sites); // the sites it covers, before and after this version
  const what = KIND_TEXT[doc.kind].toLowerCase();
  const bar = (
    <TopBar ctx={ctx} title={v.status === "draft" ? "Draft" : "Waiting for approval"} back={doc.published ? `/library/${doc.id}` : home}
      eyebrow={<><span className="lib-code">{doc.code}</span> · {doc.published ? `new version (now on version ${doc.published.version})` : `new ${what}`}</>} />
  );
  const head = (
    <div className="muted">Written by {v.authorName}{doc.published ? ". Staff keep seeing the published version until this one is approved." : ". Staff can't see it until it's approved."}</div>
  );

  if (v.status === "draft") {
    const discard = canDiscard(ctx.person, v, covers, doc.kind).ok;
    return (
      <>
        {bar}
        <main>
          {head}
          {v.reviewNote && (
            <div className="alert" role="status"><div className="grow"><div className="strong">Sent back by {v.reviewedByName}{v.reviewedAt ? ` on ${dayMonthYearAt(v.reviewedAt)}` : ""}</div>
              <div style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>&ldquo;{v.reviewNote}&rdquo;</div></div></div>
          )}
          {/* A new revision (someone else saved, or "Load the latest") starts the editor afresh. */}
          {isKind(doc, "sop")
            ? <SopEditor key={v.rev} mode="draft" docId={doc.id} versionId={v.id} rev={v.rev} published={!!doc.published} initial={{ title: v.title, body: v.body as SopBody }}
                erased={gone} canDiscard={discard} personId={ctx.person.id} />
            : <RecipeEditor key={v.rev} kind={doc.kind as RecipeKind} mode="draft" docId={doc.id} versionId={v.id} rev={v.rev} published={!!doc.published}
                initial={{ title: v.title, body: v.body as PrepBody | DishBody }} erased={gone} canDiscard={discard} personId={ctx.person.id}
                {...await editorLists(doc.kind as RecipeKind, db)} />}
        </main>
      </>
    );
  }

  // Waiting for approval: who it reaches, any site it would be taken away from, and whether the approver may approve it.
  const people = await db.people();
  const after = reachedSites(v.body.sections, sites);
  const dropped = doc.published ? sites.filter((s) => reachedSites(doc.published!.body.sections, sites).includes(s.id) && !after.includes(s.id)).map((s) => s.name) : [];
  const review = canReview(ctx.person, v, covers, doc.kind);
  const takeBack = canWithdraw(ctx.person, v, covers, doc.kind).ok;
  const reviewBy = defaultReviewBy(today), tomorrow = addDays(today, 1);
  const approver = ownerApproves(doc.kind) ? "The owner" : "The owner or an operations manager";
  const verdict = review.ok ? null : (
    <div className="muted">{approvesKind(ctx.person, doc.kind) ? review.error
      : takeBack ? `${approver} approves it. To change it, take it back first.`
      : `${approver} approves it. Until then it can't be changed: ${v.authorName} can take it back.`}</div>
  );
  const droppedLine = dropped.length > 0 && <div className="strong" style={{ color: "var(--bad-ink)" }}>It will no longer be for {dropped.join(" or ")}: their staff stop seeing it.</div>;

  if (isKind(doc, "sop")) {
    const reach = sites.filter((s) => s.status === "open")
      .map((s) => ({ site: s.name, n: people.filter((p) => readsAt(v.body.sections, p, s)).length })).filter((x) => x.n > 0);
    return (
      <>
        {bar}
        <main>
          {head}
          <div className="card stack" style={{ gap: 4 }}>
            <div className="strong">{v.title}</div>
            <div className="muted">For: {whoFor(v.body.sections)} · sent {v.submittedAt ? `on ${dayMonthYearAt(v.submittedAt)}` : ""}</div>
            <div className="muted">Once published, {reach.length ? reach.map((r) => `${r.n} at ${r.site}`).join(" and ") : "nobody yet"} will be asked to read it.</div>
            {droppedLine}
          </div>
          <SopView body={v.body as SopBody} title={v.title} erased={gone} eraseIn={ctx.isOwner ? doc.id : undefined} />
          {review.ok ? <ReviewPanel docId={doc.id} versionId={v.id} rev={v.rev} hasPublished={!!doc.published} reviewBy={reviewBy} tomorrow={tomorrow} /> : verdict}
          {takeBack && <TakeBack versionId={v.id} rev={v.rev} />}
        </main>
      </>
    );
  }

  // A recipe: for a dish, what its allergens change and who will be asked to confirm; things to check first.
  const kind = doc.kind as RecipeKind;
  const body = v.body as PrepBody | DishBody;
  const [links, preps, dishes] = await Promise.all([recipeLinks(body, db), kind === "dish" ? db.libraryDocs("prep") : Promise.resolve([] as LibraryDoc<PrepBody>[]),
    kind === "prep" ? db.libraryDocs("dish") : Promise.resolve([] as LibraryDoc<DishBody>[])]);
  const changes = kind === "dish" && doc.published ? allergenChanges((doc.published.body as DishBody).allergens, (body as DishBody).allergens) : [];
  const alerted = changes.length ? sites.filter((s) => after.includes(s.id)).map((s) => ({ site: s.name, n: people.filter((p) => alertedAt(p, body.sections, [s]).length).length })) : [];
  // Things to check, not stop: a dish that disagrees with its tags or prep recipes; dishes this prep recipe would now disagree with.
  const warnings = kind === "dish"
    ? dishWarnings(body as DishBody, new Map(preps.flatMap((p) => (p.published ? [[p.id, { title: p.published.title, allergens: p.published.body.allergens, retired: !!p.retiredAt }]] : []))))
    : dishesAtOdds(doc.id, body.allergens, dishes).map((d) => `${d.title} (${d.code}) uses it but is marked free from ${d.missed.map((k) => ALLERGEN_NAME[k].toLowerCase()).join(" and ")}: give it a new version once this is published`);
  const asks = kind === "dish" && changes.length ? "Its allergens change, so everyone at its sites will be asked to confirm they've seen it." : "";
  return (
    <>
      {bar}
      <main className="recipe-page">
        {head}
        <div className="card stack" style={{ gap: 4 }}>
          <div className="strong">{v.title}</div>
          <div className="muted">{body.category ? `${body.category} · ` : ""}{kind === "prep" ? "Made by" : "Built by"}: {whoFor(body.sections)} · sent {v.submittedAt ? `on ${dayMonthYearAt(v.submittedAt)}` : ""}</div>
          {kind === "dish" && (doc.published
            ? changes.length
              ? <div className="stack" style={{ gap: 4 }}><div className="strong">Its allergens change:</div><AllergenChanges changes={changes} />
                  <div className="muted">Once published, {alerted.map((a) => `${a.n} at ${a.site}`).join(" and ") || "nobody yet"} will be asked to confirm they&apos;ve seen the change.</div></div>
              : <div className="muted">Its allergens don&apos;t change.</div>
            : <div className="muted">A new dish: once published, it goes on the allergen matrix.</div>)}
          {droppedLine}
        </div>
        {warnings.length > 0 && (
          <div className="alert" role="status"><div className="grow stack" style={{ gap: 4 }}><div className="strong">Check before approving</div>
            {warnings.map((w) => <div key={w} style={{ fontSize: 14 }}>{w}</div>)}</div></div>
        )}
        <RecipeBodyView kind={kind} title={v.title} code={doc.code} body={body} links={links} gone={gone} eraseIn={ctx.isOwner ? doc.id : undefined}
          stamp="Waiting for approval: not in use yet" />
        {review.ok
          ? <ReviewPanel docId={doc.id} versionId={v.id} rev={v.rev} hasPublished={!!doc.published} reviewBy={reviewBy} tomorrow={tomorrow} asks={asks}
              changeNote="A major change is marked as one, so managers go through it with the kitchen." />
          : verdict}
        {takeBack && <TakeBack versionId={v.id} rev={v.rev} />}
      </main>
    </>
  );
}
