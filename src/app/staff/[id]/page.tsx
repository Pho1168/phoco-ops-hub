import { notFound, redirect } from "next/navigation";
import { store } from "@/lib/data";
import { requireCtx } from "@/lib/session";
import { BottomNav, TopBar } from "@/components/Chrome";
import { StaffForm } from "../StaffForm";
import { siteOptions } from "../load";

export const dynamic = "force-dynamic";

export default async function EditPerson({ params, searchParams }: { params: { id: string }; searchParams: { added?: string } }) {
  const ctx = await requireCtx();
  if (!ctx.isOwner) redirect("/today");
  const p = await store().person(params.id);
  if (!p) notFound();
  return (
    <>
      <TopBar ctx={ctx} />
      <main>
        <div><div className="eyebrow">Owner · staff · {p.staffCode}</div><h1 className="h-display">{p.name}</h1></div>
        {searchParams.added && (
          <div className="alert good" role="status"><div><div className="strong">{p.name} added</div>
            <div style={{ fontSize: 13 }}>Give them the temporary PIN in person. They&apos;ll choose their own when they first sign in.</div></div></div>
        )}
        <StaffForm sites={await siteOptions()} suggestedCode={p.staffCode}
          person={{ id: p.id, staffCode: p.staffCode, name: p.name, status: p.status, self: p.id === ctx.person.id, access: p.access }} />
      </main>
      <BottomNav ctx={ctx} current="owner" />
    </>
  );
}
