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
      <TopBar ctx={ctx} title="Handover list" eyebrow="Manage · every site" back={ctx.isLead ? "/owner" : "/manage"} />
      <main>
        <p className="muted" style={{ margin: 0 }}>What the closing shift picks from on the prep handover: things to do, then things to prep, in groups. Changes show on the tablet straight away.</p>
        <ListEditor items={items} canRetire={canRetirePrepItem(ctx.person)} />
      </main>
      <BottomNav ctx={ctx} current={ctx.isLead ? "owner" : "manage"} />
    </>
  );
}
