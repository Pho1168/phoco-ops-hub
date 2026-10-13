"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitQuiz, type QuizOutcome } from "@/app/actions";

export interface QuizQuestion { id: string; text: string; options: { i: number; text: string }[] }

/** What happens next, in words. */
const NEXT: Record<QuizOutcome["next"], string> = {
  done: "This skill is done.",
  ready: "Next, a manager watches you do it and confirms it.",
  practice: "It was already done, so nothing changes: good practice.",
  again: "Saved.",
};

const mix = <T,>(xs: T[]): T[] => {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/**
 * A skill's quiz, one card per question, in the order the page dealt them. The answers are checked on the server;
 * the page never gets the right ones. The order is kept while the page redraws (saving an attempt redraws it), and
 * "Try again" deals a new one here.
 */
export function Quiz({ skillId, version, questions, backHref }: { skillId: string; version: string; questions: QuizQuestion[]; backHref: string }) {
  const router = useRouter();
  const [shown, setShown] = useState(questions);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<QuizOutcome | null>(null);
  const [err, setErr] = useState<{ text: string; restart?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const top = useRef<HTMLDivElement>(null);
  const answered = shown.filter((q) => answers[q.id] !== undefined).length;
  const toTop = () => requestAnimationFrame(() => top.current?.scrollIntoView({ behavior: "smooth", block: "start" }));

  const send = () => start(async () => {
    setErr(null);
    const r = await submitQuiz(skillId, { version, answers });
    if (!r.ok) { setErr({ text: r.error, restart: r.restart }); return; }
    setResult(r.result ?? null);
    toTop();
  });
  const again = () => { setShown((s) => mix(s).map((q) => ({ ...q, options: mix(q.options) }))); setAnswers({}); setResult(null); setErr(null); toTop(); };

  return (
    <div className="stack" ref={top}>
      {result && (
        <section className={`alert ${result.passed ? "good" : "bad"}`} role="status" style={{ alignItems: "flex-start" }}>
          <div className="grow stack" style={{ gap: 8 }}>
            <div className="strong">{result.passed ? "Passed" : "Not passed yet"}: {result.correct} of {result.total} right ({result.score}%)</div>
            {result.passed
              ? <div>{NEXT[result.next]}</div>
              : <div>{result.next === "done" || result.next === "practice" ? "It's still done: this try doesn't change that. " : ""}You need {result.passMark}%. Look again at:</div>}
            {!result.passed && (
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {shown.filter((q) => result.wrong.includes(q.id)).map((q) => <li key={q.id}>{q.text}</li>)}
              </ul>
            )}
            <div className="row wrap" style={{ gap: 8 }}>
              {!result.passed && <button type="button" className="btn accent small" onClick={again}>Try again</button>}
              <Link className="btn ghost small" href={backHref}>Back to the skill</Link>
            </div>
          </div>
        </section>
      )}

      <form className="stack" onSubmit={(e) => { e.preventDefault(); send(); }} aria-label="Quiz">
        {shown.map((q, n) => (
          <fieldset key={q.id} className="card stack quiz-q" style={{ gap: 8 }} disabled={!!result || pending}>
            <legend className="strong">{n + 1}. {q.text}</legend>
            {q.options.map((o) => (
              <label key={o.i} className="quiz-option">
                <input type="radio" name={q.id} value={o.i} checked={answers[q.id] === o.i}
                  onChange={() => setAnswers((a) => ({ ...a, [q.id]: o.i }))} />
                <span>{o.text}</span>
              </label>
            ))}
          </fieldset>
        ))}
        {err && (
          <div className="err row wrap" role="alert" style={{ gap: 8 }}>
            <span className="grow">{err.text}</span>
            {err.restart && <button type="button" className="btn ghost small" onClick={() => router.refresh()}>Start again</button>}
          </div>
        )}
        {!result && (
          <div className="row wrap" style={{ gap: 10, alignItems: "center" }}>
            <span className="muted grow">{answered} of {shown.length} answered</span>
            <button type="submit" className="btn accent" disabled={pending || answered < shown.length}>{pending ? "Checking…" : "Check my answers"}</button>
          </div>
        )}
      </form>
    </div>
  );
}
