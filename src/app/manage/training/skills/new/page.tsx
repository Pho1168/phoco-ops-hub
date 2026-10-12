import Link from "next/link";
import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { canEditTraining, PATHWAYS } from "@/lib/domain/training";
import type { Area } from "@/lib/domain/types";
import { requireCtx } from "@/lib/session";
import { BottomNav, TopBar } from "@/components/Chrome";
import { SkillForm } from "../SkillForm";
import { groupsBySection, linkOptions } from "../load";

export const dynamic = "force-dynamic";

/** A new skill, last in its pathway. Its quiz is added once it's saved. */
export default async function NewSkill(props: { searchParams: Promise<{ section?: string }> }) {
  const searchParams = await props.searchParams;
  const ctx = await requireCtx();
  if (!canEditTraining(ctx.person)) redirect("/manage/training");
  const section: Area = PATHWAYS.includes(searchParams.section as Area) ? (searchParams.section as Area) : "FOH";
  const db = store();
  const [skills, options] = await Promise.all([db.trainingSkills(), linkOptions(db)]);
  return (
    <>
      <TopBar ctx={ctx} />
      <main>
        <Link href={`/manage/training/skills?section=${section}`} className="muted" style={{ fontWeight: 600 }}>← Skills and quizzes</Link>
        <div><div className="eyebrow">Training</div><h1 className="h-display">New skill</h1></div>
        <SkillForm section={section} groups={groupsBySection(skills)} options={options} />
      </main>
      <BottomNav ctx={ctx} current={ctx.isLead ? "owner" : "manage"} />
    </>
  );
}
