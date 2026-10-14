import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { store } from "@/lib/data";
import { canDraft, canReinstate, canRetire, CHANGE_TEXT, docReach, KIND_TEXT, reviewState, STATUS_TEXT, versionLabel, type LibraryDoc, type LibraryVersion } from "@/lib/domain/library";
import { alertStats, dishWarnings, seesRecipes, type DishBody, type PrepBody, type RecipeKind } from "@/lib/domain/recipes";
import { dayMonthYear, londonDate } from "@/lib/domain/time";
import type { Ctx } from "@/lib/session";
import { erasedPhotos, recipeLinks } from "@/lib/library-service";
import { BottomNav, TopBar } from "@/components/Chrome";
import { RecipeBodyView } from "../RecipeBodyView";
import { dayMonthYearAt } from "../format";
import { EditButton, RetireButton } from "./SopButtons";

const WHO: Record<string, string> = { BOH: "Back of house", PROD: "Production" };
const who = (sections: string[]) => sections.map((s) => WHO[s] ?? s).join(" and ");

/**
 * One prep recipe or dish spec, on the full app, for kitchen staff it's for and for writers: what it makes or what's
 * in a portion (scaled to any size), the method, storage and shelf life, the finished photo and its allergens.
 * Writers also see who has confirmed a dish's allergen change, any draft in progress, and past versions.
 * Anyone else (front of house, own phones) is sent to the dish's allergens instead.
 */
export async function RecipeDoc({ ctx, doc, wanted }: { ctx: Ctx; doc: LibraryDoc<PrepBody | DishBody>; wanted?: string }) {
  const kind = doc.kind as RecipeKind;
  const db = store();
  function toAllergens(): never {
    if (kind === "dish") redirect(`/library/allergens/${doc.id}`);
    notFound();
  }
  if (ctx.scope !== "full") toAllergens();
  const writer = canDraft(ctx.person);
  if (doc.retiredAt && !writer) toAllergens();
  let v: LibraryVersion<PrepBody | DishBody> | undefined = doc.published;
  if (wanted && writer) {
    const other = await db.libraryVersion(wanted);
    if (other && other.docId === doc.id && (other.status === "published" || other.status === "superseded")) v = other as LibraryVersion<PrepBody | DishBody>;
  }
  if (!v) {
    if (writer && doc.open && !doc.retiredAt) redirect(`/library/${doc.id}/draft`); // never published: the draft is all there is
    notFound();
  }
  const sites = await db.sites();
  if (!seesRecipes(ctx.person, sites)) toAllergens();

  const isCurrent = v.id === doc.published?.id && !doc.retiredAt;
  const [gone, links, history] = await Promise.all([erasedPhotos(v.body, db), recipeLinks(v.body, db), writer ? db.libraryVersions(doc.id) : Promise.resolve([])]);
  const changedAt = isCurrent && kind === "dish" ? v.allergensChangedAt : undefined;
  const stats = writer && changedAt
    ? alertStats(v.body.sections, doc.id, changedAt, await db.people(), await db.libraryAcks({ docId: doc.id }), sites)
      .filter((s) => ctx.isOwner || ctx.person.access.some((a) => a.siteId === s.siteId))
    : [];
  const review = writer && isCurrent ? reviewState(v.reviewBy, londonDate(Date.now())) : undefined;
  // Writers: a dish that now disagrees with its prep recipes (say the broth changed since) needs a new version.
  const warnings = writer && isCurrent && kind === "dish"
    ? dishWarnings(v.body as DishBody, new Map((await db.libraryDocs("prep")).flatMap((p) => (p.published ? [[p.id, { title: p.published.title, allergens: p.published.body.allergens, retired: !!p.retiredAt }]] : []))))
    : [];
  const retiring = (doc.retiredAt ? canReinstate : canRetire)(ctx.person, doc, docReach(doc, sites)).ok;
  const eraseIn = ctx.isOwner ? doc.id : undefined;

  return (
    <>
      <TopBar ctx={ctx} title={kind === "prep" ? "Prep recipe" : "Dish spec"} eyebrow={<><span className="lib-code">{doc.code}</span> · version {v.version}{isCurrent ? "" : " · not in use"}</>} back="/library/recipes" />
      <main className="recipe-page">

        {doc.retiredAt && <div className="alert bad" role="status"><div className="grow"><div className="strong">Retired on {dayMonthYearAt(doc.retiredAt)}</div>{doc.retiredNote && <div style={{ fontSize: 13 }}>{doc.retiredNote}</div>}</div></div>}
        {!doc.retiredAt && !isCurrent && (
          <div className="alert" role="status"><div className="grow"><div className="strong">An old version (replaced{v.supersededAt ? ` on ${dayMonthYearAt(v.supersededAt)}` : ""})</div>
            <Link href={`/library/${doc.id}`} style={{ fontSize: 13 }}>See the current version</Link></div></div>
        )}
        {review && <div className={`alert ${review === "overdue" ? "bad" : ""}`} role="status"><div className="grow"><div className="strong">{review === "overdue" ? "Review overdue" : "Review due soon"}</div>
          <div style={{ fontSize: 13 }}>Check it still matches how it&apos;s made, then publish a new version (even if little changes).</div></div></div>}
        {writer && doc.open && !doc.retiredAt && (
          <Link href={`/library/${doc.id}/draft`} className="list-btn">
            <span className="grow"><span className="strong" style={{ display: "block" }}>A new version is being written</span>
              <span className="muted">{versionLabel(doc.open)} · {doc.open.authorName}</span></span>
            <span className="chip late">Open</span>
          </Link>
        )}

        {warnings.length > 0 && (
          <div className="alert bad" role="status"><div className="grow stack" style={{ gap: 4 }}><div className="strong">Needs a new version</div>
            {warnings.map((w) => <div key={w} style={{ fontSize: 14 }}>{w}</div>)}</div></div>
        )}
        <RecipeBodyView kind={kind} title={v.title} code={doc.code} version={v.version} body={v.body} links={links} gone={gone} eraseIn={eraseIn} stepMode={isCurrent}
          stamp={doc.retiredAt ? "Retired: not in use" : isCurrent ? undefined : "Replaced version: not in use"} />
        <div className="muted rc-after">{KIND_TEXT[kind]} · version {v.version}{v.change && v.change !== "new" ? ` (${CHANGE_TEXT[v.change].toLowerCase()})` : ""} ·{" "}
          {kind === "prep" ? "made by" : "built by"} {who(v.body.sections).toLowerCase()} · approved by {v.approvedByName} on {dayMonthYearAt(v.publishedAt!)}
          {writer && v.reviewBy ? ` · review by ${dayMonthYear(v.reviewBy)}` : ""}</div>

        {stats.length > 0 && (
          <section className="card stack" aria-label="Allergen change confirmed">
            <h2 className="h-sec">Allergen change of {dayMonthYearAt(changedAt!)}</h2>
            {stats.map((s) => (
              <div key={s.siteId} className="stack" style={{ gap: 4 }}>
                <div className="strong">{s.siteName}: {s.confirmed} of {s.total} confirmed</div>
                {s.missing.length > 0 && <div className="muted">Not yet: {s.missing.join(", ")}</div>}
              </div>
            ))}
          </section>
        )}

        {writer && (
          <section className="card stack" aria-label="Versions">
            <div className="row wrap"><h2 className="h-sec grow">Versions</h2>
              {!doc.retiredAt && <EditButton docId={doc.id} hasDraft={!!doc.open} />}
              {retiring && <RetireButton docId={doc.id} retired={!!doc.retiredAt} title={v.title} hasDraft={!!doc.open} what={kind === "prep" ? "prep recipe" : "dish"} />}
            </div>
            <div className="log">
              {history.filter((h) => h.status !== "discarded").map((h) => (
                <div key={h.id} style={{ alignItems: "center" }}>
                  <span className="grow">
                    {h.status === "published" || h.status === "superseded"
                      ? <Link href={h.status === "published" ? `/library/${doc.id}` : `/library/${doc.id}?v=${h.id}`}>Version {h.version}</Link>
                      : <Link href={`/library/${doc.id}/draft`}>New version</Link>}
                    <span className="muted"> · {h.publishedAt ? `${CHANGE_TEXT[h.change ?? "new"]}${h.allergensChangedAt === h.publishedAt ? " · allergens changed" : ""} · approved by ${h.approvedByName} on ${dayMonthYearAt(h.publishedAt)} · written by ${h.authorName}` : `${h.authorName}`}</span>
                  </span>
                  <span className={`chip ${h.status === "published" ? "done" : ""}`}>{h.status === "draft" || h.status === "in_review" ? versionLabel(h) : STATUS_TEXT[h.status]}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
      <BottomNav ctx={ctx} current="library" />
    </>
  );
}
