import Link from "next/link";
import type { ReactNode } from "react";
import { PATHWAY_TEXT, progressText, STATE_TEXT, type PassportRow, type Progress } from "@/lib/domain/training";
import type { Area } from "@/lib/domain/types";

const TONE: Record<Progress["state"], string> = { done: "done", ready: "late", in_training: "", not_started: "", refresher: "warn" };

/** Where someone stands on a skill, as a chip (and "Overdue", or a refresher waiting for its check, beside it). */
export function StateChips({ p }: { p: Progress }) {
  const text = p.state === "refresher" && p.why === "expired" ? "Refresher due" : STATE_TEXT[p.state];
  return (
    <span className="chips">
      <span className={`chip ${TONE[p.state]}`}>{text}</span>
      {p.state === "done" && p.readyAt && <span className="chip late">{STATE_TEXT.ready}</span>}
      {p.overdue && <span className="chip bad">Overdue</span>}
    </span>
  );
}

/** "12 of 25 done", with a bar. */
export function TrainBar({ done, total, label }: { done: number; total: number; label?: string }) {
  const pct = total ? Math.round((100 * done) / total) : 0;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 8 }}><span className="strong grow">{label ?? `${done} of ${total} done`}</span><span className="muted">{pct}%</span></div>
      <div className="train-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={label ?? "Training done"}><i style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

/** Consecutive rows with the same heading, kept in pathway order. */
function byGroup(rows: PassportRow[]): { group: string; rows: PassportRow[] }[] {
  const out: { group: string; rows: PassportRow[] }[] = [];
  for (const r of rows) {
    const last = out.at(-1);
    if (last && last.group === r.skill.group) last.rows.push(r); else out.push({ group: r.skill.group, rows: [r] });
  }
  return out;
}

/**
 * A passport, pathway by pathway and heading by heading: each skill with where they stand and when it's due. `href`
 * links a skill; `actions` adds a manager's buttons under it.
 */
export function PassportList({ rows, today, href, actions }: { rows: PassportRow[]; today: string; href?: (r: PassportRow) => string; actions?: (r: PassportRow) => ReactNode }) {
  const sections = Array.from(new Set(rows.map((r) => r.skill.section))) as Area[];
  return (
    <>
      {sections.map((sec) => {
        const mine = rows.filter((r) => r.skill.section === sec);
        return (
          <section key={sec} className="stack" aria-label={`${PATHWAY_TEXT[sec]} training`}>
            <div className="row wrap" style={{ alignItems: "baseline" }}>
              <h2 className="h-sec grow">{PATHWAY_TEXT[sec]}</h2>
              <span className="muted">{mine.filter((r) => r.progress.state === "done").length} of {mine.length} done</span>
            </div>
            {byGroup(mine).map((g) => (
              <div key={g.group} className="stack" style={{ gap: 8 }}>
                <div className="eyebrow">{g.group}</div>
                {g.rows.map((r) => {
                  const body = (
                    <>
                      <span className="grow">
                        <span className="strong" style={{ display: "block" }}>{r.skill.title}</span>
                        <span className="muted">{progressText(r.progress, today)}{r.skill.handsOn ? " · a manager checks it" : r.hasQuiz ? " · quiz" : ""}</span>
                      </span>
                      <StateChips p={r.progress} />
                    </>
                  );
                  return (
                    <div key={r.skill.id} className="stack" style={{ gap: 6 }}>
                      {href ? <Link href={href(r)} className="list-btn lib-item">{body}</Link> : <div className="list-btn lib-item">{body}</div>}
                      {actions?.(r)}
                    </div>
                  );
                })}
              </div>
            ))}
          </section>
        );
      })}
    </>
  );
}
