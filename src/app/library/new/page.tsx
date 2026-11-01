import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { canDraft } from "@/lib/domain/library";
import type { DishBody, PrepBody } from "@/lib/domain/recipes";
import { requireCtx } from "@/lib/session";
import { TopBar } from "@/components/Chrome";
import { SopEditor } from "../SopEditor";
import { RecipeEditor } from "../RecipeEditor";
import { editorLists } from "../editor-lists";

export const dynamic = "force-dynamic";

/** A new SOP, prep recipe (?kind=prep) or dish (?kind=dish), written as a draft (managers, owners, operations managers; full app). */
export default async function NewLibraryItem(props: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await props.searchParams;
  const ctx = await requireCtx();
  if (!canDraft(ctx.person)) redirect("/library");

  if (kind === "prep" || kind === "dish") {
    const db = store();
    const sites = await db.sites();
    // Someone who only works at production writes production recipes; everyone else starts with back of house.
    const prodOnly = ctx.person.access.every((a) => sites.find((s) => s.id === a.siteId)?.kind === "production");
    const body: PrepBody | DishBody = kind === "prep"
      ? { sections: [prodOnly ? "PROD" : "BOH"], category: "", ingredients: [], steps: [], storage: "", allergens: {}, notes: "" }
      : { sections: ["BOH"], category: "", components: [], steps: [], allergens: {}, modifications: "", dietary: [] };
    return (
      <>
        <TopBar ctx={ctx} title={kind === "prep" ? "New prep recipe" : "New dish"} eyebrow="Recipes · a draft until it's approved" back="/library/recipes" />
        <main>
          <div className="muted">{kind === "prep"
            ? "A batch the kitchen or the production kitchen makes: what one batch makes, the ingredients, the method, storage and shelf life, and its allergens."
            : "How a menu item is built, per portion, and its allergens for front of house."} When it&apos;s ready, send it for approval: the owner or an operations manager publishes it.</div>
          <RecipeEditor kind={kind} mode="new" personId={ctx.person.id} initial={{ title: "", body }} {...await editorLists(kind, db)} />
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar ctx={ctx} title="New SOP" eyebrow="Library · a draft until it's approved" back="/library" />
      <main>
        <div className="muted">Write it as a draft and add photos where they help. When it&apos;s ready, send it for approval: the owner or an operations manager publishes it, and everyone it&apos;s for is asked to read it.</div>
        <SopEditor mode="new" personId={ctx.person.id} initial={{ title: "", body: { sections: [], purpose: "", steps: [] } }} />
      </main>
    </>
  );
}
