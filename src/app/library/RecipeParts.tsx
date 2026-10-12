import { ALLERGENS, ALLERGEN_NAME, MARK_SYMBOL, MARK_TEXT, type AllergenKey, type Allergens, type Diet, type Mark } from "@/lib/domain/recipes";

const names = (keys: AllergenKey[]) => keys.map((k) => ALLERGEN_NAME[k]).join(", ");

/**
 * A dish's or prep recipe's allergens in words: what it contains, what can be left out on request, and that it's free
 * from the rest. Unmarked ones (a draft) are listed as not marked.
 */
export function AllergenCard({ allergens, modifications, dietary = [], title = "Allergens" }: { allergens: Allergens; modifications?: string; dietary?: Diet[]; title?: string }) {
  const by = (m: Mark) => ALLERGENS.filter((a) => allergens[a.key] === m).map((a) => a.key);
  const contains = by("contains"), removable = by("removable"), unmarked = ALLERGENS.filter((a) => !allergens[a.key]).map((a) => a.key);
  return (
    <section className="card stack allergen-card" aria-label={title}>
      <div className="row wrap"><h2 className="h-sec grow">{title}</h2>{dietary.map((d) => <span key={d} className="chip done">{d}</span>)}</div>
      <div className="allergen-line contains"><span className="mark" aria-hidden="true">{MARK_SYMBOL.contains}</span>
        <span><span className="strong">{MARK_TEXT.contains}:</span> {contains.length ? names(contains) : "none of the 14"}</span></div>
      {removable.length > 0 && <div className="allergen-line removable"><span className="mark" aria-hidden="true">{MARK_SYMBOL.removable}</span>
        <span><span className="strong">{MARK_TEXT.removable}:</span> {names(removable)}</span></div>}
      {unmarked.length > 0 && <div className="allergen-line"><span className="mark" aria-hidden="true">?</span><span><span className="strong">Not marked yet:</span> {names(unmarked)}</span></div>}
      <div className="allergen-line"><span className="mark" aria-hidden="true">{MARK_SYMBOL.free}</span><span><span className="strong">{MARK_TEXT.free}:</span> all the others</span></div>
      {modifications && <div className="allergen-notes"><span className="strong">Kitchen notes:</span> <span style={{ whiteSpace: "pre-wrap" }}>{modifications}</span></div>}
    </section>
  );
}

/** What changed between two versions' allergens ("Sesame: free from → contains"). */
export function AllergenChanges({ changes }: { changes: { key: AllergenKey; from?: Mark; to?: Mark }[] }) {
  const word = (m?: Mark) => (m ? MARK_TEXT[m].toLowerCase() : "not marked");
  return (
    <ul className="allergen-changes">
      {changes.map((c) => <li key={c.key}><span className="strong">{ALLERGEN_NAME[c.key]}:</span> {word(c.from)} → <span className="strong">{word(c.to)}</span></li>)}
    </ul>
  );
}
