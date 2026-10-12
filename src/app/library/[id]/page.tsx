import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { store } from "@/lib/data";
import { managedSites } from "@/lib/domain/access";
import { canDraft, canReinstate, canRetire, CHANGE_TEXT, docReach, isKind, readStats, readsAny, reviewState, STATUS_TEXT, versionLabel, type LibraryDoc, type LibraryVersion, type SopBody } from "@/lib/domain/library";
import type { DishBody, PrepBody } from "@/lib/domain/recipes";
import { dayMonthYear, londonDate } from "@/lib/domain/time";
import { current } from "@/lib/session";
import { erasedPhotos } from "@/lib/library-service";
import { BottomNav, PhoneTopBar, TopBar } from "@/components/Chrome";
import { SopView } from "../SopView";
import { dayMonthYearAt, whoFor } from "../format";
import { StepMode } from "./StepMode";
import { AckButton, EditButton, RetireButton } from "./SopButtons";
import { RecipeDoc } from "./RecipeDoc";

export const dynamic = "force-dynamic";

/**
 * One SOP: the published version for everyone it's for (tablet or own phone), with "I've read it". Managers also see
 * who has read it at their sites, any draft in progress, and every past version (?v=<version id>). Recipes have their
 * own page (RecipeDoc).
 */
export default async function SopPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }) {
  const [{ id }, { v: wanted }] = await Promise.all([props.params, props.searchParams]);
  const ctx = await current();
  if (!ctx) redirect("/login");
  if (ctx.person.pinMustChange) redirect("/pin");
  const db = store();
  const found = await db.libraryDoc(id);
  if (!found) notFound();
  if (!isKind(found, "sop")) return <RecipeDoc ctx={ctx} doc={found as LibraryDoc<PrepBody | DishBody>} wanted={wanted} />;
  const doc = found;
  const full = ctx.scope === "full";
  const writer = full && canDraft(ctx.person);
  if (doc.retiredAt && !writer) notFound();
  let v: LibraryVersion<SopBody> | undefined = doc.published;
  if (wanted && writer) {
    const other = await db.libraryVersion(wanted);
    if (other && other.docId === doc.id && (other.status === "published" || other.status === "superseded")) v = other as LibraryVersion<SopBody>;
  }
  if (!v) {
    if (writer && doc.open && !doc.retiredAt) redirect(`/library/${doc.id}/draft`); // never published: the draft is all there is
    notFound();
  }
  const isCurrent = v.id === doc.published?.id && !doc.retiredAt;
  const [sites, gone] = await Promise.all([db.sites(), erasedPhotos(v.body, db)]);
  const forMe = isCurrent && readsAny(v.body.sections, ctx.person, sites);
  const [mine] = await db.libraryAcks({ versionIds: [v.id], personId: ctx.person.id });
  const watched = ctx.isOwner ? sites : sites.filter((s) => managedSites(ctx.person).includes(s.id));
  const [people, acks, history] = writer
    ? await Promise.all([db.people(), db.libraryAcks({ versionIds: [v.id] }), db.libraryVersions(doc.id)])
    : [[], [], []];
  const stats = writer ? readStats(v.body.sections, v.id, people, acks, watched).filter((s) => s.read.length + s.unread.length > 0) : [];
  const today = londonDate(Date.now());
  const review = writer && isCurrent ? reviewState(v.reviewBy, today) : undefined;
  // Retiring or bringing back: approvers for every site it covers.
  const retiring = full && (doc.retiredAt ? canReinstate : canRetire)(ctx.person, doc, docReach(doc, sites)).ok;

  return (
    <>
      {full ? <TopBar ctx={ctx} /> : <PhoneTopBar ctx={ctx} />}
      <main>
        <Link href="/library" className="muted" style={{ fontWeight: 600 }}>← Library</Link>
        <div className="stack" style={{ gap: 6 }}>
          <div className="eyebrow"><span className="lib-code">{doc.code}</span> · version {v.version}{v.change && v.change !== "new" ? ` · ${CHANGE_TEXT[v.change]}` : ""}</div>
          <h1 className="h-display">{v.title}</h1>
          <div className="muted">For: {whoFor(v.body.sections)} · approved by {v.approvedByName} on {dayMonthYearAt(v.publishedAt!)}{writer && v.reviewBy ? ` · review by ${dayMonthYear(v.reviewBy)}` : ""}</div>
        </div>

        {doc.retiredAt && <div className="alert bad" role="status"><div className="grow"><div className="strong">Retired on {dayMonthYearAt(doc.retiredAt)}</div>{doc.retiredNote && <div style={{ fontSize: 13 }}>{doc.retiredNote}</div>}</div></div>}
        {!doc.retiredAt && !isCurrent && (
          <div className="alert" role="status"><div className="grow"><div className="strong">An old version (replaced{v.supersededAt ? ` on ${dayMonthYearAt(v.supersededAt)}` : ""})</div>
            <Link href={`/library/${doc.id}`} style={{ fontSize: 13 }}>See the current version</Link></div></div>
        )}
        {review && <div className={`alert ${review === "overdue" ? "bad" : ""}`} role="status"><div className="grow"><div className="strong">{review === "overdue" ? "Review overdue" : "Review due soon"}</div>
          <div style={{ fontSize: 13 }}>Check it still matches how things are done, then publish a new version (even if little changes).</div></div></div>}
        {writer && doc.open && !doc.retiredAt && (
          <Link href={`/library/${doc.id}/draft`} className="list-btn">
            <span className="grow"><span className="strong" style={{ display: "block" }}>A new version is being written</span>
              <span className="muted">{versionLabel(doc.open)} · {doc.open.authorName}</span></span>
            <span className="chip late">Open</span>
          </Link>
        )}

        {isCurrent && <div className="row wrap"><StepMode title={v.title} steps={v.body.steps.map((s) => (s.photo && gone.includes(s.photo.id) ? { text: s.text, warning: s.warning } : s))} /></div>}
        <SopView body={v.body} title={v.title} erased={gone} eraseIn={full && ctx.isOwner ? doc.id : undefined} />

        {forMe && (mine
          ? <div className="alert good" role="status"><div className="grow"><div className="strong">You&apos;ve read this version</div><div style={{ fontSize: 13 }}>Confirmed on {dayMonthYearAt(mine.at)}</div></div></div>
          : <section className="card stack" aria-label="Confirm"><div className="strong">Read it all?</div><div className="muted">Confirm you&apos;ve read and understood this version. Your manager can see who has.</div><AckButton versionId={v.id} /></section>)}

        {stats.length > 0 && (
          <section className="card stack" aria-label="Who has read it">
            <h2 className="h-sec">Who has read it</h2>
            {stats.map((s) => (
              <div key={s.siteId} className="stack" style={{ gap: 4 }}>
                <div className="strong">{s.siteName}: {s.read.length} of {s.read.length + s.unread.length}</div>
                {s.unread.length > 0 && <div className="muted">Not yet: {s.unread.map((p) => p.name).join(", ")}</div>}
              </div>
            ))}
          </section>
        )}

        {writer && (
          <section className="card stack" aria-label="Versions">
            <div className="row wrap"><h2 className="h-sec grow">Versions</h2>
              {!doc.retiredAt && <EditButton docId={doc.id} hasDraft={!!doc.open} />}
              {retiring && <RetireButton docId={doc.id} retired={!!doc.retiredAt} title={v.title} hasDraft={!!doc.open} />}
            </div>
            <div className="log">
              {history.filter((h) => h.status !== "discarded").map((h) => (
                <div key={h.id} style={{ alignItems: "center" }}>
                  <span className="grow">
                    {h.status === "published" || h.status === "superseded"
                      ? <Link href={h.status === "published" ? `/library/${doc.id}` : `/library/${doc.id}?v=${h.id}`}>Version {h.version}</Link>
                      : <Link href={`/library/${doc.id}/draft`}>New version</Link>}
                    <span className="muted"> · {h.publishedAt ? `${CHANGE_TEXT[h.change ?? "new"]} · approved by ${h.approvedByName} on ${dayMonthYearAt(h.publishedAt)} · written by ${h.authorName}` : `${h.authorName}`}</span>
                  </span>
                  <span className={`chip ${h.status === "published" ? "done" : ""}`}>{h.status === "draft" || h.status === "in_review" ? versionLabel(h) : STATUS_TEXT[h.status]}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
      {full && <BottomNav ctx={ctx} current="library" />}
    </>
  );
}
