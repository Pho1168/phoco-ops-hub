import { isOwner } from "./access";
import {
  canDraft, cleanSteps, cleanText, cleanTitle, isPhoto, readsAny, reachedSites,
  type Checked, type Cleaned, type LibraryDoc, type LibraryVersion, type Photo, type SopInput, type SopStep,
} from "./library";
import type { Area, Person, Site, SiteId } from "./types";

/**
 * The recipe handbook, kept in the library like SOPs (same drafts, approval and versions). Two kinds:
 * - prep recipes: what the kitchen or Wembley makes in batches (broth, marinades, sauces), with what one batch makes,
 *   its ingredients, method, storage and shelf life;
 * - dish specs: how a menu item is built, per portion, with its allergens for front of house.
 * Recipes are kitchen know-how: they're only on the full app (the shop tablet, or a manager's own device), for people
 * who write them and kitchen staff. Allergens are for everyone: the matrix lists every published dish, and when a
 * dish's allergens change, everyone at its sites confirms they've seen it.
 * Amounts are a number and a unit, so a batch or a number of portions can be scaled.
 */

/** The 14 allergens UK law names, in the order of PHO & CO's chart, then E120 (a colouring PHO & CO also tracks). */
export const ALLERGENS = [
  { key: "celery", name: "Celery", short: "Celery" },
  { key: "gluten", name: "Cereals containing gluten", short: "Gluten" },
  { key: "crustaceans", name: "Crustaceans", short: "Crustaceans" },
  { key: "eggs", name: "Eggs", short: "Eggs" },
  { key: "fish", name: "Fish", short: "Fish" },
  { key: "lupin", name: "Lupin", short: "Lupin" },
  { key: "milk", name: "Milk", short: "Milk" },
  { key: "molluscs", name: "Molluscs", short: "Molluscs" },
  { key: "mustard", name: "Mustard", short: "Mustard" },
  { key: "nuts", name: "Tree nuts", short: "Nuts" },
  { key: "peanuts", name: "Peanuts", short: "Peanuts" },
  { key: "sesame", name: "Sesame", short: "Sesame" },
  { key: "soya", name: "Soya", short: "Soya" },
  { key: "sulphites", name: "Sulphur dioxide and sulphites", short: "Sulphites" },
  { key: "e120", name: "E120 colouring (not one of the 14)", short: "E120" },
] as const;
export type AllergenKey = (typeof ALLERGENS)[number]["key"];
export const ALLERGEN_KEYS: AllergenKey[] = ALLERGENS.map((a) => a.key);
export const ALLERGEN_NAME = Object.fromEntries(ALLERGENS.map((a) => [a.key, a.name])) as Record<AllergenKey, string>;

/** On a dish: contains it (can't be taken out), can be left out on request, or free from it. A prep recipe contains it or not. */
export type Mark = "contains" | "removable" | "free";
export const MARK_SYMBOL: Record<Mark, string> = { contains: "✔", removable: "☑", free: "—" };
export const MARK_TEXT: Record<Mark, string> = { contains: "Contains", removable: "Can be left out", free: "Free from" };
export type Allergens<M extends Mark = Mark> = Partial<Record<AllergenKey, M>>;

export type Diet = "Vegetarian" | "Vegan";
export const DIETS: Diet[] = ["Vegetarian", "Vegan"];

/** An ingredient (prep) or a component (dish): an amount (none for "a drizzle"), a unit, a name, a note. */
export interface Item { qty?: number; unit: string; name: string; note?: string; /** dishes: the prep recipe this component is (document id) */ prep?: string }
export interface Qty { qty: number; unit: string }
export type ShelfUnit = "hours" | "days";

export interface PrepBody {
  /** Who makes it: back of house (restaurants) and/or production (Wembley). */
  sections: Area[];
  category: string;
  /** What one batch makes. */
  makes?: Qty;
  ingredients: Item[];
  steps: SopStep[];
  /** The finished product. */
  photo?: Photo;
  storage: string;
  shelfLife?: { qty: number; unit: ShelfUnit };
  allergens: Allergens<"contains" | "free">;
  notes: string;
}

export interface DishBody {
  /** Who builds it (back of house, usually). The dish's sites are the ones with these sections. */
  sections: Area[];
  /** The menu section: Starters, Banh Mi, Pho… */
  category: string;
  /** Per portion. */
  components: Item[];
  steps: SopStep[];
  photo?: Photo;
  allergens: Allergens;
  /** Which part has which allergen and what can be left out ("crushed peanuts on top: leave off"). */
  modifications: string;
  dietary: Diet[];
}

export const RECIPE_LIMITS = { category: 40, items: 80, name: 80, unit: 12, note: 120, storage: 200, notes: 600, modifications: 600, qty: 1_000_000 } as const;
export const SHELF_MAX: Record<ShelfUnit, number> = { hours: 72, days: 365 };
/** Units offered in the editor (any short unit can be typed). */
export const UNITS = ["g", "kg", "ml", "L", "tsp", "tbsp", "spoon", "scoop", "piece", "pack", "can", "bottle", "bunch", "slice", "portion"];
const KITCHEN: Area[] = ["BOH", "PROD"];

export type RecipeKind = "prep" | "dish";

/** What the editor sends. Amounts are numbers or null (none). */
export interface RecipeInput {
  title: string; sections: string[]; category: string;
  items: { qty: number | null; unit: string; name: string; note: string; prep?: string | null }[];
  steps: SopInput["steps"];
  photo?: Photo | null;
  allergens: Record<string, string>;
  // prep
  makes?: { qty: number | null; unit: string } | null;
  storage?: string; shelfLife?: { qty: number | null; unit: string } | null; notes?: string;
  // dish
  modifications?: string; dietary?: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const oneLine = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
/** An amount as stored: above 0 once rounded to 3 decimals, within the limit. Undefined for none; false if it isn't one. */
const amount = (n: number | null | undefined): number | undefined | false => {
  if (n === null || n === undefined) return undefined;
  const r = Number.isFinite(n) ? Math.round(n * 1000) / 1000 : NaN;
  return r > 0 && r <= RECIPE_LIMITS.qty ? r : false;
};

/**
 * An amount as typed: "" is none; "1.5" and "1,5" (a decimal comma) are 1.5; "1500" is 1500. A comma before exactly
 * three digits ("1,500") could be either, so it's refused ("ambiguous"); anything else that isn't a plain number is "invalid".
 */
export function parseAmount(typed: string): number | null | "ambiguous" | "invalid" {
  const t = typed.trim();
  if (!t) return null;
  if (/^\d+,\d{3}$/.test(t)) return "ambiguous";
  if (!/^\d*[.,]?\d+$/.test(t)) return "invalid";
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : "invalid";
}
/** What to tell someone about an amount they typed, or nothing. */
export function amountHint(typed: string): string | undefined {
  const a = parseAmount(typed);
  if (a === "ambiguous") return `Write ${typed.trim().replace(",", "")} or ${typed.trim().replace(",", ".")}: a comma could mean either`;
  if (a === "invalid") return "Just a number, like 250 or 1.5";
  return undefined;
}

/**
 * Cleans a recipe from the editor. A draft may be unfinished (`recipeReady` says when it isn't); empty lines and steps
 * are dropped. Prep recipes mark each allergen contains or free; dishes may also mark it as one that can be left out.
 */
export function cleanRecipe(kind: RecipeKind, input: RecipeInput): Cleaned<{ title: string; body: PrepBody | DishBody }> {
  const title = cleanTitle(input.title);
  if (!title.ok) return title;
  if (input.sections.some((s) => !KITCHEN.includes(s as Area))) return { ok: false, error: "Recipes are for back of house or production" };
  const sections = KITCHEN.filter((s) => input.sections.includes(s));
  if (!sections.length) return { ok: false, error: "Say who makes it: back of house, production, or both" };
  const category = oneLine(input.category);
  if (category.length > RECIPE_LIMITS.category) return { ok: false, error: `Keep the category under ${RECIPE_LIMITS.category} characters` };

  const items: Item[] = [];
  const word = kind === "prep" ? "Ingredient" : "Component";
  for (const [i, x] of input.items.entries()) {
    const name = oneLine(x.name), unit = oneLine(x.unit), note = oneLine(x.note), qty = amount(x.qty);
    if (!name && !unit && !note && qty === undefined && !x.prep) continue;
    const n = i + 1;
    if (!name) return { ok: false, error: `${word} ${n} needs a name` };
    if (qty === false) return { ok: false, error: `${word} ${n}: the amount must be a number above 0` };
    if (name.length > RECIPE_LIMITS.name || note.length > RECIPE_LIMITS.note) return { ok: false, error: `${word} ${n} is too long` };
    if (unit.length > RECIPE_LIMITS.unit) return { ok: false, error: `${word} ${n}: keep the unit short (g, kg, ml, tbsp…)` };
    if (qty !== undefined && !unit) return { ok: false, error: `${word} ${n} needs a unit (g, ml, piece…)` };
    if (x.prep && (kind !== "dish" || !UUID.test(x.prep))) return { ok: false, error: `${word} ${n}: that link isn't a prep recipe` };
    items.push({ ...(qty !== undefined ? { qty } : {}), unit, name, ...(note ? { note } : {}), ...(x.prep ? { prep: x.prep.toLowerCase() } : {}) });
  }
  if (items.length > RECIPE_LIMITS.items) return { ok: false, error: `At most ${RECIPE_LIMITS.items} lines` };

  const steps = cleanSteps(input.steps);
  if (!steps.ok) return steps;
  if (input.photo && !isPhoto(input.photo)) return { ok: false, error: "The photo didn't upload properly. Add it again" };
  const photo = input.photo ? { photo: { id: input.photo.id, w: input.photo.w, h: input.photo.h } } : {};

  const allowed: Mark[] = kind === "prep" ? ["contains", "free"] : ["contains", "removable", "free"];
  const allergens: Allergens = {};
  for (const [k, v] of Object.entries(input.allergens)) {
    if (!ALLERGEN_KEYS.includes(k as AllergenKey)) return { ok: false, error: "Unknown allergen" };
    if (!v) continue;
    if (!allowed.includes(v as Mark)) return { ok: false, error: `${ALLERGEN_NAME[k as AllergenKey]}: choose contains${kind === "dish" ? ", can be left out" : ""} or free from` };
    allergens[k as AllergenKey] = v as Mark;
  }

  if (kind === "prep") {
    const makesQty = amount(input.makes?.qty), makesUnit = oneLine(input.makes?.unit);
    if (makesQty === false) return { ok: false, error: "What a batch makes must be a number above 0" };
    if (makesUnit.length > RECIPE_LIMITS.unit) return { ok: false, error: "Keep the batch unit short (L, kg, portions…)" };
    if (makesQty !== undefined && !makesUnit) return { ok: false, error: "Say what a batch makes in: L, kg, portions…" };
    if (makesQty === undefined && makesUnit) return { ok: false, error: "Say how much one batch makes (a number)" };
    const storage = oneLine(input.storage), notes = cleanText(input.notes);
    if (storage.length > RECIPE_LIMITS.storage) return { ok: false, error: `Keep storage under ${RECIPE_LIMITS.storage} characters` };
    if (notes.length > RECIPE_LIMITS.notes) return { ok: false, error: `Keep the notes under ${RECIPE_LIMITS.notes} characters` };
    let shelfLife: PrepBody["shelfLife"];
    if (input.shelfLife && input.shelfLife.qty !== null) {
      const unit = input.shelfLife.unit as ShelfUnit;
      if (unit !== "hours" && unit !== "days") return { ok: false, error: "Shelf life is in hours or days" };
      const q = input.shelfLife.qty;
      if (!Number.isInteger(q) || q < 1 || q > SHELF_MAX[unit]) return { ok: false, error: `Shelf life: a whole number of ${unit}, up to ${SHELF_MAX[unit]}` };
      shelfLife = { qty: q, unit };
    }
    const body: PrepBody = {
      sections, category, ...(makesQty !== undefined ? { makes: { qty: makesQty, unit: makesUnit } } : {}), ingredients: items,
      steps: steps.value, ...photo, storage, ...(shelfLife ? { shelfLife } : {}), allergens: allergens as Allergens<"contains" | "free">, notes,
    };
    return { ok: true, value: { title: title.value, body } };
  }
  const modifications = cleanText(input.modifications);
  if (modifications.length > RECIPE_LIMITS.modifications) return { ok: false, error: `Keep the kitchen notes under ${RECIPE_LIMITS.modifications} characters` };
  if ((input.dietary ?? []).some((d) => !DIETS.includes(d as Diet))) return { ok: false, error: "Unknown dietary tag" };
  const body: DishBody = {
    sections, category, components: items, steps: steps.value, ...photo, allergens, modifications,
    dietary: DIETS.filter((d) => (input.dietary ?? []).includes(d)),
  };
  return { ok: true, value: { title: title.value, body } };
}

/** Allergens not yet answered (each must be marked before it's sent for approval). */
export const unanswered = (a: Allergens) => ALLERGEN_KEYS.filter((k) => !a[k]);

const yes: Checked = { ok: true };
const no = (error: string): Checked => ({ ok: false, error });

/** Ready to send for approval or publish: everything a cook (and front of house) needs is there. */
export function recipeReady(kind: RecipeKind, body: PrepBody | DishBody): Checked {
  if (!body.category) return no("Choose a category");
  const items = kind === "prep" ? (body as PrepBody).ingredients : (body as DishBody).components;
  if (!items.length) return no(kind === "prep" ? "Add the ingredients" : "Add what goes in a portion");
  if (!body.steps.length) return no(kind === "prep" ? "Add the method: at least one step" : "Add how it's built: at least one step");
  const i = body.steps.findIndex((s) => !s.text);
  if (i >= 0) return no(`Step ${i + 1} needs words, not just a photo or warning`);
  if (kind === "prep") {
    const p = body as PrepBody;
    if (!p.makes) return no("Say what one batch makes");
    if (!p.storage) return no("Say how it's stored");
    if (!p.shelfLife) return no("Give its shelf life");
  }
  const missing = unanswered(body.allergens);
  if (missing.length) return no(`Mark every allergen: ${missing.map((k) => ALLERGEN_NAME[k]).join(", ")} ${missing.length === 1 ? "isn't" : "aren't"} marked yet`);
  return yes;
}

/** How a dish's allergens changed between two versions (unanswered counts as a change too). */
export function allergenChanges(before: Allergens | undefined, after: Allergens): { key: AllergenKey; from?: Mark; to?: Mark }[] {
  return ALLERGEN_KEYS.filter((k) => (before?.[k] ?? undefined) !== (after[k] ?? undefined)).map((k) => ({ key: k, from: before?.[k], to: after[k] }));
}

/**
 * Publishing a dish: "changed" if its allergens differ from the version it replaces (everyone at its sites then confirms
 * they've seen it); "same" keeps any earlier change still to be confirmed; "none" for a first version.
 */
export function allergenAlert(published: DishBody | undefined, next: DishBody): "changed" | "same" | "none" {
  if (!published) return "none";
  return allergenChanges(published.allergens, next.allergens).length ? "changed" : "same";
}

/**
 * Who sees recipes (on the full app only): people who write them, and kitchen staff (back of house or production at an
 * open site). Every recipe, whichever kitchen makes it: a restaurant cook can open the broth Wembley makes.
 */
export function seesRecipes(p: Pick<Person, "status" | "access">, sites: Pick<Site, "id" | "kind" | "status">[]): boolean {
  return p.status === "active" && (canDraft(p) || readsAny(KITCHEN, p, sites));
}

type DishLike = Pick<LibraryDoc, "id" | "retiredAt"> & { published?: Pick<LibraryVersion, "id" | "allergensChangedAt" | "publishedAt"> & { body: { sections: Area[] } } };

/** Whether this person is asked about a dish's allergen change: anyone (but owners) at a site the dish is served at. */
export function alertedAt(p: Pick<Person, "status" | "access">, sections: Area[], sites: Pick<Site, "id" | "kind" | "status">[]): SiteId[] {
  if (p.status !== "active" || isOwner(p)) return [];
  const reach = reachedSites(sections, sites);
  return p.access.filter((a) => reach.includes(a.siteId)).map((a) => a.siteId);
}

/**
 * Dishes whose allergens changed and this person hasn't confirmed since (newest first). A confirmation counts for the
 * change if it was made after it, on any version of that dish.
 */
export function allergenAlerts<D extends DishLike>(p: Pick<Person, "status" | "access">, dishes: D[], acks: { docId: string; at: number }[],
  sites: Pick<Site, "id" | "kind" | "status">[]): D[] {
  return dishes.filter((d) => {
    const v = d.published, at = v?.allergensChangedAt;
    if (d.retiredAt || !v || !at) return false;
    if (!alertedAt(p, v.body.sections, sites).length) return false;
    return !acks.some((a) => a.docId === d.id && a.at >= at);
  }).sort((a, b) => (b.published!.allergensChangedAt ?? 0) - (a.published!.allergensChangedAt ?? 0));
}

/** Who has confirmed a dish's allergen change, site by site (managers chase the rest). */
export function alertStats(sections: Area[], docId: string, changedAt: number, people: Pick<Person, "id" | "name" | "status" | "access">[],
  acks: { docId: string; personId: string; at: number }[], sites: Pick<Site, "id" | "name" | "kind" | "status">[]) {
  const done = new Set(acks.filter((a) => a.docId === docId && a.at >= changedAt).map((a) => a.personId));
  const reach = reachedSites(sections, sites);
  return sites.filter((s) => reach.includes(s.id)).map((site) => {
    const here = people.filter((p) => alertedAt(p, sections, [site]).length).sort((a, b) => a.name.localeCompare(b.name));
    return { siteId: site.id, siteName: site.name, confirmed: here.filter((p) => done.has(p.id)).length, missing: here.filter((p) => !done.has(p.id)).map((p) => p.name), total: here.length };
  });
}

/** An amount times a factor, in kg or L once it reaches 1000 g or ml (and back below 1). */
export function scaleQty(qty: number, unit: string, factor: number): Qty {
  let q = qty * factor, u = unit;
  const lu = unit.toLowerCase();
  if (lu === "g" && q >= 1000) { q /= 1000; u = "kg"; }
  else if (lu === "kg" && q < 1) { q *= 1000; u = "g"; }
  else if (lu === "ml" && q >= 1000) { q /= 1000; u = "L"; }
  else if (lu === "l" && q < 1) { q *= 1000; u = "ml"; }
  return { qty: q, unit: u };
}

/** "750 g", "1.25 kg", "0.5 bottle": whole grams and ml (one decimal below 10), otherwise up to two decimals. */
export function formatQty(qty: number, unit: string): string {
  const lu = unit.toLowerCase();
  const digits = lu === "g" || lu === "ml" ? (qty >= 10 ? 0 : 1) : 2;
  const n = Number(qty.toFixed(digits));
  return `${n.toLocaleString("en-GB", { maximumFractionDigits: digits })}${unit ? ` ${unit}` : ""}`;
}

/** The factor that turns a line's amount into what's to hand ("I've 18 kg of bones": 18 / 25). Undefined if it can't. */
export function factorFor(base: number | undefined, have: number): number | undefined {
  if (!base || !Number.isFinite(have) || have <= 0) return undefined;
  const f = have / base;
  return f > 0 && f <= 1000 ? f : undefined;
}

/** Converts what's to hand to the line's unit when it's g/kg or ml/L (so "18 kg" works against "25000 g"). */
export function inUnit(have: number, haveUnit: string, unit: string): number | undefined {
  const a = haveUnit.toLowerCase(), b = unit.toLowerCase();
  if (a === b) return have;
  if (a === "kg" && b === "g") return have * 1000;
  if (a === "g" && b === "kg") return have / 1000;
  if (a === "l" && b === "ml") return have * 1000;
  if (a === "ml" && b === "l") return have / 1000;
  return undefined;
}

export interface MatrixRow { id: string; code: string; title: string; category: string; marks: Allergens; dietary: Diet[]; modifications: string; changedAt?: number }

/** The allergen matrix: every published dish, by menu section (in the order the sections were first added), then by code. */
export function allergenMatrix(dishes: LibraryDoc<DishBody>[]): { category: string; rows: MatrixRow[] }[] {
  const rows = dishes.filter((d) => d.published && !d.retiredAt).map((d): MatrixRow => {
    const v = d.published!;
    return { id: d.id, code: d.code, title: v.title, category: v.body.category || "Other", marks: v.body.allergens, dietary: v.body.dietary ?? [],
      modifications: v.body.modifications ?? "", changedAt: v.allergensChangedAt };
  }).sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  const groups = new Map<string, { category: string; rows: MatrixRow[] }>();
  for (const r of rows) {
    const key = r.category.toLowerCase();
    if (!groups.has(key)) groups.set(key, { category: r.category, rows: [] });
    groups.get(key)!.rows.push(r);
  }
  return Array.from(groups.values());
}

/** For a guest avoiding these allergens: fine as it is, fine if the kitchen leaves something out, or not for them. */
export type Fit = "safe" | "ask" | "no";
export function fitFor(marks: Allergens, avoid: AllergenKey[]): Fit {
  if (avoid.some((k) => marks[k] !== "free" && marks[k] !== "removable")) return "no"; // contains it, or not marked
  if (avoid.some((k) => marks[k] === "removable")) return "ask";
  return "safe";
}

/**
 * Things to check before approving a dish (they don't stop it): tags that don't fit its allergens, linked prep recipes
 * that disagree with it, and links to prep recipes no longer in use.
 */
export function dishWarnings(dish: DishBody, preps: Map<string, { title: string; allergens: Allergens; retired?: boolean }>): string[] {
  const out: string[] = [];
  const contains = (k: AllergenKey) => dish.allergens[k] === "contains";
  const named = (keys: AllergenKey[]) => keys.map((k) => ALLERGEN_NAME[k].toLowerCase()).join(" and ");
  const animal = (["fish", "crustaceans", "molluscs"] as AllergenKey[]).filter(contains);
  if (dish.dietary.includes("Vegan")) {
    const bad = (["milk", "eggs", "fish", "crustaceans", "molluscs"] as AllergenKey[]).filter(contains);
    if (bad.length) out.push(`It's tagged vegan but contains ${named(bad)}`);
  } else if (dish.dietary.includes("Vegetarian") && animal.length) out.push(`It's tagged vegetarian but contains ${named(animal)}`);
  for (const c of dish.components) {
    const p = c.prep ? preps.get(c.prep) : undefined;
    if (!p) continue;
    if (p.retired) out.push(`${p.title} is retired: link what replaced it`);
    const missed = ALLERGEN_KEYS.filter((k) => p.allergens[k] === "contains" && dish.allergens[k] === "free");
    if (missed.length) out.push(`${p.title} contains ${named(missed)}, but the dish is marked free from ${missed.length === 1 ? "it" : "them"}`);
  }
  return out;
}

/**
 * Publishing a prep recipe: the published dishes that use it but say they're free from something it contains (they
 * need a new version; nothing changes them automatically).
 */
export function dishesAtOdds(prepId: string, allergens: Allergens, dishes: LibraryDoc<DishBody>[]): { id: string; code: string; title: string; missed: AllergenKey[] }[] {
  return dishes.filter((d) => d.published && !d.retiredAt && d.published.body.components.some((c) => c.prep === prepId)).flatMap((d) => {
    const missed = ALLERGEN_KEYS.filter((k) => allergens[k] === "contains" && d.published!.body.allergens[k] === "free");
    return missed.length ? [{ id: d.id, code: d.code, title: d.published!.title, missed }] : [];
  });
}
