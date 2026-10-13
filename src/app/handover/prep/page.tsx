import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { targetPeriod } from "@/lib/domain/assign";
import { currentNotes } from "@/lib/domain/handover";
import { PREP_SHIFTS, type PrepShift } from "@/lib/domain/prep";
import { pickFor, rotaAround } from "@/lib/handover-service";
import { TopBar } from "@/components/Chrome";
import { PrepBoard, type Pick } from "../PrepBoard";
import { handoverPage } from "../load";

export const dynamic = "force-dynamic";

export default async function HandoverPrep() {
  const { ctx, prepOn, sites } = await handoverPage();
  if (!prepOn) redirect("/handover");
  const db = store();
  const now = Date.now();
  const enabled = await db.prepEnabledSites();
  const [items, draft, outstanding, history, notes, rota, people] = await Promise.all([
    db.prepItems(), db.prepDraft(ctx.site.id), db.prepOutstanding(ctx.site.id), db.prepHandovers(ctx.site.id, 2), db.handover(ctx.site.id),
    rotaAround(ctx.site.id, now, now, db), db.people(),
  ]);
  const toPicks = (list: { itemId: string; urgent: boolean; note?: string; assignedTo?: string; assignedToName?: string }[]) =>
    Object.fromEntries(list.map((e) => [e.itemId, { urgent: e.urgent, note: e.note, assignee: e.assignedTo, assigneeName: e.assignedToName } satisfies Pick]));
  // Still to do from the last handover: they carry over by themselves, for nobody in particular (who they were for is shown).
  const carried = Object.fromEntries(outstanding.map((e) => [e.itemId, { urgent: e.urgent, note: e.note, wasFor: e.assignedToName }]));
  // Notes written since the last handover go on the one being sent; needs-action notes still open stay on it too.
  const since = history[0]?.submittedAt ?? 0;
  const going = currentNotes(notes, history.map((h) => h.submittedAt!), now).filter((n) => n.needsAction || n.createdAt > since);
  // Who can be picked, for whichever shift the handover ends up being for.
  const pickBy = Object.fromEntries(PREP_SHIFTS.map((s) => [s.id, pickFor(ctx.site, targetPeriod(s.id, now, rota), rota, people, now)])) as Record<PrepShift, ReturnType<typeof pickFor>>;
  return (
    <>
      <TopBar ctx={ctx} />
      <PrepBoard
        siteId={ctx.site.id} siteName={ctx.site.name} sites={sites.filter((s) => enabled.includes(s.id)).map((s) => ({ id: s.id, name: s.name }))}
        items={items} shift={draft?.shift ?? "next"} picks={toPicks(draft?.entries ?? [])} carried={carried}
        draftBy={draft && draft.entries.length ? draft.createdByName : undefined} notesGoing={going.length} pickBy={pickBy}
      />
    </>
  );
}
