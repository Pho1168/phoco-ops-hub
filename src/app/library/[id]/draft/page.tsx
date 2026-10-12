import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { store } from "@/lib/data";
import { canApprove, canDiscard, canDraft, canReview, canWithdraw, defaultReviewBy, readsAt } from "@/lib/domain/library";
import { addDays, londonDate } from "@/lib/domain/time";
import { requireCtx } from "@/lib/session";
import { TopBar } from "@/components/Chrome";
import { SopView } from "../../SopView";
import { SopEditor } from "../../SopEditor";
import { dayMonthYearAt, whoFor } from "../../format";
import { ReviewPanel, TakeBack } from "./ReviewPanel";

export const dynamic = "force-dynamic";

/**
 * The open version of an SOP (managers, owners, operations managers; full app): a draft to edit and send for approval,
 * or one waiting for approval, which an approver publishes or sends back.
 */
export default async function SopDraft(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await requireCtx();
  if (!canDraft(ctx.person)) redirect(`/library/${id}`);
  const db = store();
  const doc = await db.libraryDoc(id);
  if (!doc) notFound();
  const v = doc.open;
  if (!v || doc.retiredAt) redirect(doc.published ? `/library/${doc.id}` : "/library");
  const today = londonDate(Date.now());
  const head = (
    <>
      <Link href={doc.published ? `/library/${doc.id}` : "/library"} className="muted" style={{ fontWeight: 600 }}>← {doc.published ? doc.published.title : "Library"}</Link>
      <div className="stack" style={{ gap: 6 }}>
        <div className="eyebrow"><span className="lib-code">{doc.code}</span> · {doc.published ? `new version (now on version ${doc.published.version})` : "new SOP"}</div>
        <h1 className="h-display">{v.status === "draft" ? "Draft" : "Waiting for approval"}</h1>
        <div className="muted">Written by {v.authorName}{doc.published ? ". Staff keep seeing the published version until this one is approved." : ". Staff can't see it until it's approved."}</div>
      </div>
    </>
  );

  if (v.status === "draft") {
    return (
      <>
        <TopBar ctx={ctx} />
        <main>
          {head}
          {v.reviewNote && (
            <div className="alert" role="status"><div className="grow"><div className="strong">Sent back by {v.reviewedByName}{v.reviewedAt ? ` on ${dayMonthYearAt(v.reviewedAt)}` : ""}</div>
              <div style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>&ldquo;{v.reviewNote}&rdquo;</div></div></div>
          )}
          <SopEditor mode="draft" docId={doc.id} versionId={v.id} initial={{ title: v.title, body: v.body }} canDiscard={canDiscard(ctx.person, v).ok} />
        </main>
      </>
    );
  }

  // Waiting for approval: how many people it will go to, site by site.
  const [sites, people] = await Promise.all([db.sites(), db.people()]);
  const reach = sites.filter((s) => s.status === "open")
    .map((s) => ({ site: s.name, n: people.filter((p) => readsAt(v.body.sections, p, s)).length })).filter((x) => x.n > 0);
  const review = canReview(ctx.person, v);
  return (
    <>
      <TopBar ctx={ctx} />
      <main>
        {head}
        <div className="card stack" style={{ gap: 4 }}>
          <div className="strong">{v.title}</div>
          <div className="muted">For: {whoFor(v.body.sections)} · sent {v.submittedAt ? `on ${dayMonthYearAt(v.submittedAt)}` : ""}</div>
          <div className="muted">Once published, {reach.length ? reach.map((r) => `${r.n} at ${r.site}`).join(" and ") : "nobody yet"} will be asked to read it.</div>
        </div>
        <SopView body={v.body} title={v.title} />
        {review.ok
          ? <ReviewPanel docId={doc.id} versionId={v.id} hasPublished={!!doc.published} reviewBy={defaultReviewBy(today)} tomorrow={addDays(today, 1)} />
          : <div className="muted">{canApprove(ctx.person) ? review.error : "The owner or an operations manager approves it. Until then it can't be changed: take it back first."}</div>}
        {canWithdraw(ctx.person, v).ok && <TakeBack versionId={v.id} />}
      </main>
    </>
  );
}
