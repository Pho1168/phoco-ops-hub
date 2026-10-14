import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { allergenMatrix, seesRecipes } from "@/lib/domain/recipes";
import { current } from "@/lib/session";
import { allergenChangesToConfirm } from "@/lib/library-service";
import { BottomNav, PhoneTopBar, TopBar } from "@/components/Chrome";
import { MustRead } from "@/components/MustRead";
import { LibraryTabs } from "../LibraryTabs";
import { dayMonthYearAt } from "../format";
import { AllergenMatrix } from "./AllergenMatrix";

export const dynamic = "force-dynamic";

/**
 * The allergen matrix, for everyone signed in (shop tablet or own phone): every published dish, from its approved
 * spec. It replaces the allergen spreadsheet once every dish is in.
 */
export default async function Allergens() {
  const ctx = await current();
  if (!ctx) redirect("/login");
  if (ctx.person.pinMustChange) redirect("/pin");
  const db = store();
  const [dishes, sites, toConfirm] = await Promise.all([db.libraryDocs("dish"), db.sites(), allergenChangesToConfirm(ctx.person, db)]);
  const full = ctx.scope === "full";
  const groups = allergenMatrix(dishes);
  const rows = groups.flatMap((g) => g.rows);
  const last = Math.max(0, ...dishes.flatMap((d) => (d.published && !d.retiredAt ? [d.published.publishedAt ?? 0] : [])));

  return (
    <>
      {full ? <TopBar ctx={ctx} title="Allergens" eyebrow="The 14 allergens, and E120 colouring" /> : <PhoneTopBar ctx={ctx} title="Allergens" eyebrow="The 14 allergens, and E120 colouring" back="/me" />}
      <main className="wide">
        <LibraryTabs current="allergens" recipes={full && seesRecipes(ctx.person, sites)} />
        <MustRead docs={[]} allergens={toConfirm} />
        <div className="muted">{rows.length
          ? `${rows.length} dish${rows.length === 1 ? "" : "es"}, from the approved dish specs. Last updated ${dayMonthYearAt(last)}. Tap a dish for its kitchen notes.`
          : "Dishes appear here once they're approved. Until every dish is in, keep using the current allergen chart."}</div>
        <AllergenMatrix groups={groups} />
      </main>
      {full && <BottomNav ctx={ctx} current="library" />}
    </>
  );
}
