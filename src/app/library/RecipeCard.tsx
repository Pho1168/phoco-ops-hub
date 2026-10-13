"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import type { Photo, SopStep } from "@/lib/domain/library";
import {
  ALLERGENS, cardPanels, formatQty, MARK_TEXT, noteLines, scaleQty,
  type Allergens, type DishBody, type Item, type Mark, type PrepBody, type RecipeKind,
} from "@/lib/domain/recipes";
import { SizeControls, sizeLabel } from "./[id]/Scaler";
import { StepMode } from "./[id]/StepMode";

type Links = Record<string, { title: string; code: string; live: boolean }>;

/** A picture on the card: the photo, "Photo removed" (the owner erased it), or nothing. Never stretched. */
function Pic({ photo, alt, gone, className = "" }: { photo?: Photo; alt: string; gone: string[]; className?: string }) {
  if (!photo) return null;
  if (gone.includes(photo.id)) return <div className={`rc-pic removed ${className}`} role="img" aria-label={`${alt}: photo removed`}>Photo removed</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={`rc-pic ${className}`} src={`/api/media/${photo.id}`} width={photo.w} height={photo.h} alt={alt} loading="lazy" />;
}

function amountOf(it: Item, factor: number) {
  if (it.qty === undefined) return it.unit || "as needed";
  const q = scaleQty(it.qty, it.unit, factor);
  return formatQty(q.qty, q.unit);
}

function ItemName({ it, links }: { it: Item; links: Links }) {
  const link = it.prep ? links[it.prep] : undefined;
  return (
    <>
      {link?.live ? <Link href={`/library/${it.prep}`}>{it.name}</Link> : it.name}
      {link && !link.live && <span className="muted"> (no longer in use)</span>}
      {it.note && <span className="rc-note"> {it.note}</span>}
    </>
  );
}

/** Ingredients as picture tiles (few, like the printed cards) or a list with small pictures (many, or beside the method). */
function Ingredients({ items, factor, links, gone, label, list }: { items: Item[]; factor: number; links: Links; gone: string[]; label: string; list?: boolean }) {
  const tiles = !list && items.length <= 10;
  return (
    <ul className={`rc-ings ${tiles ? "tiles" : "list"}`} aria-label={label} style={{ ["--n" as string]: Math.max(1, Math.min(items.length, 10)) }}>
      {items.map((it, i) => (
        <li key={i}>
          <span className="rc-amt">{amountOf(it, factor)}</span>
          <span className="rc-ing-pic">{it.photo ? <Pic photo={it.photo} alt={it.name} gone={gone} /> : <span className="rc-pic none" aria-hidden="true" />}</span>
          <span className="rc-ing-name"><ItemName it={it} links={links} /></span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The method as numbered picture tiles, at most CARD_STEPS on the card; the rest on a second panel (printing shows
 * them all).
 */
function Method({ steps, title, gone, label, compact }: { steps: SopStep[]; title: string; gone: string[]; label: string; compact?: boolean }) {
  const [panel, setPanel] = useState(0);
  const { first, more } = cardPanels(steps);
  const shown = panel === 0 ? first.length : more.length;
  const cols = compact ? 1 : shown <= 3 ? shown : shown <= 8 ? 4 : shown === 9 ? 3 : 4;
  const onPanel = (i: number) => (panel === 0 ? i < first.length : i >= first.length);
  return (
    <div className="rc-method-wrap">
      <ol className={`rc-steps ${compact ? "compact" : ""}`} aria-label={`${label}: ${title}`}
        style={{ ["--cols" as string]: Math.max(1, cols), ["--rows" as string]: Math.max(1, Math.ceil(shown / Math.max(1, cols))) }}>
        {steps.map((s, i) => (
          <li key={i} className={`${s.photo ? "has-pic" : ""} ${onPanel(i) ? "" : "off-panel"}`}>
            <span className="rc-num" aria-hidden="true">{i + 1}</span>
            {!compact && s.photo && <Pic photo={s.photo} alt={`Step ${i + 1}`} gone={gone} />}
            <span className="rc-step-text"><span className="sr-only">Step {i + 1}: </span>{s.text}</span>
            {s.warning && <span className="rc-warn" role="note"><Icon name="alert" />{s.warning}</span>}
          </li>
        ))}
      </ol>
      {more.length > 0 && (
        <button type="button" className="btn small rc-panel" onClick={() => setPanel(panel === 0 ? 1 : 0)}>
          {panel === 0 ? `More: steps ${first.length + 1}–${steps.length}` : `Back to steps 1–${first.length}`}
        </button>
      )}
    </div>
  );
}

/** Which side of its point a label sits: towards the middle of the photo, so it stays on the photo. */
const labelSide = (x: number) => (x < 50 ? "right" : "left");

/** Allergens at a glance: what it contains (and can be left out), free from the rest; unmarked ones are said. */
function AllergenStrip({ allergens, modifications, dietary = [] }: { allergens: Allergens; modifications?: string; dietary?: string[] }) {
  const by = (m: Mark) => ALLERGENS.filter((a) => allergens[a.key] === m);
  const contains = by("contains"), removable = by("removable"), unmarked = ALLERGENS.filter((a) => !allergens[a.key]);
  return (
    <div className="rc-allergens" aria-label="Allergens">
      <h3 className="rc-mini">Allergens</h3>
      <div className="rc-chips">
        {contains.length ? contains.map((a) => <span key={a.key} className="rc-chip contains" title={MARK_TEXT.contains}>{a.short}</span>) : <span className="muted">Contains none of the 14</span>}
      </div>
      {removable.length > 0 && <div className="rc-chips"><span className="muted">{MARK_TEXT.removable}:</span>{removable.map((a) => <span key={a.key} className="rc-chip removable">{a.short}</span>)}</div>}
      {unmarked.length > 0 && <div className="rc-chips"><span className="strong">Not marked yet:</span> {unmarked.map((a) => a.short).join(", ")}</div>}
      {dietary.length > 0 && <div className="rc-chips">{dietary.map((d) => <span key={d} className="rc-chip diet">{d}</span>)}</div>}
      {modifications && <div className="rc-mods">{modifications}</div>}
    </div>
  );
}

/**
 * A recipe as one card, laid out like PHO & CO's printed recipe cards and sized to the screen (landscape or
 * portrait). A prep recipe: ingredients as picture tiles, the method as numbered picture steps, then the final
 * result, important notes, storage and allergens. A dish: the finished photo with its labels, the serving standard,
 * what's in a portion and how it's built, and its allergens. Amounts follow the size picked in the header.
 */
export function RecipeCard({ kind, title, code, version, body, links, gone, stepMode, stamp, printable }: {
  kind: RecipeKind; title: string; code: string; version?: number; body: PrepBody | DishBody; links: Links; gone: string[]; stepMode?: boolean;
  /** Not the version in use (a draft, an old or retired one): said on the card, on screen and on paper. */
  stamp?: string;
  /** Offer "Print A4" (only the version in use). */
  printable?: boolean;
}) {
  const [factor, setFactor] = useState(1);
  const prep = kind === "prep" ? (body as PrepBody) : undefined, dish = kind === "dish" ? (body as DishBody) : undefined;
  const items = prep ? prep.ingredients : dish!.components;
  const notes = useMemo(() => noteLines(prep?.notes ?? ""), [prep?.notes]);
  const stepsForMode = body.steps.map((s) => (s.photo && gone.includes(s.photo.id) ? { text: s.text, warning: s.warning } : s));
  // Too much for one A4 page: printed in plain flow over two, rather than squeezed.
  const long = items.length > 12 || body.steps.length > 12 || body.steps.reduce((n, st) => n + st.text.length + (st.warning?.length ?? 0), 0) > 1400;
  const shelf = prep?.shelfLife ? `${prep.shelfLife.qty} ${prep.shelfLife.qty === 1 ? prep.shelfLife.unit.replace(/s$/, "") : prep.shelfLife.unit}` : undefined;

  const head = (
    <header className="rc-head">
      <div className="rc-title">
        <span className="rc-code">{code}{version ? ` · v${version}` : ""}{body.category ? ` · ${body.category}` : ""}</span>
        <h1>{title}</h1>
        {stamp && <span className="rc-stamp" role="status">{stamp}</span>}
      </div>
      <div className="rc-tools">
        {items.some((i) => i.qty !== undefined) && (
          <>
            <span className="rc-makes" aria-live="polite">{sizeLabel(kind, factor, prep?.makes)}</span>
            <SizeControls kind={kind} items={items} factor={factor} setFactor={setFactor} />
          </>
        )}
        {stepMode && body.steps.length > 0 && <StepMode title={title} steps={stepsForMode} />}
        {printable && <button type="button" className="btn ghost small rc-print" onClick={() => window.print()}><Icon name="print" />Print A4</button>}
      </div>
    </header>
  );

  if (prep) {
    return (
      <article className={`rcard prep ${stamp ? "stamped" : ""} ${long ? "long" : ""}`} aria-label={title}>
        {head}
        <section className="rc-sec rc-ing-sec" aria-label="Ingredients">
          <h2 className="rc-band">Ingredients</h2>
          {items.length ? <Ingredients items={items} factor={factor} links={links} gone={gone} label="Ingredients" /> : <p className="muted">No ingredients written yet.</p>}
        </section>
        <section className="rc-sec rc-method-sec" aria-label="Method">
          <h2 className="rc-band">Method</h2>
          {body.steps.length ? <Method steps={body.steps} title={title} gone={gone} label="Method" /> : <p className="muted">No method written yet.</p>}
        </section>
        <footer className="rc-foot">
          <div className="rc-result">
            <h3 className="rc-band">Final result</h3>
            {body.photo ? <Pic photo={body.photo} alt={`${title}, finished`} gone={gone} /> : <span className="muted">No photo yet</span>}
          </div>
          {notes.length > 0 && (
            <div className="rc-notes"><h3 className="rc-mini">Important notes</h3>
              <ul>{notes.map((n, i) => <li key={i}>{n}</li>)}</ul></div>
          )}
          <div className="rc-store"><h3 className="rc-mini">Storage</h3>
            {prep.storage && <p>{prep.storage}</p>}
            {shelf && <p className="strong">Use within {shelf}</p>}
            {!prep.storage && !shelf && <p className="muted">Not written yet</p>}
          </div>
          <AllergenStrip allergens={prep.allergens} />
        </footer>
      </article>
    );
  }

  const d = dish!;
  const photoOk = !!d.photo && !gone.includes(d.photo.id);
  return (
    <article className={`rcard dish ${stamp ? "stamped" : ""} ${long ? "long" : ""}`} aria-label={title}>
      {head}
      <section className="rc-hero" aria-label="The serving standard">
        {d.photo ? (
          <div className="rc-hero-box" style={{ ["--ar" as string]: `${d.photo.w} / ${d.photo.h}`, ["--arn" as string]: d.photo.w / d.photo.h }}>
            <Pic photo={d.photo} alt={`${title}, as served`} gone={gone} />
            {photoOk && (d.callouts ?? []).map((c, i) => (
              <span key={i} className={`rc-callout ${labelSide(c.x)}`} style={{ ["--x" as string]: `${c.x}%`, ["--y" as string]: `${c.y}%` }}>
                <span className="rc-dot" aria-hidden="true" /><span className="rc-line" aria-hidden="true" /><span className="rc-label">{c.text}</span>
              </span>
            ))}
          </div>
        ) : <div className="rc-hero-empty muted">No photo of the dish yet</div>}
      </section>
      <div className="rc-under">
        {(d.standards?.length ?? 0) > 0 && (
          <ul className="rc-standards" aria-label="Every time">
            {d.standards!.map((t, i) => <li key={i}><span className="rc-tick" aria-hidden="true">✓</span>{t}</li>)}
          </ul>
        )}
        <AllergenStrip allergens={d.allergens} modifications={d.modifications} dietary={d.dietary} />
      </div>
      {items.length > 0 && (
        <section className="rc-sec rc-portion" aria-label="In a portion">
          <h2 className="rc-band">In {factor === 1 ? "a portion" : `${Number(factor.toFixed(2))} portions`}</h2>
          <Ingredients items={items} factor={factor} links={links} gone={gone} label="In a portion" list />
        </section>
      )}
      {d.steps.length > 0 && (
        <section className="rc-sec rc-build" aria-label="How it's built">
          <h2 className="rc-band">How it&apos;s built</h2>
          <Method steps={d.steps} title={title} gone={gone} label="How it's built" compact />
        </section>
      )}
      {!items.length && !d.steps.length && <p className="muted rc-portion">What goes in a portion and how it&apos;s built aren&apos;t written yet: only its allergens are.</p>}
    </article>
  );
}
