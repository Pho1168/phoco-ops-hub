import Image from "next/image";
import { PATHWAY_TEXT, type Guide, type Skill } from "@/lib/domain/training";

/**
 * A skill's written guide as a training card in the Pho & Co poster style: cream ground, deep-teal headings, soft
 * teal and peach panels. Why it matters and when it applies, the numbered steps with their pictures (a numbered
 * tile until a picture is added), the never-do list, what good looks like, and a closing line. Prints on A4.
 */
export function SkillCard({ skill, guide, erased, links, team = "Ops Hub" }: {
  skill: Pick<Skill, "title" | "section" | "group" | "about" | "handsOn" | "refresherMonths">;
  guide: Guide;
  /** Photos the owner has erased: shown as removed. */
  erased: string[];
  /** The linked SOPs and recipes, as the page resolved them. */
  links?: React.ReactNode;
  /** Whose card it is: the reader's business. */
  team?: string;
}) {
  const pic = (p: { id: string; w: number; h: number } | undefined, alt: string, cls: string) =>
    p && !erased.includes(p.id)
      ? <Image className={cls} src={`/api/media/${p.id}`} width={p.w} height={p.h} alt={alt} unoptimized />
      : p ? <div className={`${cls} tc-removed`} role="img" aria-label={`${alt}: removed`}>Picture removed</div> : null;
  const steps = guide.steps;
  const cols = steps.length <= 4 ? steps.length || 1 : steps.length <= 6 ? 3 : 4;

  return (
    <article className="tcard" aria-label={`${skill.title}: training card`}>
      <header className="tc-head">
        <div className="tc-brand"><span className="tc-logo">PHO<br />&amp;CO</span><span className="tc-brand-sub">Vietnamese signatures</span></div>
        <div className="tc-kicker">{PATHWAY_TEXT[skill.section]} · {skill.group}</div>
        <h2 className="tc-title">{skill.title}</h2>
        {guide.tagline && <div className="tc-tagline">{guide.tagline}</div>}
      </header>

      {(guide.hero || guide.why || guide.when.length > 0) && (
        <section className={`tc-intro ${guide.hero ? "with-hero" : ""}`}>
          {guide.hero && <div className="tc-hero">{pic(guide.hero, skill.title, "tc-hero-img")}</div>}
          <div className="tc-intro-text">
            {guide.why && <div className="tc-panel teal"><h3 className="tc-h">Why it matters</h3><p>{guide.why}</p></div>}
            {guide.when.length > 0 && (
              <div className="tc-panel teal"><h3 className="tc-h">When</h3>
                <ul className="tc-ticks">{guide.when.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </div>
            )}
          </div>
        </section>
      )}

      {steps.length > 0 && (
        <section className="tc-steps-wrap">
          <h3 className="tc-band">How to do it</h3>
          <ol className="tc-steps" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {steps.map((s, i) => (
              <li key={i} className="tc-step">
                <div className="tc-step-pic">
                  {s.photo ? pic(s.photo, `Step ${i + 1}`, "tc-step-img") : <span className="tc-step-blank" aria-hidden="true">{i + 1}</span>}
                  <span className="tc-n">{i + 1}</span>
                </div>
                <p>{s.text}</p>
                {s.warning && <div className="tc-warn">{s.warning}</div>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {(guide.never.length > 0 || guide.looks.length > 0) && (
        <section className="tc-two">
          {guide.looks.length > 0 && (
            <div className="tc-panel teal"><h3 className="tc-h">What good looks like</h3>
              <ul className="tc-ticks">{guide.looks.map((w, i) => <li key={i}>{w}</li>)}</ul>
              <div className="tc-note">{skill.handsOn ? "A manager watches you do it, then signs it off." : "This is what a manager checks on the floor."}</div>
            </div>
          )}
          {guide.never.length > 0 && (
            <div className="tc-panel peach"><h3 className="tc-h bad">Do not forget</h3>
              <ul className="tc-crosses">{guide.never.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}
        </section>
      )}

      {links}

      <footer className="tc-foot">
        <span className="tc-foot-main">{guide.closing ?? "Good food, brighter days"}</span>
        <span className="tc-foot-sub">Thank you · the {team} team{skill.refresherMonths ? ` · done again every ${skill.refresherMonths} months` : ""}</span>
      </footer>
    </article>
  );
}
