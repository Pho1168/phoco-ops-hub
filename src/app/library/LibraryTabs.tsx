import Link from "next/link";

/** The library's parts: SOPs, recipes (kitchen, on the full app), the allergen matrix and training (everyone). */
export function LibraryTabs({ current, recipes }: { current: "sops" | "recipes" | "allergens" | "training"; recipes: boolean }) {
  const tab = (id: typeof current, href: string, label: string) => (
    <Link href={href} aria-current={current === id ? "page" : undefined}>{label}</Link>
  );
  return (
    <nav className="lib-tabs" aria-label="Library">
      {tab("sops", "/library", "SOPs")}
      {recipes && tab("recipes", "/library/recipes", "Recipes")}
      {tab("allergens", "/library/allergens", "Allergens")}
      {tab("training", "/library/training", "Training")}
    </nav>
  );
}
