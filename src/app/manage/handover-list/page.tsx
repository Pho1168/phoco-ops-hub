import { store } from "@/lib/data";
import { canEditPrepList, canRetirePrepItem } from "@/lib/domain/prep";
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
  const [items, preps] = await Promise.all([db.prepItems(), db.libraryDocs("prep", { light: true })]);
  // The recipe sheets an item can open: published, live prep recipes.
  const recipes = preps.filter((d) => d.published && !d.retiredAt).map((d) => ({ id: d.id, title: d.published!.title, code: d.code }))
    .sort((a, b) => a.title.localeCompare(b.title));
  return (
    <>
      <TopBar ctx={ctx} title="Handover list" eyebrow="Manage · every site" back={ctx.isLead ? "/owner" : "/manage"} />
      <main>
        <p className="muted" style={{ margin: 0 }}>What the closing shift picks from on the prep handover: things to do, then things to prep, in groups. Changes show on the tablet straight away.</p>
        <div className="row wrap no-print" style={{ gap: 8, alignItems: "center" }}>
          <span className="muted lead grow">A printed form with a box to tick for every item, for the receipt printer.</span>
          <a className="btn small" href="/handover/list" target="_blank" rel="noreferrer"><Icon name="print" /> Print (80 mm receipt)</a>
        </div>
        <ListEditor items={items} canRetire={canRetirePrepItem(ctx.person)} recipes={recipes} />
      </main>
      <BottomNav ctx={ctx} current={ctx.isLead ? "owner" : "manage"} />
    </>
  );
}
