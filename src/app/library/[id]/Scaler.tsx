"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { factorFor, formatQty, inUnit, scaleQty, type Item, type Qty, type RecipeKind } from "@/lib/domain/recipes";

const PRESETS: Record<RecipeKind, { label: string; f: number }[]> = {
  prep: [{ label: "½ batch", f: 0.5 }, { label: "1 batch", f: 1 }, { label: "2 batches", f: 2 }, { label: "3 batches", f: 3 }],
  dish: [{ label: "1 portion", f: 1 }, { label: "2", f: 2 }, { label: "4", f: 4 }, { label: "10", f: 10 }],
};
const ALT: Record<string, string> = { g: "kg", kg: "g", ml: "L", l: "ml" };
const num = (t: string) => { const n = Number(t.trim().replace(",", ".")); return Number.isFinite(n) ? n : NaN; };

/**
 * The ingredients (or a portion's components) at any size: whole batches or portions, any factor, or "scale to what I
 * have" from one ingredient (18 kg of bones for a 25 kg recipe). Lines without an amount stay as written.
 */
export function Scaler({ kind, items, makes, links }: {
  kind: RecipeKind; items: Item[]; makes?: Qty;
  /** Linked prep recipes (dishes): where each component's link goes, and whether it's still in use. */
  links: Record<string, { title: string; code: string; live: boolean }>;
}) {
  const [factor, setFactor] = useState(1);
  const [custom, setCustom] = useState("");
  const [haveLine, setHaveLine] = useState(-1);
  const [have, setHave] = useState("");
  const [haveUnit, setHaveUnit] = useState("");
  const scalable = items.map((it, i) => ({ it, i })).filter(({ it }) => it.qty !== undefined);

  const pick = (f: number) => { setFactor(f); setCustom(""); setHaveLine(-1); setHave(""); };
  const fromCustom = (t: string) => {
    setCustom(t); setHaveLine(-1); setHave("");
    const n = num(t);
    if (n > 0 && n <= 1000) setFactor(n);
  };
  const fromHave = (line: number, amount: string, unit: string) => {
    setHaveLine(line); setHave(amount); setHaveUnit(unit); setCustom("");
    const it = items[line];
    const a = num(amount);
    if (!it || it.qty === undefined || !(a > 0)) return;
    const inLine = inUnit(a, unit || it.unit, it.unit);
    const f = inLine === undefined ? undefined : factorFor(it.qty, inLine);
    if (f) setFactor(f);
  };
  const shown = useMemo(() => items.map((it) => (it.qty === undefined ? undefined : scaleQty(it.qty, it.unit, factor))), [items, factor]);
  const label = kind === "prep" ? (factor === 1 ? "One batch" : `× ${Number(factor.toFixed(3))}`) : factor === 1 ? "One portion" : `${Number(factor.toFixed(2))} portions`;
  const batch = kind === "prep" && makes ? scaleQty(makes.qty, makes.unit, factor) : undefined;

  return (
    <section className="card stack scaler" aria-label={kind === "prep" ? "Ingredients" : "In a portion"}>
      <div className="row wrap" style={{ alignItems: "baseline" }}>
        <h2 className="h-sec grow">{kind === "prep" ? "Ingredients" : "In a portion"}</h2>
        <span className="muted" aria-live="polite">{label}{batch ? `: makes ${formatQty(batch.qty, batch.unit)}` : ""}</span>
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <span className="seg small" role="group" aria-label={kind === "prep" ? "Batches" : "Portions"}>
          {PRESETS[kind].map((p) => <button key={p.label} type="button" aria-pressed={factor === p.f && !custom && haveLine < 0} onClick={() => pick(p.f)}>{p.label}</button>)}
        </span>
        <label className="row" style={{ gap: 6 }}><span className="muted">{kind === "prep" ? "× other" : "Other"}</span>
          <input className="txt qty" inputMode="decimal" aria-label={kind === "prep" ? "Other number of batches" : "Other number of portions"} placeholder={kind === "prep" ? "1.5" : "6"}
            value={custom} onChange={(e) => fromCustom(e.target.value)} /></label>
      </div>
      {kind === "prep" && scalable.length > 0 && (
        <div className="row wrap have" style={{ gap: 6 }}>
          <span className="muted">Scale to what you have:</span>
          <select className="txt" aria-label="Ingredient you have" value={haveLine} onChange={(e) => fromHave(Number(e.target.value), have, items[Number(e.target.value)]?.unit ?? "")}>
            <option value={-1}>Choose an ingredient</option>
            {scalable.map(({ it, i }) => <option key={i} value={i}>{it.name}</option>)}
          </select>
          {haveLine >= 0 && items[haveLine] && (
            <>
              <input className="txt qty" inputMode="decimal" aria-label="How much you have" placeholder={String(items[haveLine].qty)} value={have}
                onChange={(e) => fromHave(haveLine, e.target.value, haveUnit)} />
              {ALT[items[haveLine].unit.toLowerCase()]
                ? <select className="txt unit" aria-label="Unit you have" value={haveUnit || items[haveLine].unit} onChange={(e) => fromHave(haveLine, have, e.target.value)}>
                    <option value={items[haveLine].unit}>{items[haveLine].unit}</option>
                    <option value={ALT[items[haveLine].unit.toLowerCase()]}>{ALT[items[haveLine].unit.toLowerCase()]}</option>
                  </select>
                : <span className="muted">{items[haveLine].unit}</span>}
            </>
          )}
        </div>
      )}
      <ul className="items">
        {items.map((it, i) => {
          const q = shown[i];
          const link = it.prep ? links[it.prep] : undefined;
          return (
            <li key={i} className={haveLine === i ? "picked" : ""}>
              <span className="amount">{q ? formatQty(q.qty, q.unit) : <span className="muted">as needed</span>}</span>
              <span className="what">
                {link ? <Link href={`/library/${it.prep}`}>{it.name}</Link> : it.name}
                {link && !link.live && <span className="muted"> (no longer in use)</span>}
                {it.note && <span className="muted"> · {it.note}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
