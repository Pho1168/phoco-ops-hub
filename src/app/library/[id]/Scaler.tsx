"use client";

import { useState } from "react";
import { factorFor, formatQty, inUnit, parseAmount, scaleQty, type Item, type Qty, type RecipeKind } from "@/lib/domain/recipes";

const PRESETS: Record<RecipeKind, { label: string; f: number }[]> = {
  prep: [{ label: "½", f: 0.5 }, { label: "1 batch", f: 1 }, { label: "2", f: 2 }, { label: "3", f: 3 }],
  dish: [{ label: "1 portion", f: 1 }, { label: "2", f: 2 }, { label: "4", f: 4 }, { label: "10", f: 10 }],
};
const ALT: Record<string, string> = { g: "kg", kg: "g", ml: "L", l: "ml" };
const num = (t: string) => { const a = parseAmount(t); return typeof a === "number" ? a : NaN; };

/** What the card shows for a size: "One batch · makes 4 L", "× 1.5 · makes 6 L", "4 portions". */
export function sizeLabel(kind: RecipeKind, factor: number, makes?: Qty): string {
  const batch = kind === "prep" && makes ? scaleQty(makes.qty, makes.unit, factor) : undefined;
  if (kind === "prep") {
    const times = `× ${Number(factor.toFixed(3))}`;
    if (!batch) return factor === 1 ? "One batch" : times;
    return factor === 1 ? `Makes ${formatQty(batch.qty, batch.unit)}` : `${times} · makes ${formatQty(batch.qty, batch.unit)}`;
  }
  return factor === 1 ? "One portion" : `${Number(factor.toFixed(2))} portions`;
}

/**
 * The size the card is shown at: whole batches or portions, any other number, or (prep) "scale to what I have" from
 * one ingredient (18 kg of bones for a 25 kg recipe). Every amount on the card follows; lines without one stay as written.
 */
export function SizeControls({ kind, items, factor, setFactor }: { kind: RecipeKind; items: Item[]; factor: number; setFactor: (f: number) => void }) {
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

  return (
    <div className="rc-size">
      <span className="seg small" role="group" aria-label={kind === "prep" ? "Batches" : "Portions"}>
        {PRESETS[kind].map((p) => <button key={p.label} type="button" aria-pressed={factor === p.f && !custom && haveLine < 0} onClick={() => pick(p.f)}>{p.label}</button>)}
      </span>
      <details className="rc-more">
        <summary>Other size</summary>
        <div className="stack" style={{ gap: 8 }}>
          <label className="row" style={{ gap: 6 }}><span className="muted">{kind === "prep" ? "Batches" : "Portions"}</span>
            <input className="txt qty" inputMode="decimal" aria-label={kind === "prep" ? "Other number of batches" : "Other number of portions"} placeholder={kind === "prep" ? "1.5" : "6"}
              value={custom} onChange={(e) => fromCustom(e.target.value)} /></label>
          {kind === "prep" && scalable.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="muted">Or scale to what you have:</span>
              <select className="txt" aria-label="Ingredient you have" value={haveLine} onChange={(e) => fromHave(Number(e.target.value), have, items[Number(e.target.value)]?.unit ?? "")}>
                <option value={-1}>Choose an ingredient</option>
                {scalable.map(({ it, i }) => <option key={i} value={i}>{it.name}</option>)}
              </select>
              {haveLine >= 0 && items[haveLine] && (
                <span className="row" style={{ gap: 6 }}>
                  <input className="txt qty" inputMode="decimal" aria-label="How much you have" placeholder={String(items[haveLine].qty)} value={have}
                    onChange={(e) => fromHave(haveLine, e.target.value, haveUnit)} />
                  {ALT[items[haveLine].unit.toLowerCase()]
                    ? <select className="txt unit" aria-label="Unit you have" value={haveUnit || items[haveLine].unit} onChange={(e) => fromHave(haveLine, have, e.target.value)}>
                        <option value={items[haveLine].unit}>{items[haveLine].unit}</option>
                        <option value={ALT[items[haveLine].unit.toLowerCase()]}>{ALT[items[haveLine].unit.toLowerCase()]}</option>
                      </select>
                    : <span className="muted">{items[haveLine].unit}</span>}
                </span>
              )}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
