import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { store } from "@/lib/data";
import { canManageAccount, givableRoles } from "@/lib/domain/staff";
import { requireLead } from "@/lib/session";
import { BottomNav, TopBar } from "@/components/Chrome";
import { StaffForm } from "../StaffForm";
import { siteOptions } from "../load";

export const dynamic = "force-dynamic";

export default async function EditPerson(
  props: { params: Promise<{ id: string }>; searchParams: Promise<{ added?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const ctx = await requireLead();
  const p = await store().person(params.id);
  if (!p) notFound();
  // An operations manager only opens accounts they may change: staff and managers at their sites.
  if (!canManageAccount(ctx.person, p).ok) redirect("/owner");
  return (
    <>
      <TopBar ctx={ctx} neutral title={p.name} eyebrow={`${ctx.isOwner ? "Owner" : "Operations"} · staff · ${p.staffCode}`} back="/owner#accounts">
        <Link className="pill-btn top-extra" href={`/manage/certificates/${p.id}`}>Certificates</Link>
      </TopBar>
      <main>
        {searchParams.added && (
          <div className="alert good" role="status"><div><div className="strong">{p.name} added</div>
            <div style={{ fontSize: 13 }}>Give them the temporary PIN in person. They&apos;ll choose their own when they first sign in.</div></div></div>
        )}
        <StaffForm sites={await siteOptions(ctx.leads)} roles={givableRoles(ctx.person)} suggestedCode={p.staffCode}
          person={{ id: p.id, staffCode: p.staffCode, name: p.name, status: p.status, self: p.id === ctx.person.id, access: p.access }} />
      </main>
      <BottomNav ctx={ctx} current="owner" />
    </>
  );
}
