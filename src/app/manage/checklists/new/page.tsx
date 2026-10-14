import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { canEditChecklists } from "@/lib/domain/checklist-edit";
import { leadSites } from "@/lib/domain/access";
import { requireCtx } from "@/lib/session";
import { BottomNav, TopBar } from "@/components/Chrome";
import { pickSite } from "../../load";
import { NewChecklistForm } from "./NewChecklistForm";

export const dynamic = "force-dynamic";

export default async function NewChecklist(props: { searchParams: Promise<{ site?: string }> }) {
  const searchParams = await props.searchParams;
  const ctx = await requireCtx();
  if (!canEditChecklists(ctx.person)) redirect("/shift");
  const all = await store().sites();
  const { sites, site } = await pickSite(leadSites(ctx.person, all.map((s) => s.id)), searchParams.site, ctx.site.id);
  return (
    <>
      <TopBar ctx={ctx} title="New checklist" eyebrow={`Owner · ${site.name}`} back={`/manage/checklists?site=${site.id}`} />
      <main>
        <p className="muted" style={{ margin: 0 }}>Its name and when it&apos;s done first. The checks come next, as a draft: nothing is asked on the tablet until you publish it.</p>
        <NewChecklistForm sites={sites.map((s) => ({ id: s.id, name: s.name }))} siteId={site.id} />
      </main>
      <BottomNav ctx={ctx} current="owner" />
    </>
  );
}
