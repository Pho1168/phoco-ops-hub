import type { Store } from "@/lib/data/store";
import { photoIds } from "@/lib/domain/library";
import { ingredientPhotos, type DishBody, type PrepBody, type RecipeKind } from "@/lib/domain/recipes";
import type { PrepOption } from "./RecipeEditor";

/** Suggested when nothing of that kind exists yet; the menu sections follow PHO & CO's allergen chart. */
const STARTER: Record<RecipeKind, string[]> = {
  prep: ["Broth", "Marinade", "Sauce", "Filling", "Dessert", "Drink"],
  dish: ["Starters", "Banh Mi", "Bun", "Pho", "Spicy Pho", "Rice", "Sauces", "Drinks", "Chè"],
};

/** A picture already taken for an ingredient (`ingredientKey`), to reuse in another recipe. */
export interface Picture { key: string; name: string; photo: { id: string; w: number; h: number } }

/**
 * For the recipe editor: categories already in use (offered as it's typed), prep recipes a dish can link to (retired ones
 * marked), and pictures already taken for ingredients in any recipe (published or being written; never an erased one).
 */
export async function editorLists(kind: RecipeKind, db: Store): Promise<{ categories: string[]; preps: PrepOption[]; pictures: Picture[] }> {
  const [docs, preps, dishes] = await Promise.all([db.libraryDocs(kind, { light: true }), db.libraryDocs("prep"), db.libraryDocs("dish")]);
  const versions = [...preps, ...dishes].flatMap((d) => [d.published, d.open]).flatMap((v) => (v ? [v] : [])).sort((a, b) => a.updatedAt - b.updatedAt);
  const bodies = versions.map((v) => v.body as PrepBody | DishBody);
  const ids = Array.from(new Set(bodies.flatMap((b) => photoIds(b))));
  const status = ids.length ? await db.mediaStatus(ids) : new Map<string, { erased: boolean }>();
  const gone = new Set(ids.filter((id) => !status.has(id) || status.get(id)!.erased));
  const pictures = Array.from(ingredientPhotos(bodies, gone).entries()).map(([key, p]) => ({ key, ...p })).sort((a, b) => a.name.localeCompare(b.name));
  const seen = new Map<string, string>();
  for (const c of [...docs.flatMap((d) => [d.published?.body.category, d.open?.body.category]), ...STARTER[kind]]) {
    if (c && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
  }
  return {
    categories: Array.from(seen.values()),
    pictures,
    preps: kind !== "dish" ? [] : preps.filter((p) => p.published).map((p) => ({ id: p.id, code: p.code, title: p.published!.title, allergens: p.published!.body.allergens, retired: !!p.retiredAt }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  };
}
