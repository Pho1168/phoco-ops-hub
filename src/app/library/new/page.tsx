import Link from "next/link";
import { redirect } from "next/navigation";
import { canDraft } from "@/lib/domain/library";
import { requireCtx } from "@/lib/session";
import { TopBar } from "@/components/Chrome";
import { SopEditor } from "../SopEditor";

export const dynamic = "force-dynamic";

/** A new SOP, written as a draft (managers, owners, operations managers; full app). */
export default async function NewSop() {
  const ctx = await requireCtx();
  if (!canDraft(ctx.person)) redirect("/library");
  return (
    <>
      <TopBar ctx={ctx} />
      <main>
        <Link href="/library" className="muted" style={{ fontWeight: 600 }}>← Library</Link>
        <div><div className="eyebrow">Library · new SOP</div><h1 className="h-display">New SOP</h1></div>
        <div className="muted">Write it as a draft and add photos where they help. When it&apos;s ready, send it for approval: the owner or an operations manager publishes it, and everyone it&apos;s for is asked to read it.</div>
        <SopEditor mode="new" personId={ctx.person.id} initial={{ title: "", body: { sections: [], purpose: "", steps: [] } }} />
      </main>
    </>
  );
}
