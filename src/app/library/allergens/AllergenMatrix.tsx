"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { ALLERGENS, fitFor, MARK_SYMBOL, MARK_TEXT, type AllergenKey, type Fit, type MatrixRow } from "@/lib/domain/recipes";

const FIT_TEXT: Record<Fit, string> = { safe: "Fine", ask: "Only if the kitchen leaves it out", no: "Not for them" };

/**
 * The allergen matrix: every published dish by menu section, ✔ contains, ☑ can be left out on request, — free from.
 * "A guest avoids…" marks each dish as fine, fine only without something, or not for them; it can hide the last.
 * Prints on one landscape page per section run.
 */
export function AllergenMatrix({ groups }: { groups: { category: string; rows: MatrixRow[] }[] }) {
  const [avoid, setAvoid] = useState<AllergenKey[]>([]);
  const [hide, setHide] = useState(false);
  const [q, setQ] = useState("");
  const toggle = (k: AllergenKey) => setAvoid((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return groups.map((g) => ({
      category: g.category,
      rows: g.rows.map((r) => ({ r, fit: avoid.length ? fitFor(r.marks, avoid) : undefined }))
        .filter(({ r, fit }) => !(hide && fit === "no") && words.every((w) => r.title.toLowerCase().includes(w) || g.category.toLowerCase().includes(w))),
    })).filter((g) => g.rows.length);
  }, [groups, avoid, hide, q]);
  const all = shown.flatMap((g) => g.rows);
  const count = (f: Fit) => groups.flatMap((g) => g.rows).filter((r) => fitFor(r.marks, avoid) === f).length;

  return (
    <>
      <section className="card stack no-print" aria-label="A guest avoids">
        <div className="strong">A guest avoids…</div>
        <div className="avoid-chips">
          {ALLERGENS.map((a) => <button key={a.key} type="button" aria-pressed={avoid.includes(a.key)} title={a.name} onClick={() => toggle(a.key)}>{a.short}</button>)}
        </div>
        {avoid.length > 0 && (
          <div className="row wrap" style={{ gap: 10 }}>
            <span aria-live="polite"><span className="fit safe">{count("safe")} fine</span> <span className="fit ask">{count("ask")} only without something</span> <span className="fit no">{count("no")} not for them</span></span>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" className="check" checked={hide} onChange={(e) => setHide(e.target.checked)} /><span>Hide the ones they can&apos;t have</span></label>
            <button type="button" className="btn ghost small" onClick={() => { setAvoid([]); setHide(false); }}>Clear</button>
          </div>
        )}
        <span className="muted">Always tell the kitchen about a guest&apos;s allergy, and check before serving.</span>
      </section>
      <div className="row wrap no-print" style={{ gap: 8 }}>
        <input className="txt grow" type="search" placeholder="Find a dish" aria-label="Find a dish" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="btn ghost small" onClick={() => window.print()}>Print</button>
      </div>
      <div className="print-only legend">✔ Contains (can&apos;t be removed) · ☑ Can be left out on request · — Free from</div>
      {all.length === 0 ? <div className="card muted">{groups.length ? "No dishes match." : "No dishes published yet."}</div> : (
        <div className="matrix-wrap" role="region" aria-label="Allergen matrix" tabIndex={0}>
          <table className="matrix">
            <thead>
              <tr>
                <th scope="col" className="dish">Dish</th>
                {ALLERGENS.map((a) => <th key={a.key} scope="col" title={a.name} className={avoid.includes(a.key) ? "avoided" : ""}><span>{a.short}</span></th>)}
                <th scope="col" className="tags">Dietary</th>
                <th scope="col" className="notes">Kitchen notes</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((g) => (
                <Fragment key={g.category}>
                  <tr className="cat"><th scope="colgroup" colSpan={ALLERGENS.length + 3}>{g.category}</th></tr>
                  {g.rows.map(({ r, fit }) => (
                    <tr key={r.id} className={fit ? `fit-${fit}` : ""}>
                      <th scope="row" className="dish">
                        <Link href={`/library/allergens/${r.id}`}>{r.title}</Link>
                        {fit && <span className={`fit ${fit}`}>{FIT_TEXT[fit]}</span>}
                      </th>
                      {ALLERGENS.map((a) => {
                        const m = r.marks[a.key];
                        return <td key={a.key} className={`m-${m ?? "none"}${avoid.includes(a.key) ? " avoided" : ""}`} aria-label={`${a.name}: ${m ? MARK_TEXT[m] : "not marked"}`}>{m ? MARK_SYMBOL[m] : "?"}</td>;
                      })}
                      <td className="tags">{r.dietary.join(", ")}</td>
                      <td className="notes">{r.modifications}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
