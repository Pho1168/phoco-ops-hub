"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSkillGuide } from "@/app/actions";
import { moved, newKey, PhotoButton, Thumb, upload } from "@/app/library/fields";
import type { Photo } from "@/lib/domain/library";
import { GUIDE_LIMITS, type Guide } from "@/lib/domain/training";

interface Row { key: string; text: string }
interface StepRow { key: string; text: string; warning: string; photo?: Photo; uploading?: boolean }
const rows = (xs: string[]): Row[] => xs.map((text) => ({ key: newKey(), text }));
const stepRows = (xs: Guide["steps"]): StepRow[] => xs.map((s) => ({ key: newKey(), text: s.text, warning: s.warning ?? "", photo: s.photo }));

/** A list of short lines (when it applies, never, what good looks like): add, reorder, remove. */
function Lines({ title, help, list, set, placeholder }: { title: string; help: string; list: Row[]; set: (fn: (r: Row[]) => Row[]) => void; placeholder: string }) {
  return (
    <fieldset className="stack" style={{ gap: 6, border: 0, padding: 0, margin: 0 }}>
      <legend className="strong">{title}</legend>
      <span className="muted" style={{ fontSize: 13 }}>{help}</span>
      {list.map((r, i) => (
        <div key={r.key} className="row" style={{ gap: 6 }}>
          <input className="txt grow" style={{ maxWidth: "none" }} maxLength={GUIDE_LIMITS.item} placeholder={placeholder} aria-label={`${title} ${i + 1}`}
            value={r.text} onChange={(e) => set((cur) => cur.map((x) => (x.key === r.key ? { ...x, text: e.target.value } : x)))} />
          <button type="button" className="btn ghost small" aria-label={`Move ${title} ${i + 1} up`} disabled={i === 0} onClick={() => set((cur) => moved(cur, i, -1))}>↑</button>
          <button type="button" className="btn ghost small" aria-label={`Move ${title} ${i + 1} down`} disabled={i === list.length - 1} onClick={() => set((cur) => moved(cur, i, 1))}>↓</button>
          <button type="button" className="btn ghost small" aria-label={`Remove ${title} ${i + 1}`} onClick={() => set((cur) => cur.filter((x) => x.key !== r.key))}>✕</button>
        </div>
      ))}
      {list.length < GUIDE_LIMITS.list && <button type="button" className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={() => set((cur) => [...cur, { key: newKey(), text: "" }])}>Add a line</button>}
    </fieldset>
  );
}

/**
 * The skill's written guide: the training card staff read. Tagline, why it matters, when it applies, numbered steps
 * (each with a picture and an optional warning), the never-do list, what good looks like, a closing line, and the
 * big picture at the top. Pictures upload like SOP photos (made smaller on the device first).
 */
export function GuideForm({ skillId, guide, erased }: { skillId: string; guide: Guide; erased: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const [hero, setHero] = useState<{ photo?: Photo; uploading?: boolean }>({ photo: guide.hero });
  const [tagline, setTagline] = useState(guide.tagline ?? "");
  const [why, setWhy] = useState(guide.why ?? "");
  const [closing, setClosing] = useState(guide.closing ?? "");
  const [when, setWhen] = useState<Row[]>(rows(guide.when));
  const [never, setNever] = useState<Row[]>(rows(guide.never));
  const [looks, setLooks] = useState<Row[]>(rows(guide.looks));
  const [steps, setSteps] = useState<StepRow[]>(stepRows(guide.steps));
  const touch = () => setSaved(false);
  const patch = (key: string, p: Partial<StepRow>) => { touch(); setSteps((cur) => cur.map((s) => (s.key === key ? { ...s, ...p } : s))); };

  const photoFor = async (set: (p: { photo?: Photo; uploading?: boolean }) => void, keep: Photo | undefined, file: File | undefined) => {
    if (!file) return;
    setErr(""); set({ photo: keep, uploading: true });
    try { set({ photo: await upload(file), uploading: false }); touch(); } catch (e) { set({ photo: keep, uploading: false }); setErr(e instanceof Error ? e.message : "The picture didn't upload. Try again"); }
  };

  const submit = () => start(async () => {
    setErr("");
    const r = await saveSkillGuide(skillId, {
      hero: hero.photo, tagline, why, closing, when: when.map((x) => x.text), never: never.map((x) => x.text), looks: looks.map((x) => x.text),
      steps: steps.map((s) => ({ text: s.text, warning: s.warning || undefined, photo: s.photo })),
    });
    if (!r.ok) { setErr(r.error); return; }
    setSaved(true); router.refresh();
  });

  return (
    <form className="card stack guide-form" aria-label="Guide" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div><h2 className="h-sec">The guide</h2>
        <div className="muted" style={{ fontSize: 13 }}>What staff read: a training card in the Pho &amp; Co poster style. Leave a part empty and it isn&apos;t shown. Pictures: JPEG or PNG, made smaller on upload.</div></div>

      <div className="stack" style={{ gap: 6 }}><span className="strong">Big picture at the top</span>
        <div className="row wrap" style={{ gap: 10 }}>
          {hero.photo && <Thumb photo={hero.photo} label="Big picture" erased={erased.includes(hero.photo.id)} />}
          <PhotoButton label="Big picture" has={!!hero.photo} uploading={hero.uploading} onFile={(f) => void photoFor(setHero, hero.photo, f)} />
          {hero.photo && <button type="button" className="btn ghost small" onClick={() => { touch(); setHero({}); }}>Remove</button>}
        </div>
        <span className="muted" style={{ fontSize: 13 }}>A poster or an illustration of the skill. Optional.</span></div>

      <label className="stack" style={{ gap: 6 }}><span className="strong">Tagline</span>
        <input className="txt wide" maxLength={GUIDE_LIMITS.tagline} placeholder="e.g. Clean hands · safe food · healthy people" value={tagline} onChange={(e) => { touch(); setTagline(e.target.value); }} /></label>
      <label className="stack" style={{ gap: 6 }}><span className="strong">Why it matters</span>
        <textarea maxLength={GUIDE_LIMITS.why} placeholder="Two or three sentences. What goes wrong without it, for the guest, the team and the inspector." value={why} onChange={(e) => { touch(); setWhy(e.target.value); }} /></label>

      <Lines title="When it applies" help="Short lines: Before handling food · After the toilet · After touching your phone." list={when} set={(fn) => { touch(); setWhen(fn); }} placeholder="e.g. After handling raw meat, fish or eggs" />

      <fieldset className="stack" style={{ gap: 8, border: 0, padding: 0, margin: 0 }}>
        <legend className="strong">How to do it</legend>
        <span className="muted" style={{ fontSize: 13 }}>Numbered steps, one plain sentence each, with a picture. Add a warning where people get hurt or food gets unsafe.</span>
        {steps.map((s, i) => (
          <div key={s.key} className="editor-step">
            <div className="row" style={{ gap: 8 }}>
              <span className="sop-num" aria-hidden="true">{i + 1}</span><span className="grow strong">Step {i + 1}</span>
              <button type="button" className="btn ghost small" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => { touch(); setSteps((cur) => moved(cur, i, -1)); }}>↑</button>
              <button type="button" className="btn ghost small" aria-label={`Move step ${i + 1} down`} disabled={i === steps.length - 1} onClick={() => { touch(); setSteps((cur) => moved(cur, i, 1)); }}>↓</button>
              <button type="button" className="btn ghost small" aria-label={`Remove step ${i + 1}`} onClick={() => { if (!s.text || confirm(`Remove step ${i + 1}?`)) { touch(); setSteps((cur) => cur.filter((x) => x.key !== s.key)); } }}>✕</button>
            </div>
            <textarea aria-label={`Step ${i + 1}`} maxLength={GUIDE_LIMITS.step} placeholder="What to do, in plain words" value={s.text} onChange={(e) => patch(s.key, { text: e.target.value })} />
            <input className="txt wide warn-box" aria-label={`Warning for step ${i + 1}`} maxLength={GUIDE_LIMITS.warning} placeholder="Warning (optional), shown in red" value={s.warning} onChange={(e) => patch(s.key, { warning: e.target.value })} />
            <div className="row wrap" style={{ gap: 10 }}>
              {s.photo && <Thumb photo={s.photo} label={`Picture for step ${i + 1}`} erased={erased.includes(s.photo.id)} small />}
              <PhotoButton label={`Picture for step ${i + 1}`} has={!!s.photo} uploading={s.uploading} onFile={(f) => void photoFor((p) => patch(s.key, p), s.photo, f)} />
              {s.photo && <button type="button" className="btn ghost small" onClick={() => patch(s.key, { photo: undefined })}>Remove picture</button>}
            </div>
          </div>
        ))}
        {steps.length < GUIDE_LIMITS.steps && <button type="button" className="btn ghost" style={{ alignSelf: "flex-start" }} onClick={() => { touch(); setSteps((cur) => [...cur, { key: newKey(), text: "", warning: "" }]); }}>Add a step</button>}
      </fieldset>

      <Lines title="Do not forget" help="The things that fail an inspection or a guest. Shown with a red cross." list={never} set={(fn) => { touch(); setNever(fn); }} placeholder="e.g. Do not dry hands on your apron" />
      <Lines title="What good looks like" help="What a manager checks on the floor, or watches for before signing a hands-on skill off." list={looks} set={(fn) => { touch(); setLooks(fn); }} placeholder="e.g. Nails short and clean, no varnish" />
      <label className="stack" style={{ gap: 6 }}><span className="strong">Closing line</span>
        <input className="txt wide" maxLength={GUIDE_LIMITS.closing} placeholder="e.g. Clean hands, brighter days" value={closing} onChange={(e) => { touch(); setClosing(e.target.value); }} /></label>

      {err && <div className="err" role="alert">{err}</div>}
      <div className="row wrap" style={{ gap: 10 }}>
        <button className="btn accent grow" type="submit" disabled={pending || steps.some((s) => s.uploading) || hero.uploading}>{pending ? "Saving…" : "Save the guide"}</button>
        {saved && <span className="chip done" role="status">Saved</span>}
      </div>
    </form>
  );
}
