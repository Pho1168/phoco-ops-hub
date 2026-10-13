"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSkill, saveSkill } from "@/app/actions";
import { PATHWAYS, PATHWAY_TEXT, TRAINING_LIMITS, type Skill } from "@/lib/domain/training";

export interface LinkOption { id: string; label: string; kind: "SOP" | "Prep recipe" | "Dish"; note?: string }
const REFRESHERS = [3, 6, 12, 24, 36];

/**
 * A skill's details: its pathway and heading, what it covers, hands-on or not, induction, the SOPs and recipes to
 * read, a video link, a refresher and the quiz's pass mark. New skills go last in their pathway.
 */
export function SkillForm({ skill, section, groups, options }: {
  skill?: Skill; section: Skill["section"]; groups: Record<string, string[]>; options: LinkOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const [rev, setRev] = useState(skill?.rev ?? 0);
  const [s, setS] = useState({
    section: skill?.section ?? section, group: skill?.group ?? "", title: skill?.title ?? "", about: skill?.about ?? "",
    handsOn: skill?.handsOn ?? false, induction: skill?.induction ?? false, links: skill?.links ?? [], videoUrl: skill?.videoUrl ?? "",
    refresherMonths: skill?.refresherMonths ?? null as number | null, passMark: skill?.passMark ?? 80,
  });
  const [find, setFind] = useState("");
  const set = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => { setSaved(false); setS((x) => ({ ...x, [k]: v })); };
  const shown = useMemo(() => {
    const words = find.toLowerCase().split(/\s+/).filter(Boolean);
    return options.filter((o) => s.links.includes(o.id) || (words.length > 0 && words.every((w) => o.label.toLowerCase().includes(w))));
  }, [find, options, s.links]);
  const refreshers = s.refresherMonths && !REFRESHERS.includes(s.refresherMonths) ? [...REFRESHERS, s.refresherMonths].sort((a, b) => a - b) : REFRESHERS;

  const submit = () => start(async () => {
    setErr("");
    if (skill) {
      const r = await saveSkill(skill.id, rev, s);
      if (!r.ok) { setErr(r.error); return; }
      setRev(r.rev!); setSaved(true); router.refresh();
    } else {
      const r = await createSkill(s);
      if (!r.ok) { setErr(r.error); return; }
      router.push(`/manage/training/skills/${r.id}`);
    }
  });

  return (
    <form className="card stack skill-form" onSubmit={(e) => { e.preventDefault(); submit(); }} aria-label="Skill">
      <label className="stack" style={{ gap: 6 }}><span className="strong">Name</span>
        <input id="skill-title" className="txt" required maxLength={TRAINING_LIMITS.title} value={s.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Pho station" /></label>
      <div className="row wrap" style={{ gap: 10 }}>
        <label className="stack grow" style={{ gap: 6 }}><span className="strong">Pathway</span>
          <select id="skill-section" className="txt" value={s.section} onChange={(e) => set("section", e.target.value as Skill["section"])}>
            {PATHWAYS.map((p) => <option key={p} value={p}>{PATHWAY_TEXT[p]}</option>)}
          </select></label>
        <label className="stack grow" style={{ gap: 6 }}><span className="strong">Heading</span>
          <input id="skill-group" className="txt" list="skill-groups" required maxLength={TRAINING_LIMITS.group} value={s.group} onChange={(e) => set("group", e.target.value)} placeholder="e.g. Service" />
          <datalist id="skill-groups">{(groups[s.section] ?? []).map((g) => <option key={g} value={g} />)}</datalist></label>
      </div>
      <label className="stack" style={{ gap: 6 }}><span className="strong">What it covers</span>
        <textarea id="skill-about" maxLength={TRAINING_LIMITS.about} value={s.about} onChange={(e) => set("about", e.target.value)} placeholder="What they need to know or be able to do" /></label>
      <label className="row" style={{ gap: 10 }}><input type="checkbox" checked={s.handsOn} onChange={(e) => set("handsOn", e.target.checked)} />
        <span>Hands-on: a manager confirms it after watching them do it</span></label>
      <label className="row" style={{ gap: 10 }}><input type="checkbox" checked={s.induction} onChange={(e) => set("induction", e.target.checked)} />
        <span>Part of induction: due within the pathway&apos;s induction days</span></label>

      <fieldset className="stack" style={{ gap: 8, border: 0, padding: 0, margin: 0 }}>
        <legend className="strong">SOPs and recipes to read</legend>
        <input id="skill-link-find" className="txt" type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find an SOP, recipe or dish" />
        {shown.length === 0 && <span className="muted">{find ? "Nothing found." : "None linked. Type to find one."}</span>}
        {shown.map((o) => (
          <label key={o.id} className="row" style={{ gap: 10 }}>
            <input type="checkbox" checked={s.links.includes(o.id)} disabled={!s.links.includes(o.id) && s.links.length >= TRAINING_LIMITS.links}
              onChange={(e) => set("links", e.target.checked ? [...s.links, o.id] : s.links.filter((l) => l !== o.id))} />
            <span className="grow">{o.label} <span className="muted">· {o.kind}{o.note ? ` · ${o.note}` : ""}</span></span>
          </label>
        ))}
      </fieldset>

      <label className="stack" style={{ gap: 6 }}><span className="strong">Video link</span>
        <input id="skill-video" className="txt" type="url" inputMode="url" maxLength={TRAINING_LIMITS.url} value={s.videoUrl} onChange={(e) => set("videoUrl", e.target.value)} placeholder="https://youtu.be/…" />
        <span className="muted" style={{ fontSize: 13 }}>YouTube (unlisted), Vimeo or Google Drive. Anyone with the link can watch it.</span></label>
      <div className="row wrap" style={{ gap: 10 }}>
        <label className="stack grow" style={{ gap: 6 }}><span className="strong">Refresher</span>
          <select id="skill-refresher" className="txt" value={s.refresherMonths ?? ""} onChange={(e) => set("refresherMonths", e.target.value ? Number(e.target.value) : null)}>
            <option value="">None: done once</option>
            {refreshers.map((m) => <option key={m} value={m}>Every {m} months</option>)}
          </select></label>
        <label className="stack grow" style={{ gap: 6 }}><span className="strong">Quiz pass mark (%)</span>
          <input id="skill-passmark" className="txt" type="number" min={50} max={100} step={1} value={s.passMark} onChange={(e) => set("passMark", Number(e.target.value))} /></label>
      </div>
      {err && <div className="err" role="alert">{err}</div>}
      <div className="row wrap" style={{ gap: 10 }}>
        <button className="btn accent grow" type="submit" disabled={pending}>{pending ? "Saving…" : skill ? "Save changes" : "Add the skill"}</button>
        {saved && <span className="chip done" role="status">Saved</span>}
      </div>
    </form>
  );
}
