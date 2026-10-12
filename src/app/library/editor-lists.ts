import type { Store } from "@/lib/data/store";
import type { RecipeKind } from "@/lib/domain/recipes";
import type { PrepOption } from "./RecipeEditor";

/** Suggested when nothing of that kind exists yet; the menu sections follow PHO & CO's allergen chart. */
const STARTER: Record<RecipeKind, string[]> = {
  prep: ["Broth", "Marinade", "Sauce", "Filling", "Dessert", "Drink"],
  dish: ["Starters", "Banh Mi", "Bun", "Pho", "Spicy Pho", "Rice", "Sauces", "Drinks", "Chè"],
};

/** For the recipe editor: categories already in use (offered as it's typed), and prep recipes a dish can link to (retired ones marked). */
export async function editorLists(kind: RecipeKind, db: Store): Promise<{ categories: string[]; preps: PrepOption[] }> {
  const [docs, preps] = await Promise.all([db.libraryDocs(kind, { light: true }), kind === "dish" ? db.libraryDocs("prep") : Promise.resolve([])]);
  const seen = new Map<string, string>();
  for (const c of [...docs.flatMap((d) => [d.published?.body.category, d.open?.body.category]), ...STARTER[kind]]) {
    if (c && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
  }
  return {
    categories: Array.from(seen.values()),
    preps: preps.filter((p) => p.published).map((p) => ({ id: p.id, code: p.code, title: p.published!.title, allergens: p.published!.body.allergens, retired: !!p.retiredAt }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  };
}
