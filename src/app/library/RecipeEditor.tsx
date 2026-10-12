"use client";

import { SOP_LIMITS, type LibraryBody, type Photo } from "@/lib/domain/library";
import {
  ALLERGENS, amountHint, DIETS, dishWarnings, MARK_TEXT, parseAmount, RECIPE_LIMITS, UNITS, unanswered,
  type Allergens, type DishBody, type Item, type Mark, type PrepBody, type RecipeKind,
} from "@/lib/domain/recipes";
import { DraftForm } from "./DraftForm";
import { editSteps, moved, newKey, PhotoField, stepsInput, stepsPrint, StepsField, type EditStep } from "./fields";

interface EditItem { key: string; qty: string; unit: string; name: string; note: string; prep: string }
interface RecipeState {
  title: string; sections: string[]; category: string; items: EditItem[]; steps: EditStep[];
  /** The finished photo; `uploading` (like a step's) isn't kept on the device. */
  finished: { photo?: Photo; uploading?: boolean }; allergens: Record<string, string>;
  makesQty: string; makesUnit: string; storage: string; shelfQty: string; shelfUnit: "hours" | "days"; notes: string;
  modifications: string; dietary: string[];
}
/** A prep recipe the dish can link to (retired ones only show if a component already links to them). */
export interface PrepOption { id: string; code: string; title: string; allergens: Allergens; retired: boolean }

const blankItem = (): EditItem => ({ key: newKey(), qty: "", unit: "", name: "", note: "", prep: "" });
const qtyText = (n: number | undefined) => (n === undefined ? "" : String(n));
const editItems = (items: Item[]): EditItem[] => (items.length
  ? items.map((i) => ({ key: newKey(), qty: qtyText(i.qty), unit: i.unit, name: i.name, note: i.note ?? "", prep: i.prep ?? "" }))
  : [blankItem(), blankItem(), blankItem()]);

function fromBody(kind: RecipeKind, title: string, body: PrepBody | DishBody): RecipeState {
  const prep = kind === "prep" ? (body as PrepBody) : undefined, dish = kind === "dish" ? (body as DishBody) : undefined;
  return {
    title, sections: body.sections, category: body.category, items: editItems(prep ? prep.ingredients : dish!.components), steps: editSteps(body.steps),
    finished: { photo: body.photo }, allergens: { ...body.allergens },
    makesQty: qtyText(prep?.makes?.qty), makesUnit: prep?.makes?.unit ?? "", storage: prep?.storage ?? "",
    shelfQty: qtyText(prep?.shelfLife?.qty), shelfUnit: prep?.shelfLife?.unit ?? "days", notes: prep?.notes ?? "",
    modifications: dish?.modifications ?? "", dietary: dish?.dietary ?? [],
  };
}
/** Typed numbers: "" is none; "1,5" is 1.5; anything that isn't clearly a number ("1,500", "abc") is sent as -1, so the server refuses it. */
const num = (t: string) => { const a = parseAmount(t); return typeof a === "string" ? -1 : a; };
const toInput = (kind: RecipeKind) => (s: RecipeState) => ({
  title: s.title, sections: s.sections, category: s.category,
  items: s.items.map((i) => ({ qty: num(i.qty), unit: i.unit, name: i.name, note: i.note, prep: kind === "dish" && i.prep ? i.prep : null })),
  steps: stepsInput(s.steps), photo: s.finished.photo ?? null, allergens: s.allergens,
  ...(kind === "prep"
    ? { makes: { qty: num(s.makesQty), unit: s.makesUnit }, storage: s.storage, shelfLife: { qty: num(s.shelfQty), unit: s.shelfUnit }, notes: s.notes }
    : { modifications: s.modifications, dietary: s.dietary }),
});
const fingerprint = (s: RecipeState) => JSON.stringify([s.title.trim(), [...s.sections].sort(), s.category.trim(),
  s.items.map((i) => [i.qty.trim(), i.unit.trim(), i.name.trim(), i.note.trim(), i.prep]).filter((i) => i.some(Boolean)), stepsPrint(s.steps), s.finished.photo?.id ?? "",
  Object.entries(s.allergens).filter(([, v]) => v).sort(), s.makesQty.trim(), s.makesUnit.trim(), s.storage.trim(), s.shelfQty.trim(), s.shelfUnit, s.notes.trim(),
  s.modifications.trim(), [...s.dietary].sort()]);
const busy = (s: RecipeState) => !!s.finished.uploading || s.steps.some((x) => x.uploading);

/** Ingredients (prep) or a portion's components (dish): amount, unit, name, note, and for a dish the prep recipe it is. */
function ItemsField({ kind, items, set, preps }: { kind: RecipeKind; items: EditItem[]; set: (fn: (i: EditItem[]) => EditItem[]) => void; preps: PrepOption[] }) {
  const word = kind === "prep" ? "Ingredient" : "Component";
  const patch = (key: string, p: Partial<EditItem>) => set((cur) => cur.map((i) => (i.key === key ? { ...i, ...p } : i)));
  return (
    <section className="stack" aria-label={kind === "prep" ? "Ingredients" : "In a portion"}>
      <h2 className="h-sec">{kind === "prep" ? "Ingredients (one batch)" : "In one portion"}</h2>
      <datalist id="units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
      {items.map((it, i) => (
        <div key={it.key} className="editor-item">
          <div className="item-row">
            <input aria-label={`${word} ${i + 1} amount`} className="txt qty" inputMode="decimal" placeholder="Amount" value={it.qty} onChange={(e) => patch(it.key, { qty: e.target.value })} />
            <input aria-label={`${word} ${i + 1} unit`} className="txt unit" list="units" maxLength={RECIPE_LIMITS.unit} placeholder="Unit" value={it.unit} onChange={(e) => patch(it.key, { unit: e.target.value })} />
            <input aria-label={`${word} ${i + 1}`} className="txt name" maxLength={RECIPE_LIMITS.name} placeholder={kind === "prep" ? "e.g. Fish sauce" : "e.g. Rice noodles"} value={it.name}
              onChange={(e) => patch(it.key, { name: e.target.value })} />
            <span className="row" style={{ gap: 4 }}>
              <button type="button" className="btn ghost small" aria-label={`Move ${word.toLowerCase()} ${i + 1} up`} disabled={i === 0} onClick={() => set((cur) => moved(cur, i, -1))}>↑</button>
              <button type="button" className="btn ghost small" aria-label={`Move ${word.toLowerCase()} ${i + 1} down`} disabled={i === items.length - 1} onClick={() => set((cur) => moved(cur, i, 1))}>↓</button>
              <button type="button" className="btn ghost small" aria-label={`Remove ${word.toLowerCase()} ${i + 1}`}
                onClick={() => set((cur) => (cur.length > 1 ? cur.filter((x) => x.key !== it.key) : [blankItem()]))}>✕</button>
            </span>
          </div>
          {amountHint(it.qty) && <div className="field-hint" role="alert">{amountHint(it.qty)}</div>}
          <div className="item-row">
            <input aria-label={`Note for ${word.toLowerCase()} ${i + 1}`} className="txt note" maxLength={RECIPE_LIMITS.note} placeholder="Note (optional): chopped, added last…" value={it.note}
              onChange={(e) => patch(it.key, { note: e.target.value })} />
            {kind === "dish" && (preps.some((p) => !p.retired) || !!it.prep) && (
              <select aria-label={`Prep recipe for component ${i + 1}`} className="txt link" value={it.prep}
                onChange={(e) => { const id = e.target.value; const p = preps.find((x) => x.id === id); patch(it.key, { prep: id, ...(p && !it.name ? { name: p.title } : {}) }); }}>
                <option value="">Not a prep recipe</option>
                {preps.filter((p) => !p.retired || p.id === it.prep).map((p) => <option key={p.id} value={p.id}>{p.title} ({p.code}){p.retired ? " (retired)" : ""}</option>)}
              </select>
            )}
          </div>
        </div>
      ))}
      {items.length < RECIPE_LIMITS.items && <button type="button" className="btn ghost" onClick={() => set((cur) => [...cur, blankItem()])}>Add a line</button>}
      <span className="muted">Amounts are numbers (0.5 for half). Leave the amount empty for things like &ldquo;a drizzle&rdquo;: they aren&apos;t scaled.</span>
    </section>
  );
}

/** Every allergen marked: contains, can be left out (dishes), or free from. */
function AllergensField({ kind, allergens, set }: { kind: RecipeKind; allergens: Record<string, string>; set: (fn: (a: Record<string, string>) => Record<string, string>) => void }) {
  const marks: Mark[] = kind === "prep" ? ["contains", "free"] : ["contains", "removable", "free"];
  const left = unanswered(allergens as Allergens).length;
  return (
    <section className="card stack" aria-label="Allergens">
      <div className="row wrap"><h2 className="h-sec grow">Allergens</h2><span className={`chip ${left ? "late" : "done"}`}>{left ? `${left} not marked yet` : "All marked"}</span></div>
      <span className="muted">{kind === "prep" ? "Mark each one: does it contain it?" : "Mark each one. “Can be left out” means the kitchen can make it without it on request."}</span>
      <div className="allergen-grid">
        {ALLERGENS.map((a) => (
          <div key={a.key} className="allergen-row" role="group" aria-label={a.name}>
            <span className="name">{a.name}</span>
            <span className="seg small">
              {marks.map((m) => (
                <button key={m} type="button" aria-pressed={allergens[a.key] === m} className={`mark-${m}`}
                  onClick={() => set((cur) => ({ ...cur, [a.key]: m }))}>{MARK_TEXT[m]}</button>
              ))}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Writing a prep recipe (a batch: what it makes, ingredients, method, storage, shelf life) or a dish spec (one
 * portion's components, how it's built, kitchen notes, dietary tags). Both mark every allergen and may have a photo
 * of the finished thing. Saving, approval and keeping unsaved changes are DraftForm's.
 */
export function RecipeEditor({ kind, mode, docId, versionId, rev, published, initial, erased = [], canDiscard, personId, categories, preps }: {
  kind: RecipeKind; mode: "new" | "draft"; docId?: string; versionId?: string; rev?: number; published?: boolean;
  initial: { title: string; body: PrepBody | DishBody }; erased?: string[]; canDiscard?: boolean; personId: string;
  /** Categories already used, offered as the category is typed. */
  categories: string[];
  /** Prep recipes a dish's components can link to. */
  preps: PrepOption[];
}) {
  const prepMap = new Map(preps.map((p) => [p.id, p]));
  return (
    <DraftForm kind={kind} mode={mode} docId={docId} versionId={versionId} rev={rev} published={published} canDiscard={canDiscard} personId={personId}
      initial={fromBody(kind, initial.title, initial.body)} toInput={toInput(kind)} fingerprint={fingerprint} busy={busy}
      fromSaved={(saved: { title: string; body: LibraryBody }) => fromBody(kind, saved.title, saved.body as PrepBody | DishBody)}>
      {(s, set, setErr) => {
        const warnings = kind === "dish" ? dishWarnings({ allergens: s.allergens as Allergens, dietary: s.dietary, components: s.items.map((i) => ({ unit: "", name: i.name, prep: i.prep || undefined })) } as DishBody, prepMap) : [];
        return (
          <>
            <section className="card stack" aria-label="Details">
              <label className="stack" style={{ gap: 6 }}><span className="strong">{kind === "prep" ? "Name" : "Dish"}</span>
                <input id="recipe-title" className="txt" style={{ width: "100%", maxWidth: "none" }} required maxLength={SOP_LIMITS.title} autoComplete="off"
                  placeholder={kind === "prep" ? "e.g. Pho broth" : "e.g. Pho beef brisket"} value={s.title} onChange={(e) => { const title = e.target.value; set((x) => ({ ...x, title })); }} /></label>
              <label className="stack" style={{ gap: 6 }}><span className="strong">{kind === "prep" ? "Category" : "Menu section"}</span>
                <input id="recipe-category" className="txt" list="categories" maxLength={RECIPE_LIMITS.category} autoComplete="off"
                  placeholder={kind === "prep" ? "e.g. Broth, Marinade, Sauce" : "e.g. Starters, Pho, Banh Mi"} value={s.category}
                  onChange={(e) => { const category = e.target.value; set((x) => ({ ...x, category })); }} />
                <datalist id="categories">{categories.map((c) => <option key={c} value={c} />)}</datalist></label>
              <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 6 }}>
                <legend className="strong" style={{ marginBottom: 6 }}>{kind === "prep" ? "Who makes it" : "Who builds it"}</legend>
                <div className="row wrap" style={{ gap: 16 }}>
                  {(["BOH", "PROD"] as const).map((sec) => (
                    <label key={sec} className="row" style={{ gap: 8 }}>
                      <input type="checkbox" className="check" checked={s.sections.includes(sec)}
                        onChange={(e) => { const on = e.target.checked; set((x) => ({ ...x, sections: on ? [...x.sections, sec] : x.sections.filter((y) => y !== sec) })); }} />
                      <span>{sec === "BOH" ? "Back of house (restaurants)" : "Production (Wembley)"}</span>
                    </label>
                  ))}
                </div>
                <span className="muted">{kind === "prep"
                  ? "All kitchen staff and managers can see it; front of house can't."
                  : "Everyone at sites with this kitchen, front of house too, is asked to confirm when its allergens change."}
                  {mode === "new" ? ` It also sets the code (${kind === "prep" ? "PREP" : "DISH"}-BOH-…), which never changes.` : ""}</span>
              </fieldset>
              {kind === "prep" && (
                <div className="row wrap" style={{ gap: 10, alignItems: "flex-end" }}>
                  <label className="stack" style={{ gap: 6 }}><span className="strong">One batch makes</span>
                    <span className="row" style={{ gap: 6 }}>
                      <input id="recipe-makes" aria-label="Batch amount" className="txt qty" inputMode="decimal" placeholder="60" value={s.makesQty} onChange={(e) => { const makesQty = e.target.value; set((x) => ({ ...x, makesQty })); }} />
                      <input aria-label="Batch unit" className="txt unit" list="units-batch" maxLength={RECIPE_LIMITS.unit} placeholder="L" value={s.makesUnit} onChange={(e) => { const makesUnit = e.target.value; set((x) => ({ ...x, makesUnit })); }} />
                      <datalist id="units-batch">{["L", "kg", "portions", "pieces", "tubs"].map((u) => <option key={u} value={u} />)}</datalist>
                    </span></label>
                  {amountHint(s.makesQty) && <div className="field-hint" role="alert">{amountHint(s.makesQty)}</div>}
                </div>
              )}
              <div className="stack" style={{ gap: 6 }}><span className="strong">Photo of the finished {kind === "prep" ? "product" : "dish"}</span>
                <PhotoField photo={s.finished.photo} uploading={s.finished.uploading} erased={erased} setErr={setErr} label={`Photo of the finished ${kind === "prep" ? "product" : "dish"}`}
                  set={(p) => set((x) => ({ ...x, finished: { photo: p.photo, uploading: p.uploading } }))} /></div>
            </section>

            <ItemsField kind={kind} items={s.items} preps={preps} set={(fn) => set((x) => ({ ...x, items: fn(x.items) }))} />
            <StepsField steps={s.steps} set={(fn) => set((x) => ({ ...x, steps: fn(x.steps) }))} setErr={setErr} erased={erased}
              title={kind === "prep" ? "Method" : "How it's built"} placeholder={kind === "prep" ? "What to do, in plain words" : "e.g. Noodles in a warm bowl, brisket on top"} />

            {kind === "prep" ? (
              <section className="card stack" aria-label="Storage">
                <label className="stack" style={{ gap: 6 }}><span className="strong">Storage</span>
                  <input id="recipe-storage" className="txt" style={{ width: "100%", maxWidth: "none" }} maxLength={RECIPE_LIMITS.storage} placeholder="e.g. Chilled 0–5°C, lidded and labelled"
                    value={s.storage} onChange={(e) => { const storage = e.target.value; set((x) => ({ ...x, storage })); }} /></label>
                <label className="stack" style={{ gap: 6 }}><span className="strong">Shelf life</span>
                  <span className="row" style={{ gap: 6 }}>
                    <input id="recipe-shelf" aria-label="Shelf life" className="txt qty" inputMode="numeric" placeholder="3" value={s.shelfQty} onChange={(e) => { const shelfQty = e.target.value; set((x) => ({ ...x, shelfQty })); }} />
                    <select aria-label="Shelf life in" className="txt unit" value={s.shelfUnit} onChange={(e) => { const shelfUnit = e.target.value as "hours" | "days"; set((x) => ({ ...x, shelfUnit })); }}>
                      <option value="days">days</option><option value="hours">hours</option>
                    </select>
                  </span></label>
                <label className="stack" style={{ gap: 6 }}><span className="strong">Notes</span>
                  <textarea id="recipe-notes" maxLength={RECIPE_LIMITS.notes} placeholder="Anything else the cook should know" value={s.notes}
                    onChange={(e) => { const notes = e.target.value; set((x) => ({ ...x, notes })); }} /></label>
              </section>
            ) : (
              <section className="card stack" aria-label="Kitchen notes and dietary">
                <label className="stack" style={{ gap: 6 }}><span className="strong">Kitchen notes on allergens</span>
                  <span className="muted">Which part has which allergen, and what can be left out (front of house sees this too).</span>
                  <textarea id="recipe-modifications" maxLength={RECIPE_LIMITS.modifications} placeholder="e.g. Crushed peanuts on top: leave them off. The broth has fish sauce: it can't be left out."
                    value={s.modifications} onChange={(e) => { const modifications = e.target.value; set((x) => ({ ...x, modifications })); }} /></label>
                <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 6 }}>
                  <legend className="strong" style={{ marginBottom: 6 }}>Dietary</legend>
                  <div className="row wrap" style={{ gap: 16 }}>
                    {DIETS.map((d) => (
                      <label key={d} className="row" style={{ gap: 8 }}>
                        <input type="checkbox" className="check" checked={s.dietary.includes(d)}
                          onChange={(e) => { const on = e.target.checked; set((x) => ({ ...x, dietary: on ? [...x.dietary, d] : x.dietary.filter((y) => y !== d) })); }} />
                        <span>{d}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </section>
            )}

            <AllergensField kind={kind} allergens={s.allergens} set={(fn) => set((x) => ({ ...x, allergens: fn(x.allergens) }))} />
            {warnings.length > 0 && (
              <div className="alert" role="status"><div className="grow stack" style={{ gap: 4 }}><div className="strong">Check before sending</div>
                {warnings.map((w) => <div key={w} style={{ fontSize: 14 }}>{w}</div>)}</div></div>
            )}
          </>
        );
      }}
    </DraftForm>
  );
}
