import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { store } from "@/lib/data";
import { KIND_TEXT, type LibraryDoc } from "@/lib/domain/library";
import { seesRecipes } from "@/lib/domain/recipes";
import { canEditTraining, canMarkDone, guideHasContent, guidePhotoIds, PATHWAY_TEXT, progressText, quizOf, WHY_TEXT, type Progress, type TrainingEvent } from "@/lib/domain/training";
import { dayMonthYear } from "@/lib/domain/time";
import { londonDate } from "@/lib/domain/time";
import { current } from "@/lib/session";
import { myTraining } from "@/lib/training-service";
import { BottomNav, PhoneTopBar, TopBar } from "@/components/Chrome";
import { dayMonthYearAt } from "../../format";
import { StateChips } from "../parts";
import { MarkDone } from "./MarkDone";
import { SkillCard } from "../SkillCard";
import { brandOf } from "@/lib/domain/brand";

export const dynamic = "force-dynamic";

/** How to keep a skill in date once its refresher is coming up. */
const renewText = (handsOn: boolean, quiz: boolean, p: Progress) => {
  const by = `Its refresher is coming up: do it again by ${dayMonthYear(p.dueOn!)} to keep it in date.`;
  if (handsOn) return `${by} ${quiz ? "Take the quiz again, then a manager" : "Say you're ready below, then a manager"} watches you do it and confirms it.`;
  return `${by} ${quiz ? "Take the quiz again." : "Go through it again, then mark it done."}`;
};

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
  // Only published SOPs and recipes reach staff; editors also see links to ones still being written or retired.
  const shown = editor ? docs : docs.filter((d) => d.published && !d.retiredAt);
  const events = row ? (await db.trainingEvents({ personIds: [ctx.person.id], skillIds: [skill.id] })).reverse().slice(0, 10) : [];
  const recipesOk = full && seesRecipes(ctx.person, sites);
  // The written guide, as a card. A picture the owner has erased shows as removed.
  const guide = guideHasContent(skill.guide) ? skill.guide : undefined;
  const erased = guide ? Array.from((await db.mediaStatus(guidePhotoIds(guide))).entries()).filter(([, m]) => m.erased).map(([id]) => id) : [];
  const today = londonDate(Date.now());
  const p = row?.progress;

  const Bar = full ? TopBar : PhoneTopBar;
  return (
    <>
      <Bar ctx={ctx} title={skill.title} eyebrow={`${PATHWAY_TEXT[skill.section]} · ${skill.group}`} back="/library/training" />
      <main className={guide ? "wide" : undefined}>
        <div className="muted">{skill.handsOn ? "Hands-on: a manager confirms it once they've watched you do it." : quiz.length || row?.drafted ? "Done when you pass the quiz." : "Done when you've read and watched it."}
          {skill.refresherMonths ? ` Done again every ${skill.refresherMonths} months.` : ""}</div>
        {skill.retiredAt && <div className="alert bad" role="status">Retired: it isn&apos;t part of anyone&apos;s training.</div>}

        {p && (
          <section className="card stack" aria-label="Where you stand" style={{ gap: 6 }}>
            <div className="row wrap" style={{ gap: 8 }}><span className="strong grow">{progressText(p, today)}</span><StateChips p={p} /></div>
            {p.why && p.state !== "done" && <div className="muted">{WHY_TEXT[p.why]}{p.doneAt ? `. Last done ${dayMonthYearAt(p.doneAt)}.` : "."}</div>}
            {p.state === "done" && p.doneKind === "confirmed" && <div className="muted">Confirmed by {p.doneBy} on {dayMonthYearAt(p.doneAt!)}.</div>}
            {p.state === "done" && p.renewal && !p.readyAt && <div className="muted">{renewText(skill.handsOn, quiz.length > 0, p)}</div>}
            {p.readyAt && <div className="muted">Waiting for a manager to watch you do it{p.state === "done" ? " again" : ""} and confirm it.</div>}
          </section>
        )}

        {guide && <SkillCard skill={skill} guide={guide} erased={erased} team={brandOf(ctx.site).name} />}
        {skill.about && !guide && <section className="card" aria-label="What it covers" style={{ whiteSpace: "pre-wrap" }}>{skill.about}</section>}

        {shown.length > 0 && (
          <section className="stack" aria-label="Read" style={{ gap: 8 }}>
            <h2 className="h-sec">Read</h2>
            {shown.map((d) => {
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
              <div className="muted">{row?.drafted && !skill.handsOn ? "Its quiz is being written: you'll take it once it's ready." : "No quiz for this one yet."}</div>
              {row && !skill.retiredAt && canMarkDone(skill, row.progress, { asked: false, drafted: row.drafted }).ok && <MarkDone skillId={skill.id} handsOn={skill.handsOn} again={row.progress.state === "done"} />}
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
