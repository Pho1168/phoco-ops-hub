import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { store } from "@/lib/data";
import { canEditTraining, emptyGuide, guidePhotoIds, PATHWAY_TEXT } from "@/lib/domain/training";
import { requireCtx } from "@/lib/session";
import { BottomNav, TopBar } from "@/components/Chrome";
import { SkillForm } from "../SkillForm";
import { QuestionsEditor } from "../QuestionsEditor";
import { RetireSkill } from "../SkillButtons";
import { GuideForm } from "./GuideForm";
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
  const guide = skill.guide ?? emptyGuide();
  const erased = Array.from((await db.mediaStatus(guidePhotoIds(guide))).entries()).filter(([, m]) => m.erased).map(([pid]) => pid);
  return (
    <>
      <TopBar ctx={ctx} title={skill.title} eyebrow={`${PATHWAY_TEXT[skill.section]} · ${skill.group}`} back={`/manage/training/skills?section=${skill.section}`}>
        <Link className="pill-btn top-extra" href={`/library/training/${skill.id}`}>See it as staff do</Link>
      </TopBar>
      <main>
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="muted lead">{skill.handsOn ? "Hands-on: a manager confirms it once the person is ready." : "Knowledge: a passed quiz completes it."}</span>
          <RetireSkill skillId={skill.id} retired={!!skill.retiredAt} />
        </div>
        {skill.retiredAt ? (
          <div className="alert bad" role="status">Retired: it isn&apos;t part of anyone&apos;s training. Bring it back to change it or use it again.</div>
        ) : (
          <>
            <SkillForm skill={skill} section={skill.section} groups={groupsBySection(skills)} options={options} />
            <GuideForm skillId={skill.id} guide={guide} erased={erased} />
            <QuestionsEditor skillId={skill.id} questions={questions.map((q) => ({ id: q.id, text: q.text, options: q.options, answer: q.answer, approved: q.approved }))} />
          </>
        )}
      </main>
      <BottomNav ctx={ctx} current={ctx.isLead ? "owner" : "manage"} />
    </>
  );
}
