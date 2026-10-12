import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { store } from "@/lib/data";
import { canEditTraining, PATHWAY_TEXT } from "@/lib/domain/training";
import { requireCtx } from "@/lib/session";
import { BottomNav, TopBar } from "@/components/Chrome";
import { SkillForm } from "../SkillForm";
import { QuestionsEditor } from "../QuestionsEditor";
import { RetireSkill } from "../SkillButtons";
import { groupsBySection, linkOptions } from "../load";

export const dynamic = "force-dynamic";

/** A skill's details and its quiz, for the owner and operations managers. */
export default async function EditSkill(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await requireCtx();
  if (!canEditTraining(ctx.person)) redirect("/manage/training");
  const db = store();
  const skill = await db.trainingSkill(id);
  if (!skill) notFound();
  const [skills, options, questions] = await Promise.all([db.trainingSkills(), linkOptions(db, skill.links), db.trainingQuestions([skill.id])]);
  return (
    <>
      <TopBar ctx={ctx} />
      <main>
        <Link href={`/manage/training/skills?section=${skill.section}`} className="muted" style={{ fontWeight: 600 }}>← Skills and quizzes</Link>
        <div className="row wrap" style={{ alignItems: "flex-end" }}>
          <div className="grow"><div className="eyebrow">{PATHWAY_TEXT[skill.section]} · {skill.group}</div><h1 className="h-display">{skill.title}</h1></div>
          <Link className="btn ghost small" href={`/library/training/${skill.id}`}>See it as staff do</Link>
          <RetireSkill skillId={skill.id} retired={!!skill.retiredAt} />
        </div>
        {skill.retiredAt && <div className="alert bad" role="status">Retired: it isn&apos;t part of anyone&apos;s training. Bring it back to use it again.</div>}
        <SkillForm skill={skill} section={skill.section} groups={groupsBySection(skills)} options={options} />
        {!skill.retiredAt && <QuestionsEditor skillId={skill.id} questions={questions.map((q) => ({ id: q.id, text: q.text, options: q.options, answer: q.answer, approved: q.approved }))} />}
      </main>
      <BottomNav ctx={ctx} current={ctx.isLead ? "owner" : "manage"} />
    </>
  );
}
