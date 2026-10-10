import { store } from "@/lib/data";
import { TopBar } from "@/components/Chrome";
import { PrepBoard, type Pick } from "./PrepBoard";
import { prepPage } from "./load";

export const dynamic = "force-dynamic";

export default async function Prep() {
  const { ctx, sites } = await prepPage();
  const db = store();
  const [items, draft, outstanding, latest] = await Promise.all([
    db.prepItems(), db.prepDraft(ctx.site.id), db.prepOutstanding(ctx.site.id), db.prepHandovers(ctx.site.id, 1),
  ]);
  const toPicks = (list: { itemId: string; urgent: boolean; note?: string }[]) =>
    Object.fromEntries(list.map((e) => [e.itemId, { urgent: e.urgent, note: e.note } satisfies Pick]));
  return (
    <>
      <TopBar ctx={ctx} />
      <PrepBoard
        siteId={ctx.site.id} siteName={ctx.site.name} sites={sites.map((s) => ({ id: s.id, name: s.name }))}
        items={items} shift={draft?.shift ?? "next"} picks={toPicks(draft?.entries ?? [])} carried={toPicks(outstanding)}
        draftBy={draft && draft.entries.length ? draft.createdByName : undefined} latestId={latest[0]?.id}
      />
    </>
  );
}
