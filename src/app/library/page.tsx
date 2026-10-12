import Link from "next/link";
import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { canApprove, canDraft, canReview, isContributor, mustRead, reachedSites, readsAny, reviewState, versionLabel, type LibraryDoc } from "@/lib/domain/library";
import { sectionsFor } from "@/lib/domain/staff";
import { londonDate } from "@/lib/domain/time";
import { current } from "@/lib/session";
import { BottomNav, PhoneTopBar, TopBar } from "@/components/Chrome";
import { MustRead } from "@/components/MustRead";
import { LibraryList, type LibItem } from "./LibraryList";
import { dayMonth as when, whoFor } from "./format";

export const dynamic = "force-dynamic";

/**
 * The SOP library: on the shop tablet and staff's own phones. Everyone reads published SOPs; managers also see drafts
 * and what's waiting for approval, which owners and operations managers approve.
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
  /** For whoever looks: approve it, or who does. */
  const waitingChip = (d: LibraryDoc) => {
    const v = d.open!;
    if (approver && canReview(ctx.person, v, reachedSites(v.body.sections, sites)).ok) return { text: d.published ? "New version" : "New SOP", tone: "late" };
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

  return (
    <>
      {full ? <TopBar ctx={ctx} /> : <PhoneTopBar ctx={ctx} />}
      <main>
        <div className="row wrap" style={{ alignItems: "flex-end" }}>
          <div className="grow"><div className="eyebrow">How we do things · SOPs</div><h1 className="h-display">Library</h1></div>
          {writer && <Link className="btn accent small" href="/library/new">New SOP</Link>}
        </div>

        <MustRead docs={toRead} />

        {waiting.length > 0 && (
          <section className="stack" aria-label="Waiting for approval">
            <h2 className="h-sec">Waiting for approval ({waiting.length})</h2>
            {!approver && <div className="muted">The owner or an operations manager approves them. To change one, open it and take it back.</div>}
            {waiting.map((d) => row(d, `${d.open!.authorName}${d.open!.submittedAt ? ` · sent ${when(d.open!.submittedAt)}` : ""}`, waitingChip(d)))}
          </section>
        )}

        {drafts.length > 0 && (
          <section className="stack" aria-label="Drafts">
            <h2 className="h-sec">Drafts ({drafts.length})</h2>
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
      </main>
      {full && <BottomNav ctx={ctx} current="library" />}
    </>
  );
}
