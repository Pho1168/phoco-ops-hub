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
      <TopBar ctx={ctx} />
      <main>
        <div><div className="eyebrow">{ctx.isOwner ? "Owner" : "Operations"} · staff</div><h1 className="h-display">Add a person</h1></div>
        <StaffForm sites={await siteOptions(ctx.leads)} roles={givableRoles(ctx.person)} suggestedCode={nextStaffCode(people)} />
      </main>
      <BottomNav ctx={ctx} current="owner" />
    </>
  );
}
