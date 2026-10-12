import Link from "next/link";
import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { canApprove, canDraft, canReview, mustRead, readsAny, reviewState, versionLabel, type LibraryDoc } from "@/lib/domain/library";
import { sectionsFor } from "@/lib/domain/staff";
import { londonDate } from "@/lib/domain/time";
import { current } from "@/lib/session";
import { BottomNav, PhoneTopBar, TopBar } from "@/components/Chrome";
import { MustRead } from "@/components/MustRead";
import { LibraryList, type LibItem } from "./LibraryList";
import { dayMonth as when, whoFor } from "./format";

export const dynamic = "force-dynamic";


/**
 * The SOP library: on the shop tablet and staff's own phones. Everyone reads published SOPs; managers also see drafts,
 * and owners and operations managers what's waiting for their approval.
 */
export default async function Library() {
  const ctx = await current();
  if (!ctx) redirect("/login");
  if (ctx.person.pinMustChange) redirect("/pin");
  const db = store();
  const [docs, myAcks, sites] = await Promise.all([db.libraryDocs("sop"), db.libraryAcks({ personId: ctx.person.id }), db.sites()]);
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
  const waiting = approver ? docs.filter((d) => open(d) && d.open!.status === "in_review") : [];
  const drafts = writer ? docs.filter((d) => open(d) && d.open!.status === "draft") : [];
  const retired = writer ? docs.filter((d) => d.retiredAt) : [];
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
            {waiting.map((d) => {
              const mine = !canReview(ctx.person, d.open!).ok;
              return row(d, `sent by ${d.open!.authorName}${d.open!.submittedAt ? ` on ${when(d.open!.submittedAt)}` : ""}`,
                mine ? { text: "Another approver checks this", tone: "" } : { text: d.published ? "New version" : "New SOP", tone: "late" });
            })}
          </section>
        )}

        {drafts.length > 0 && (
          <section className="stack" aria-label="Drafts">
            <h2 className="h-sec">Drafts ({drafts.length})</h2>
            {drafts.map((d) => row(d, `${d.open!.authorName} · changed ${when(d.open!.updatedAt)}`, d.open!.reviewNote ? { text: "Sent back", tone: "late" } : { text: "Draft", tone: "" }))}
          </section>
        )}

        {writer && !approver && docs.some((d) => open(d) && d.open!.status === "in_review") && (
          <div className="muted">Waiting for approval: {docs.filter((d) => open(d) && d.open!.status === "in_review").map((d) => d.open!.title).join(", ")}. The owner or an operations manager approves them.</div>
        )}

        <LibraryList items={items} sections={mySections} />

        {retired.length > 0 && (
          <details className="card">
            <summary className="strong" style={{ cursor: "pointer" }}>Retired ({retired.length})</summary>
            <div className="stack" style={{ marginTop: 10 }}>
              {retired.map((d) => (
                <Link key={d.id} href={`/library/${d.id}`} className="row" style={{ gap: 8 }}>
                  <span className="grow">{d.published?.title ?? d.open?.title ?? d.code}</span><span className="muted lib-code">{d.code}</span>
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
