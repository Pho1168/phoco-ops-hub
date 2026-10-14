import { notFound, redirect } from "next/navigation";
import { store } from "@/lib/data";
import { PATHWAY_TEXT, quizOf, quizVersion, shuffled } from "@/lib/domain/training";
import { current } from "@/lib/session";
import { myTraining } from "@/lib/training-service";
import { BottomNav, PhoneTopBar, TopBar } from "@/components/Chrome";
import { Quiz } from "./Quiz";

export const dynamic = "force-dynamic";

/**
 * A skill's quiz, for someone whose training includes it. Questions and answers are shuffled each time; the right
 * answers stay on the server.
 */
export default async function QuizPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await current();
  if (!ctx) redirect("/login");
  if (ctx.person.pinMustChange) redirect("/pin");
  const db = store();
  const skill = await db.trainingSkill(id);
  if (!skill || skill.retiredAt) notFound();
  const sites = await db.sites();
  const [{ rows }, questions] = await Promise.all([myTraining(ctx.person, sites, db), db.trainingQuestions([skill.id])]);
  const quiz = quizOf(skill.id, questions);
  if (!rows.some((r) => r.skill.id === skill.id) || !quiz.length) redirect(`/library/training/${skill.id}`);
  const shown = shuffled(quiz).map((q) => ({ id: q.id, text: q.text, options: shuffled(q.options.map((text, i) => ({ i, text }))) }));
  const version = quizVersion(quiz);
  const full = ctx.scope === "full";

  const Bar = full ? TopBar : PhoneTopBar;
  return (
    <>
      <Bar ctx={ctx} title={skill.title} eyebrow={`${PATHWAY_TEXT[skill.section]} · quiz`} back={`/library/training/${skill.id}`} />
      <main>
        <div className="muted">{quiz.length} question{quiz.length === 1 ? "" : "s"}. You need {skill.passMark}% to pass, and you can try again as often as you like.</div>
        {/* Keyed by the quiz's version: saving an attempt redraws the page, which mustn't wipe the result; a changed quiz starts afresh. */}
        <Quiz key={version} skillId={skill.id} version={version} questions={shown} backHref={`/library/training/${skill.id}`} />
      </main>
      {full && <BottomNav ctx={ctx} current="library" />}
    </>
  );
}
