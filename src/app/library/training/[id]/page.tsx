import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { store } from "@/lib/data";
import { KIND_TEXT, type LibraryDoc } from "@/lib/domain/library";
import { seesRecipes } from "@/lib/domain/recipes";
import { canEditTraining, PATHWAY_TEXT, progressText, quizOf, WHY_TEXT, type TrainingEvent } from "@/lib/domain/training";
import { londonDate } from "@/lib/domain/time";
import { current } from "@/lib/session";
import { myTraining } from "@/lib/training-service";
import { BottomNav, PhoneTopBar, TopBar } from "@/components/Chrome";
import { dayMonthYearAt } from "../../format";
import { StateChips } from "../parts";
import { MarkDone } from "./MarkDone";

export const dynamic = "force-dynamic";

const EVENT_TEXT = (e: TrainingEvent, mine: boolean) => {
  switch (e.kind) {
    case "quiz": return `Quiz: ${e.score}%, ${e.passed ? "passed" : "not passed"}`;
    case "done": return mine ? "Marked done" : `Marked done by ${e.byName}`;
    case "confirmed": return `Confirmed by ${e.byName}`;
    case "reset": return `${e.byName} asked for it to be done again: “${e.note}”`;
  }
};

/**
 * One skill: what it covers, what to read and watch, the quiz, and (if it's one of theirs) where they stand. Anyone
 * signed in can look; recipes it links to only open on the shop tablet, for kitchen staff.
 */
export default async function SkillPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await current();
  if (!ctx) redirect("/login");
  if (ctx.person.pinMustChange) redirect("/pin");
  const db = store();
  const skill = await db.trainingSkill(id);
  if (!skill) notFound();
  const full = ctx.scope === "full";
  const editor = full && canEditTraining(ctx.person);
  if (skill.retiredAt && !editor) notFound();
  const sites = await db.sites();
  const [{ rows }, questions, docs] = await Promise.all([
    myTraining(ctx.person, sites, db), db.trainingQuestions([skill.id]),
    Promise.all(skill.links.map((l) => db.libraryDoc(l))).then((d) => d.filter((x): x is LibraryDoc => !!x)),
  ]);
  const row = rows.find((r) => r.skill.id === skill.id);
  const quiz = quizOf(skill.id, questions);
  const events = row ? (await db.trainingEvents({ personIds: [ctx.person.id], skillIds: [skill.id] })).reverse().slice(0, 10) : [];
  const recipesOk = full && seesRecipes(ctx.person, sites);
  const today = londonDate(Date.now());
  const p = row?.progress;

  return (
    <>
      {full ? <TopBar ctx={ctx} /> : <PhoneTopBar ctx={ctx} />}
      <main>
        <Link href="/library/training" className="muted" style={{ fontWeight: 600 }}>← Training</Link>
        <div className="stack" style={{ gap: 6 }}>
          <div className="eyebrow">{PATHWAY_TEXT[skill.section]} · {skill.group}</div>
          <h1 className="h-display">{skill.title}</h1>
          <div className="muted">{skill.handsOn ? "Hands-on: a manager confirms it once they've watched you do it." : quiz.length ? "Done when you pass the quiz." : "Done when you've read and watched it."}
            {skill.refresherMonths ? ` Done again every ${skill.refresherMonths} months.` : ""}</div>
        </div>
        {skill.retiredAt && <div className="alert bad" role="status">Retired: it isn&apos;t part of anyone&apos;s training.</div>}

        {p && (
          <section className="card stack" aria-label="Where you stand" style={{ gap: 6 }}>
            <div className="row wrap" style={{ gap: 8 }}><span className="strong grow">{progressText(p, today)}</span><StateChips p={p} /></div>
            {p.why && p.state !== "done" && <div className="muted">{WHY_TEXT[p.why]}{p.doneAt ? `. Last done ${dayMonthYearAt(p.doneAt)}.` : "."}</div>}
            {p.state === "done" && p.doneKind === "confirmed" && <div className="muted">Confirmed by {p.doneBy} on {dayMonthYearAt(p.doneAt!)}.</div>}
            {p.state === "ready" && <div className="muted">Waiting for a manager to watch you do it and confirm it.</div>}
          </section>
        )}

        {skill.about && <section className="card" aria-label="What it covers" style={{ whiteSpace: "pre-wrap" }}>{skill.about}</section>}

        {docs.length > 0 && (
          <section className="stack" aria-label="Read" style={{ gap: 8 }}>
            <h2 className="h-sec">Read</h2>
            {docs.map((d) => {
              const title = d.published?.title ?? d.open?.title ?? d.code;
              const link = !d.published || d.retiredAt ? undefined : d.kind === "prep" && !recipesOk ? undefined : `/library/${d.id}`;
              const note = !d.published ? "Not published yet" : d.retiredAt ? "Retired" : d.kind === "prep" && !recipesOk ? "On the shop tablet, for kitchen staff" : "";
              const body = (
                <>
                  <span className="grow"><span className="strong" style={{ display: "block" }}>{title}</span><span className="muted">{KIND_TEXT[d.kind]} · <span className="lib-code">{d.code}</span>{note ? ` · ${note}` : ""}</span></span>
                </>
              );
              return link ? <Link key={d.id} href={link} className="list-btn lib-item">{body}</Link> : <div key={d.id} className="list-btn lib-item">{body}</div>;
            })}
          </section>
        )}

        {skill.videoUrl && (
          <section className="stack" aria-label="Watch" style={{ gap: 8 }}>
            <h2 className="h-sec">Watch</h2>
            <a className="btn ghost" href={skill.videoUrl} target="_blank" rel="noopener noreferrer">Watch the video ↗</a>
            <div className="muted" style={{ fontSize: 13 }}>Opens in a new tab.</div>
          </section>
        )}

        <section className="card stack" aria-label="Quiz" style={{ gap: 10 }}>
          <h2 className="h-sec">Quiz</h2>
          {quiz.length > 0 ? (
            <>
              <div className="muted">{quiz.length} question{quiz.length === 1 ? "" : "s"} · pass mark {skill.passMark}%</div>
              {row && !skill.retiredAt && (
                <Link className={`btn ${p!.state === "done" || p!.state === "ready" ? "ghost" : "accent"}`} href={`/library/training/${skill.id}/quiz`}>
                  {p!.state === "done" || p!.state === "ready" ? "Take it again" : p!.attempts ? "Try the quiz again" : "Take the quiz"}
                </Link>
              )}
              {!row && <div className="muted">The quiz is for people whose training includes this skill.</div>}
            </>
          ) : (
            <>
              <div className="muted">No quiz for this one yet.</div>
              {row && !skill.retiredAt && p!.state !== "done" && p!.state !== "ready" && <MarkDone skillId={skill.id} handsOn={skill.handsOn} />}
            </>
          )}
        </section>

        {events.length > 0 && (
          <section className="stack" aria-label="What you've done" style={{ gap: 8 }}>
            <h2 className="h-sec">What you&apos;ve done</h2>
            <div className="log">
              {events.map((e) => <div key={e.id}><span className="grow">{EVENT_TEXT(e, e.byId === ctx.person.id)}</span><span className="muted">{dayMonthYearAt(e.at)}</span></div>)}
            </div>
          </section>
        )}

        {editor && <Link className="btn ghost small" href={`/manage/training/skills/${skill.id}`}>Edit this skill</Link>}
      </main>
      {full && <BottomNav ctx={ctx} current="library" />}
    </>
  );
}
