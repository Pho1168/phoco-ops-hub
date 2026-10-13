import Link from "next/link";
import { notFound } from "next/navigation";
import { store } from "@/lib/data";
import { peopleInCare } from "@/lib/domain/certificates";
import { canConfirmNow, canTakeBackNow, managesTraining, passport, tally, type TrainingEvent } from "@/lib/domain/training";
import { londonDate } from "@/lib/domain/time";
import { requireManager } from "@/lib/session";
import { trainingData } from "@/lib/training-service";
import { BottomNav, TopBar } from "@/components/Chrome";
import { dayMonthYearAt } from "@/app/library/format";
import { PassportList, TrainBar } from "@/app/library/training/parts";
import { ConfirmButton, TakeBackButton } from "../TrainingButtons";

export const dynamic = "force-dynamic";

const EVENT_TEXT = (e: TrainingEvent, skill: string) => {
  switch (e.kind) {
    case "quiz": return `${skill}: quiz ${e.score}%, ${e.passed ? "passed" : "not passed"}`;
    case "done": return `${skill}: marked done by ${e.byName}`;
    case "confirmed": return `${skill}: confirmed by ${e.byName}`;
    case "reset": return `${skill}: ${e.byName} asked for it again: “${e.note}”`;
  }
};

/**
 * Someone's skills passport, for the managers who look after them: confirm a hands-on skill after watching them do
 * it, or ask for one to be done again. Their recent training record underneath.
 */
export default async function PersonTraining(props: { params: Promise<{ personId: string }> }) {
  const { personId } = await props.params;
  const ctx = await requireManager();
  const db = store();
  const [people, sites] = await Promise.all([db.people(), db.sites()]);
  const target = peopleInCare(ctx.person, people).find((p) => p.id === personId);
  if (!target) notFound();
  const d = await trainingData(db, [target.id]);
  const today = londonDate(Date.now());
  const rows = passport(target, sites, d, today);
  const t = tally(rows);
  const titles = new Map(d.skills.map((s) => [s.id, s.title]));
  const record = [...d.events].reverse().slice(0, 30);

  return (
    <>
      <TopBar ctx={ctx} />
      <main>
        <Link href="/manage/training" className="muted" style={{ fontWeight: 600 }}>← Training</Link>
        <div className="stack" style={{ gap: 6 }}><div className="eyebrow">Skills passport</div><h1 className="h-display">{target.name}</h1></div>
        {rows.length === 0 ? <div className="card muted">{target.name} has no training set: training follows their sections as staff or a manager at an open site.</div> : (
          <>
            <section className="card stack" style={{ gap: 10 }} aria-label="How it adds up">
              <TrainBar done={t.done} total={t.total} />
              {(t.overdue > 0 || t.ready > 0 || t.again > 0) && (
                <div className="row wrap" style={{ gap: 6 }}>
                  {t.overdue > 0 && <span className="chip bad">{t.overdue} overdue</span>}
                  {t.again > 0 && <span className="chip warn">{t.again} to do again</span>}
                  {t.ready > 0 && <span className="chip late">{t.ready} ready for a manager</span>}
                </div>
              )}
            </section>
            <PassportList rows={rows} today={today} href={(r) => `/library/training/${r.skill.id}`} actions={(r) => {
              if (!managesTraining(ctx.person, target, r.skill.section, sites).ok) return null;
              const confirm = canConfirmNow(r.skill, r.progress, r.hasQuiz).ok;
              const back = canTakeBackNow(r.progress).ok;
              const waitQuiz = r.skill.handsOn && r.hasQuiz && !r.progress.readyAt && (r.progress.state !== "done" || !!r.progress.renewal);
              if (!confirm && !back && !waitQuiz) return null;
              return (
                <div className="row wrap" style={{ gap: 8, paddingLeft: 16 }}>
                  {confirm && <ConfirmButton personId={target.id} skillId={r.skill.id} name={target.name} skill={r.skill.title} />}
                  {back && <TakeBackButton personId={target.id} skillId={r.skill.id} name={target.name} skill={r.skill.title} wasDone={!!r.progress.doneAt} />}
                  {waitQuiz && <span className="muted" style={{ fontSize: 13 }}>Confirm it once they&apos;ve passed the quiz{r.progress.state === "done" ? " again" : ""}.</span>}
                </div>
              );
            }} />
          </>
        )}
        {record.length > 0 && (
          <section className="stack" aria-label="Training record" style={{ gap: 8 }}>
            <h2 className="h-sec">Training record</h2>
            <div className="log">
              {record.map((e) => <div key={e.id}><span className="grow">{EVENT_TEXT(e, titles.get(e.skillId) ?? "A skill")}</span><span className="muted">{dayMonthYearAt(e.at)}</span></div>)}
            </div>
          </section>
        )}
      </main>
      <BottomNav ctx={ctx} current={ctx.isLead ? "owner" : "manage"} />
    </>
  );
}
