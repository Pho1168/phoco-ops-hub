import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { nextStaffCode } from "@/lib/domain/staff";
import { requireCtx } from "@/lib/session";
import { BottomNav, TopBar } from "@/components/Chrome";
import { StaffForm } from "../StaffForm";
import { siteOptions } from "../load";

export const dynamic = "force-dynamic";

export default async function NewPerson() {
  const ctx = await requireCtx();
  if (!ctx.isOwner) redirect("/today");
  const people = await store().people();
  return (
    <>
      <TopBar ctx={ctx} />
      <main>
        <div><div className="eyebrow">Owner · staff</div><h1 className="h-display">Add a person</h1></div>
        <StaffForm sites={await siteOptions()} suggestedCode={nextStaffCode(people)} />
      </main>
      <BottomNav ctx={ctx} current="owner" />
    </>
  );
}
