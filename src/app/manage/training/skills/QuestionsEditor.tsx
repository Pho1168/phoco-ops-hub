"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveQuestions, retireQuestion, saveQuestion } from "@/app/actions";
import { TRAINING_LIMITS } from "@/lib/domain/training";

export interface EditQuestion { id: string; text: string; options: string[]; answer: number; approved: boolean }

/** One question: its words, up to six answers, which one is right. Blank answers are dropped when it's saved. */
function QuestionForm({ skillId, q, n, onDone }: { skillId: string; q?: EditQuestion; n: number; onDone?: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const blank = (k: number) => Array.from({ length: k }, () => "");
  const [text, setText] = useState(q?.text ?? "");
  const [options, setOptions] = useState<string[]>(q ? [...q.options, ...blank(Math.max(0, 3 - q.options.length))] : blank(3));
  const [answer, setAnswer] = useState(q?.answer ?? -1);
  const label = q ? `Question ${n}` : "New question";
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => start(async () => {
    setErr(""); setSaved(false);
    const r = await fn();
    if (!r.ok) { setErr(r.error ?? "Something went wrong"); return; }
    after?.(); router.refresh();
  });
  return (
    <form className="card stack quiz-edit" style={{ gap: 8 }} aria-label={label}
      onSubmit={(e) => { e.preventDefault(); run(() => saveQuestion(skillId, q?.id ?? null, { text, options, answer }), () => { if (q) setSaved(true); else { setText(""); setOptions(blank(3)); setAnswer(-1); onDone?.(); } }); }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <span className="strong grow">{label}</span>
        {q && <span className={`chip ${q.approved ? "done" : "late"}`}>{q.approved ? "Approved" : "Draft: not asked yet"}</span>}
      </div>
      <textarea aria-label={`${label}: the question`} required maxLength={TRAINING_LIMITS.question} value={text} onChange={(e) => { setText(e.target.value); setSaved(false); }} placeholder="The question" />
      {options.map((o, i) => (
        <div key={i} className="row" style={{ gap: 8 }}>
          <input type="radio" name={`right-${q?.id ?? "new"}`} aria-label={`${label}: answer ${i + 1} is right`} checked={answer === i} onChange={() => { setAnswer(i); setSaved(false); }} />
          <input className="txt grow" aria-label={`${label}: answer ${i + 1}`} maxLength={TRAINING_LIMITS.option} value={o}
            onChange={(e) => { const v = e.target.value; setOptions((x) => x.map((y, j) => (j === i ? v : y))); setSaved(false); }} placeholder={`Answer ${i + 1}`} />
        </div>
      ))}
      <div className="row wrap" style={{ gap: 8 }}>
        {options.length < TRAINING_LIMITS.options && <button type="button" className="btn ghost small" onClick={() => setOptions((x) => [...x, ""])}>Add an answer</button>}
        <span className="muted grow" style={{ fontSize: 13 }}>Tick the right answer. Blank ones are left out.</span>
      </div>
      {err && <div className="err" role="alert">{err}</div>}
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn accent small" type="submit" disabled={pending}>{pending ? "Saving…" : q ? "Save" : "Add the question"}</button>
        {q && <button type="button" className="btn ghost small" disabled={pending} onClick={() => run(() => retireQuestion(skillId, q.id))}>Remove</button>}
        {saved && <span className="chip done" role="status">Saved</span>}
      </div>
    </form>
  );
}

/**
 * A skill's quiz. Questions the owner or an operations manager adds are asked straight away; drafted ones (from the
 * import) only once approved. Changing a question keeps its approval.
 */
export function QuestionsEditor({ skillId, questions }: { skillId: string; questions: EditQuestion[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(questions.length === 0);
  const drafts = questions.filter((q) => !q.approved).length;
  return (
    <section className="stack" aria-label="Quiz questions">
      <div className="row wrap" style={{ gap: 8 }}>
        <h2 className="h-sec grow">Quiz ({questions.length})</h2>
        {drafts > 0 && (
          <button type="button" className="btn accent small" disabled={pending} onClick={() => start(async () => {
            setErr("");
            const r = await approveQuestions(skillId);
            if (!r.ok) setErr(r.error); else router.refresh();
          })}>{pending ? "Approving…" : `Approve ${drafts === 1 ? "the drafted question" : `all ${drafts} drafted questions`}`}</button>
        )}
      </div>
      {drafts > 0 && <div className="muted">Drafted questions aren&apos;t asked until you approve them. Check each one first: change it or remove it if it&apos;s wrong.</div>}
      {err && <div className="err" role="alert">{err}</div>}
      {questions.map((q, i) => <QuestionForm key={q.id} skillId={skillId} q={q} n={i + 1} />)}
      {adding ? <QuestionForm skillId={skillId} n={questions.length + 1} /> : <button type="button" className="btn ghost" onClick={() => setAdding(true)}>Add a question</button>}
    </section>
  );
}
