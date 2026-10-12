import Link from "next/link";
import { store } from "@/lib/data";
import { peopleInCare } from "@/lib/domain/certificates";
import { sectionsFor } from "@/lib/domain/staff";
import { canConfirmNow, canEditTraining, managesTraining, passport, PATHWAY_TEXT, progressText, tally, type PassportRow, type Progress } from "@/lib/domain/training";
import { londonDate } from "@/lib/domain/time";
import { requireManager } from "@/lib/session";
import { trainingData } from "@/lib/training-service";
import { BottomNav, TopBar } from "@/components/Chrome";
import { pickSite } from "../load";
import { ConfirmButton } from "./TrainingButtons";

export const dynamic = "force-dynamic";

const CELL: Record<Progress["state"], { text: string; tone: string }> = {
  done: { text: "✓", tone: "done" }, ready: { text: "Check", tone: "late" }, in_training: { text: "…", tone: "" }, not_started: { text: "–", tone: "" },
  refresher: { text: "Again", tone: "warn" },
};

/**
 * A site's training: hands-on skills waiting for a manager's check, who has something overdue, and who has done
 * what, pathway by pathway. Owners, operations managers and managers (their sites); confirming is for the manager of
 * that section (a head chef for kitchen skills), an operations manager or the owner.
 */
export default async function TeamTraining(props: { searchParams: Promise<{ site?: string }> }) {
  const searchParams = await props.searchParams;
  const ctx = await requireManager();
  const { sites: picker, site } = await pickSite(ctx.managed, searchParams.site, ctx.site.id);
  const db = store();
  const [sites, people, d] = await Promise.all([db.sites(), db.people(), trainingData(db)]);
  const today = londonDate(Date.now());
  const secs = sectionsFor(site.kind);
  const trainees = peopleInCare(ctx.person, people)
    .filter((p) => p.access.some((a) => a.siteId === site.id))
    .map((p) => ({ p, rows: passport(p, sites, d, today).filter((r) => secs.includes(r.skill.section)) }))
    .filter((x) => x.rows.length)
    .sort((a, b) => a.p.name.localeCompare(b.p.name));
  const waiting = trainees.flatMap(({ p, rows }) => rows
    .filter((r) => r.progress.state === "ready" && managesTraining(ctx.person, p, r.skill.section, sites).ok && canConfirmNow(r.skill, r.progress, r.hasQuiz).ok)
    .map((r) => ({ p, r })));
  const overdue = trainees.map(({ p, rows }) => ({ p, n: rows.filter((r) => r.progress.overdue).length })).filter((x) => x.n > 0);
  const totals = trainees.map((t) => tally(t.rows)).reduce((a, t) => ({ done: a.done + t.done, total: a.total + t.total }), { done: 0, total: 0 });
  const skills = d.skills.filter((s) => !s.retiredAt && secs.includes(s.section));
  const cell = (rows: PassportRow[], skillId: string) => rows.find((r) => r.skill.id === skillId);

  return (
    <>
      <TopBar ctx={ctx} />
      <main className="wide">
        <div className="row wrap" style={{ alignItems: "flex-end" }}>
          <div className="grow"><div className="eyebrow">Manager tools · skills passports</div><h1 className="h-display">Training</h1></div>
          {canEditTraining(ctx.person) && <Link className="btn ghost small" href="/manage/training/skills">Skills and quizzes</Link>}
          <Link className="btn ghost small" href="/library/training">My training</Link>
        </div>

        {picker.length > 1 && (
          <nav className="row wrap" style={{ gap: 6 }} aria-label="Site">
            {picker.map((s) => <Link key={s.id} className={`chip ${s.id === site.id ? "done" : ""}`} aria-current={s.id === site.id ? "page" : undefined} href={`/manage/training?site=${s.id}`}>{s.name}</Link>)}
          </nav>
        )}

        <div className="stats">
          <div className="card"><div className="stat">{trainees.length}</div><div className="muted">people training at {site.name}</div></div>
          <div className="card"><div className="stat" style={{ color: waiting.length ? "var(--accent)" : undefined }}>{waiting.length}</div><div className="muted">waiting for your check</div></div>
          <div className="card"><div className="stat" style={{ color: overdue.length ? "var(--bad)" : undefined }}>{overdue.length}</div><div className="muted">with something overdue</div></div>
          <div className="card"><div className="stat">{totals.total ? Math.round((100 * totals.done) / totals.total) : 0}%</div><div className="muted">of all their skills done</div></div>
        </div>

        {waiting.length > 0 && (
          <section className="stack" aria-label="Waiting for your check">
            <h2 className="h-sec">Waiting for your check</h2>
            <div className="muted">They&apos;ve passed the quiz (or said they&apos;re ready). Watch them do it, then confirm.</div>
            {waiting.map(({ p, r }) => (
              <div key={`${p.id}-${r.skill.id}`} className="card row wrap" style={{ gap: 10 }}>
                <span className="grow"><Link href={`/manage/training/${p.id}`} className="strong">{p.name}</Link>
                  <span className="muted" style={{ display: "block" }}>{r.skill.title} · {PATHWAY_TEXT[r.skill.section]}</span></span>
                <ConfirmButton personId={p.id} skillId={r.skill.id} name={p.name} skill={r.skill.title} />
              </div>
            ))}
          </section>
        )}

        {overdue.length > 0 && (
          <section className="stack" aria-label="Overdue">
            <h2 className="h-sec">Overdue</h2>
            <ul className="attention">
              {overdue.map(({ p, n }) => (
                <li key={p.id} className="critical"><Link href={`/manage/training/${p.id}`} className="grow" style={{ color: "inherit" }}>{p.name}</Link><span>{n} skill{n === 1 ? "" : "s"} overdue</span></li>
              ))}
            </ul>
          </section>
        )}

        {trainees.length === 0 ? <div className="card muted">Nobody at {site.name} has training set yet. Training follows each person&apos;s sections.</div> : secs.map((sec) => {
          const cols = trainees.filter((t) => t.rows.some((r) => r.skill.section === sec));
          const list = skills.filter((s) => s.section === sec);
          if (!cols.length || !list.length) return null;
          return (
            <section key={sec} className="stack" aria-label={`${PATHWAY_TEXT[sec]}: who has done what`}>
              <h2 className="h-sec">{PATHWAY_TEXT[sec]}</h2>
              <div className="table-wrap">
                <table className="rec matrix training-matrix">
                  <thead><tr><th>Skill</th>{cols.map(({ p }) => <th key={p.id}><Link href={`/manage/training/${p.id}`}>{p.name}</Link></th>)}</tr></thead>
                  <tbody>
                    {list.map((s) => (
                      <tr key={s.id}>
                        <th scope="row"><span style={{ fontWeight: 600 }}>{s.title}</span><div className="muted" style={{ fontWeight: 400 }}>{s.group}{s.handsOn ? " · hands-on" : ""}</div></th>
                        {cols.map(({ p, rows }) => {
                          const r = cell(rows, s.id);
                          if (!r) return <td key={p.id} />;
                          const c = CELL[r.progress.state];
                          return <td key={p.id} title={`${p.name} · ${s.title}: ${progressText(r.progress, today)}`}>
                            <span className={`chip ${r.progress.overdue ? "bad" : c.tone}`}>{r.progress.overdue && r.progress.state !== "refresher" ? "Overdue" : c.text}</span></td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
        {trainees.length > 0 && (
          <div className="row wrap muted" style={{ gap: 8, fontSize: 13 }}>
            <span><span className="chip done">✓</span> done</span>
            <span><span className="chip late">Check</span> ready for a manager</span>
            <span><span className="chip">…</span> in training</span>
            <span><span className="chip">–</span> not started</span>
            <span><span className="chip warn">Again</span> to do again</span>
            <span><span className="chip bad">Overdue</span></span>
          </div>
        )}
      </main>
      <BottomNav ctx={ctx} current={ctx.isLead ? "owner" : "manage"} />
    </>
  );
}
