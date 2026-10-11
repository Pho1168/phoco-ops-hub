import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { currentNotes } from "@/lib/domain/handover";
import { TopBar } from "@/components/Chrome";
import { PrepBoard, type Pick } from "../PrepBoard";
import { handoverPage } from "../load";

export const dynamic = "force-dynamic";

export default async function HandoverPrep() {
  const { ctx, prepOn, sites } = await handoverPage();
  if (!prepOn) redirect("/handover");
  const db = store();
  const enabled = await db.prepEnabledSites();
  const [items, draft, outstanding, history, notes] = await Promise.all([
    db.prepItems(), db.prepDraft(ctx.site.id), db.prepOutstanding(ctx.site.id), db.prepHandovers(ctx.site.id, 2), db.handover(ctx.site.id),
  ]);
  const toPicks = (list: { itemId: string; urgent: boolean; note?: string }[]) =>
    Object.fromEntries(list.map((e) => [e.itemId, { urgent: e.urgent, note: e.note } satisfies Pick]));
  // Notes written since the last handover go on the one being sent; needs-action notes still open stay on it too.
  const since = history[0]?.submittedAt ?? 0;
  const going = currentNotes(notes, history.map((h) => h.submittedAt!), Date.now()).filter((n) => n.needsAction || n.createdAt > since);
  return (
    <>
      <TopBar ctx={ctx} />
      <PrepBoard
        siteId={ctx.site.id} siteName={ctx.site.name} sites={sites.filter((s) => enabled.includes(s.id)).map((s) => ({ id: s.id, name: s.name }))}
        items={items} shift={draft?.shift ?? "next"} picks={toPicks(draft?.entries ?? [])} carried={toPicks(outstanding)}
        draftBy={draft && draft.entries.length ? draft.createdByName : undefined} notesGoing={going.length}
      />
    </>
  );
}
