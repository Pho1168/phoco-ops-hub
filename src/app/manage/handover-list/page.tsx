import { store } from "@/lib/data";
import { canEditPrepList, canRetirePrepItem } from "@/lib/domain/prep";
import { requireManager } from "@/lib/session";
import { BottomNav, TopBar } from "@/components/Chrome";
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
  const items = await store().prepItems();
  return (
    <>
      <TopBar ctx={ctx} />
      <main>
        <div>
          <div className="eyebrow">Manage · every site</div>
          <h1 className="h-display">Handover list</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>What the closing shift picks from on the prep handover: things to do, then things to prep, in groups. Changes show on the tablet straight away.</p>
        </div>
        <ListEditor items={items} canRetire={canRetirePrepItem(ctx.person)} />
      </main>
      <BottomNav ctx={ctx} current={ctx.isLead ? "owner" : "manage"} />
    </>
  );
}
