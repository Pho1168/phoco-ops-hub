import Link from "next/link";
import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { managedSites } from "@/lib/domain/access";
import { seesRecipes } from "@/lib/domain/recipes";
import { canEditTraining, pathwayOf, PATHWAY_TEXT } from "@/lib/domain/training";
import { londonDate } from "@/lib/domain/time";
import { current } from "@/lib/session";
import { myTraining } from "@/lib/training-service";
import { BottomNav, PhoneTopBar, TopBar } from "@/components/Chrome";
import { LibraryTabs } from "../LibraryTabs";
import { PassportList, TrainBar } from "./parts";

export const dynamic = "force-dynamic";

/**
 * My training (the shop tablet or their own phone): each skill in their pathways with where they stand and when it's
 * due. Managers get a link to their team's; the owner and operations managers to the skills and quizzes.
 */
export default async function MyTraining() {
  const ctx = await current();
  if (!ctx) redirect("/login");
  if (ctx.person.pinMustChange) redirect("/pin");
  const db = store();
  const sites = await db.sites();
  const full = ctx.scope === "full";
  const [{ rows, tally }, pathways] = await Promise.all([myTraining(ctx.person, sites, db), db.trainingPathways()]);
  const today = londonDate(Date.now());
  const manager = full && managedSites(ctx.person).length > 0;
  const sections = Array.from(new Set(rows.map((r) => r.skill.section)));

  return (
    <>
      {full ? <TopBar ctx={ctx} /> : <PhoneTopBar ctx={ctx} />}
      <main>
        <div className="row wrap" style={{ alignItems: "flex-end" }}>
          <div className="grow"><div className="eyebrow">Your skills passport</div><h1 className="h-display">Training</h1></div>
          {manager && <Link className="btn ghost small" href="/manage/training">Your team</Link>}
          {full && canEditTraining(ctx.person) && <Link className="btn ghost small" href="/manage/training/skills">Skills and quizzes</Link>}
        </div>
        <LibraryTabs current="training" recipes={full && seesRecipes(ctx.person, sites)} />

        {rows.length === 0 ? (
          <div className="card muted">
            {manager ? "There's no training for you to do here. Your team's training is under Your team." : "There's no training set for you yet."}
          </div>
        ) : (
          <>
            <section className="card stack" aria-label="How it adds up" style={{ gap: 10 }}>
              <TrainBar done={tally.done} total={tally.total} />
              {(tally.overdue > 0 || tally.again > 0 || tally.ready > 0) && (
                <div className="row wrap" style={{ gap: 6 }}>
                  {tally.overdue > 0 && <span className="chip bad">{tally.overdue} overdue</span>}
                  {tally.again > 0 && <span className="chip warn">{tally.again} to do again</span>}
                  {tally.ready > 0 && <span className="chip late">{tally.ready} waiting for a manager to check you</span>}
                </div>
              )}
              <div className="muted" style={{ fontSize: 14 }}>
                {sections.map((s) => {
                  const p = pathwayOf(pathways, s);
                  return `${PATHWAY_TEXT[s]}: induction within ${p.inductionDays} days of starting, everything within ${p.allDays} days.`;
                }).join(" ")}
                {" "}Tap a skill to read, watch and take its quiz. Hands-on skills are checked by a manager.
              </div>
            </section>
            <PassportList rows={rows} today={today} href={(r) => `/library/training/${r.skill.id}`} />
          </>
        )}
      </main>
      {full && <BottomNav ctx={ctx} current="library" />}
    </>
  );
}
