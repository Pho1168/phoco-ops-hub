import { store } from "@/lib/data";
import { canEditPrepList, canRetirePrepItem, prepListBrands } from "@/lib/domain/prep";
import { BRANDS, brandOf } from "@/lib/domain/brand";
import { requireManager } from "@/lib/session";
import { BottomNav, TopBar } from "@/components/Chrome";
import { Icon } from "@/components/Icon";
import { redirect } from "next/navigation";
import { ListEditor } from "./ListEditor";

export const dynamic = "force-dynamic";

/**
 * The handover master list: the things to do and the things to prep that the closing shift picks from. One list for
 * every site. Managers add and edit; the owner and operations managers also take items off the list and put them back.
 */
export default async function HandoverList() {
  const ctx = await requireManager();
  if (!canEditPrepList(ctx.person)) redirect("/today");
  const db = store();
  // Each business keeps its own list: this is the one of the site they're working at (switch site for the other).
  const brand = brandOf(ctx.site).id;
  if (!prepListBrands(ctx.person, await db.sites()).includes(brand)) redirect("/today");
  const [items, preps] = await Promise.all([db.prepItems(brand), db.libraryDocs("prep", { light: true })]);
  // The recipe sheets an item can open: published, live prep recipes.
  const recipes = preps.filter((d) => d.published && !d.retiredAt).map((d) => ({ id: d.id, title: d.published!.title, code: d.code }))
    .sort((a, b) => a.title.localeCompare(b.title));
  return (
    <>
      <TopBar ctx={ctx} neutral={ctx.isLead} title="Handover list" eyebrow={`Manage · ${BRANDS[brand].name}`} back={ctx.isLead ? "/owner" : "/manage"} />
      <main>
        <p className="muted" style={{ margin: 0 }}>{BRANDS[brand].name}&apos;s list, for all its sites: what the closing shift picks from on the prep handover: things to do, then things to prep, in groups. Changes show on the tablet straight away.</p>
        <div className="row wrap no-print" style={{ gap: 8, alignItems: "center" }}>
          <span className="muted lead grow">A printed form with a box to tick for every item, for the receipt printer.</span>
          <a className="btn small" href="/handover/list" target="_blank" rel="noreferrer"><Icon name="print" /> Print (80 mm receipt)</a>
        </div>
        <ListEditor brand={brand} items={items} canRetire={canRetirePrepItem(ctx.person)} recipes={recipes} />
      </main>
      <BottomNav ctx={ctx} current={ctx.isLead ? "owner" : "manage"} />
    </>
  );
}
