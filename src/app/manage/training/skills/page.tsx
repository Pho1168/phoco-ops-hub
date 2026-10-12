import Link from "next/link";
import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { bySkillOrder, canEditTraining, pathwayOf, PATHWAYS, PATHWAY_TEXT } from "@/lib/domain/training";
import type { Area } from "@/lib/domain/types";
import { requireCtx } from "@/lib/session";
import { BottomNav, TopBar } from "@/components/Chrome";
import { MoveButtons, PathwayForm, RetireSkill } from "./SkillButtons";

export const dynamic = "force-dynamic";

/**
 * The owner and operations managers: each pathway's skills in order (move, open to edit, retire), its deadlines, and
 * which quizzes have drafted questions to approve.
 */
export default async function Skills(props: { searchParams: Promise<{ section?: string }> }) {
  const searchParams = await props.searchParams;
  const ctx = await requireCtx();
  if (!canEditTraining(ctx.person)) redirect("/manage/training");
  const section: Area = PATHWAYS.includes(searchParams.section as Area) ? (searchParams.section as Area) : "FOH";
  const db = store();
  const [skills, questions, pathways] = await Promise.all([db.trainingSkills(), db.trainingQuestions(), db.trainingPathways()]);
  const live = skills.filter((s) => s.section === section && !s.retiredAt).sort(bySkillOrder);
  const retired = skills.filter((s) => s.section === section && s.retiredAt);
  const p = pathwayOf(pathways, section);
  const drafts = (id: string) => questions.filter((q) => q.skillId === id && !q.approved).length;
  const asked = (id: string) => questions.filter((q) => q.skillId === id && q.approved).length;
  const toApprove = live.filter((s) => drafts(s.id) > 0).length;

  return (
    <>
      <TopBar ctx={ctx} />
      <main>
        <Link href="/manage/training" className="muted" style={{ fontWeight: 600 }}>← Training</Link>
        <div className="row wrap" style={{ alignItems: "flex-end" }}>
          <div className="grow"><div className="eyebrow">Training · the owner and operations managers</div><h1 className="h-display">Skills and quizzes</h1></div>
          <Link className="btn accent small" href={`/manage/training/skills/new?section=${section}`}>Add a skill</Link>
        </div>
        <nav className="lib-tabs" aria-label="Pathway">
          {PATHWAYS.map((s) => <Link key={s} href={`/manage/training/skills?section=${s}`} aria-current={s === section ? "page" : undefined}>{PATHWAY_TEXT[s]}</Link>)}
        </nav>

        <PathwayForm key={`${section}-${p.inductionDays}-${p.allDays}`} section={section} inductionDays={p.inductionDays} allDays={p.allDays} />
        {toApprove > 0 && <div className="alert" role="status">{toApprove} quiz{toApprove === 1 ? " has" : "zes have"} drafted questions to check and approve: they&apos;re marked below.</div>}

        <section className="stack" aria-label={`${PATHWAY_TEXT[section]} skills`} style={{ gap: 8 }}>
          {live.length === 0 && <div className="card muted">No skills in this pathway yet.</div>}
          {live.map((s, i) => {
            const d = drafts(s.id), a = asked(s.id);
            return (
              <div key={s.id} className="card row wrap" style={{ gap: 10 }}>
                <MoveButtons skillId={s.id} title={s.title} first={i === 0} last={i === live.length - 1} />
                <Link href={`/manage/training/skills/${s.id}`} className="grow" style={{ color: "inherit", textDecoration: "none" }}>
                  <span className="strong" style={{ display: "block" }}>{s.title}</span>
                  <span className="muted">{s.group} · {s.handsOn ? "hands-on" : "knowledge"}{s.induction ? " · induction" : ""}{s.refresherMonths ? ` · every ${s.refresherMonths} months` : ""}</span>
                </Link>
                <span className="chips">
                  <span className={`chip ${a ? "done" : ""}`}>{a ? `Quiz: ${a}` : "No quiz"}</span>
                  {d > 0 && <span className="chip late">{d} to approve</span>}
                </span>
              </div>
            );
          })}
        </section>

        {retired.length > 0 && (
          <details className="card">
            <summary className="strong" style={{ cursor: "pointer" }}>Retired ({retired.length})</summary>
            <div className="stack" style={{ marginTop: 10 }}>
              {retired.map((s) => (
                <div key={s.id} className="row wrap" style={{ gap: 8 }}>
                  <Link href={`/manage/training/skills/${s.id}`} className="grow">{s.title}</Link>
                  <RetireSkill skillId={s.id} retired />
                </div>
              ))}
            </div>
          </details>
        )}
      </main>
      <BottomNav ctx={ctx} current={ctx.isLead ? "owner" : "manage"} />
    </>
  );
}
