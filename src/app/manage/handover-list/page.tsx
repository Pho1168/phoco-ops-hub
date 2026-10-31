import { store } from "@/lib/data";
import { canEditPrepList, canRetirePrepItem, prepListBrands } from "@/lib/domain/prep";
import { BRANDS, brandOf, isBrandId, type BrandId } from "@/lib/domain/brand";
import { BusinessTabs } from "@/app/stock/BusinessTabs";
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
export default async function HandoverList(props: { searchParams: Promise<{ b?: string }> }) {
  const { b } = await props.searchParams;
  const ctx = await requireManager();
  if (!canEditPrepList(ctx.person)) redirect("/today");
  const db = store();
  // Each business keeps its own list; a manager sees the one(s) for the sites they manage.
  const brands = prepListBrands(ctx.person, await db.sites());
  const own = brandOf(ctx.site).id;
  const brand: BrandId = isBrandId(b) && brands.includes(b) ? b : brands.includes(own) ? own : brands[0] ?? own;
  const [items, preps] = await Promise.all([db.prepItems(brand), db.libraryDocs("prep", { light: true })]);
  // The recipe sheets an item can open: published, live prep recipes.
  const recipes = preps.filter((d) => d.published && !d.retiredAt).map((d) => ({ id: d.id, title: d.published!.title, code: d.code }))
    .sort((a, b) => a.title.localeCompare(b.title));
  return (
    <>
      <TopBar ctx={ctx} neutral={ctx.isLead} title="Handover list" eyebrow={`Manage · ${BRANDS[brand].name}`} back={ctx.isLead ? "/owner" : "/manage"} />
      <main>
        <BusinessTabs brands={brands} current={brand} path="/manage/handover-list" />
        <p className="muted" style={{ margin: 0 }}>{BRANDS[brand].name}&apos;s list, for all its sites: what the closing shift picks from on the prep handover: things to do, then things to prep, in groups. Changes show on the tablet straight away.</p>
        <div className="row wrap no-print" style={{ gap: 8, alignItems: "center" }}>
          <span className="muted lead grow">A printed form with a box to tick for every item, for the receipt printer.</span>
          <a className="btn small" href={`/handover/list?b=${brand}`} target="_blank" rel="noreferrer"><Icon name="print" /> Print (80 mm receipt)</a>
        </div>
        <ListEditor brand={brand} items={items} canRetire={canRetirePrepItem(ctx.person)} recipes={recipes} />
      </main>
      <BottomNav ctx={ctx} current={ctx.isLead ? "owner" : "manage"} />
    </>
  );
}
