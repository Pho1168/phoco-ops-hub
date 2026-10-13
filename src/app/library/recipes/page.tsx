import Link from "next/link";
import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { approvesKind, canDraft, canReview, docReach, isContributor, reviewState, versionLabel, type LibraryDoc } from "@/lib/domain/library";
import { seesRecipes, type DishBody, type PrepBody } from "@/lib/domain/recipes";
import { londonDate } from "@/lib/domain/time";
import { current } from "@/lib/session";
import { BottomNav, TopBar } from "@/components/Chrome";
import { LibraryTabs } from "../LibraryTabs";
import { dayMonth as when } from "../format";
import { RecipeList, type RecipeItem } from "./RecipeList";

export const dynamic = "force-dynamic";

type Doc = LibraryDoc<PrepBody | DishBody>;

/**
 * The recipe handbook: prep recipes and dish specs, on the full app, for kitchen staff (the sections each is for) and
 * people who write them. Writers also see drafts and what's waiting for approval.
 */
export default async function Recipes() {
  const ctx = await current();
  if (!ctx) redirect("/login");
  if (ctx.person.pinMustChange) redirect("/pin");
  const db = store();
  const [preps, dishes, sites] = await Promise.all([db.libraryDocs("prep", { light: true }), db.libraryDocs("dish", { light: true }), db.sites()]);
  if (ctx.scope !== "full" || !seesRecipes(ctx.person, sites)) redirect("/library");
  const writer = canDraft(ctx.person);
  const approver = approvesKind(ctx.person, "prep"); // recipes and dishes: the owner only
  const today = londonDate(Date.now());
  const docs: Doc[] = [...preps, ...dishes];
  const items: RecipeItem[] = docs.filter((d) => d.published && !d.retiredAt)
    .map((d) => ({
      id: d.id, code: d.code, title: d.published!.title, kind: d.kind as "prep" | "dish", category: d.published!.body.category,
      review: writer ? reviewState(d.published!.reviewBy, today) : undefined, draft: writer && d.open ? versionLabel(d.open) : undefined,
    })).sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  const open = (d: Doc) => !!d.open && !d.retiredAt;
  const waiting = writer ? docs.filter((d) => open(d) && d.open!.status === "in_review") : [];
  const drafts = writer ? docs.filter((d) => open(d) && d.open!.status === "draft") : [];
  const retired = writer ? docs.filter((d) => d.retiredAt && d.published) : [];
  const waitingChip = (d: Doc) => {
    const v = d.open!;
    if (approver && canReview(ctx.person, v, docReach(d, sites), d.kind).ok) return { text: d.published ? "New version" : `New ${d.kind === "prep" ? "recipe" : "dish"}`, tone: "late" };
    if (approver && isContributor(ctx.person, v)) return { text: "Another approver checks it", tone: "" };
    if (approver) return { text: "The owner approves it", tone: "" };
    return { text: "Waiting", tone: "" };
  };
  const row = (d: Doc, note: string, chip?: { text: string; tone: string }) => (
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
      <TopBar ctx={ctx} />
      <main>
        <div className="row wrap" style={{ alignItems: "flex-end" }}>
          <div className="grow"><div className="eyebrow">How we make it · prep recipes and dishes</div><h1 className="h-display">Recipes</h1></div>
          {writer && <Link className="btn accent small" href="/library/new?kind=prep">New prep recipe</Link>}
          {writer && <Link className="btn accent small" href="/library/new?kind=dish">New dish</Link>}
        </div>
        <LibraryTabs current="recipes" recipes />

        {waiting.length > 0 && (
          <section className="stack" aria-label="Waiting for approval">
            <h2 className="h-sec">Waiting for approval ({waiting.length})</h2>
            {!approver && <div className="muted">The owner approves them. To change one, open it and take it back.</div>}
            {waiting.map((d) => row(d, `${d.open!.authorName}${d.open!.submittedAt ? ` · sent ${when(d.open!.submittedAt)}` : ""}`, waitingChip(d)))}
          </section>
        )}
        {drafts.length > 0 && (
          <section className="stack" aria-label="Drafts">
            <h2 className="h-sec">Drafts ({drafts.length})</h2>
            {drafts.map((d) => row(d, `${d.open!.authorName} · changed ${when(d.open!.updatedAt)}`, d.open!.reviewNote ? { text: "Sent back", tone: "late" } : { text: "Draft", tone: "" }))}
          </section>
        )}

        <RecipeList items={items} />

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
      <BottomNav ctx={ctx} current="library" />
    </>
  );
}
