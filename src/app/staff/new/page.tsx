import { store } from "@/lib/data";
import { givableRoles, nextStaffCode } from "@/lib/domain/staff";
import { requireLead } from "@/lib/session";
import { BottomNav, TopBar } from "@/components/Chrome";
import { StaffForm } from "../StaffForm";
import { siteOptions } from "../load";

export const dynamic = "force-dynamic";

export default async function NewPerson() {
  const ctx = await requireLead();
  const people = await store().people();
  return (
    <>
      <TopBar ctx={ctx} neutral title="Add a person" eyebrow={`${ctx.isOwner ? "Owner" : "Operations"} · staff`} back="/owner#accounts" />
      <main>
        <StaffForm sites={await siteOptions(ctx.allLeads)} roles={givableRoles(ctx.person)} suggestedCode={nextStaffCode(people)} />
      </main>
      <BottomNav ctx={ctx} current="owner" />
    </>
  );
}
