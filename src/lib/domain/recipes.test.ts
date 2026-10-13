import { describe, expect, it } from "vitest";
import {
  ALLERGEN_KEYS, allergenAlert, allergenAlerts, allergenChanges, allergenMatrix, alertStats, amountHint, cleanRecipe, dishesAtOdds, dishWarnings, factorFor, fitFor, formatQty,
  cardPanels, ingredientKey, ingredientPhotos, inUnit, noteLines, parseAmount, recipeReady, scaleQty, seesRecipes, unanswered, type Allergens, type DishBody, type PrepBody, type RecipeInput,
} from "./recipes";
import { codePrefix, dropPhotos, photoIds, type LibraryDoc } from "./library";
import type { Person, Site, SiteAccess } from "./types";

const person = (id: string, access: SiteAccess[], over: Partial<Person> = {}): Person => ({ id, staffCode: id, name: id, status: "active", pinFailed: 0, access, ...over });
const at = (siteId: SiteAccess["siteId"], role: SiteAccess["role"], sections: SiteAccess["sections"] = []): SiteAccess => ({ siteId, role, sections });
const owner = person("own", [at("EAS", "owner"), at("WEM", "owner")]);
const mgr = person("mgr", [at("EAS", "manager", ["FOH", "BOH"])]);
const cook = person("cook", [at("EAS", "staff", ["BOH"])]);
const server = person("srv", [at("EAS", "staff", ["FOH"])]);
const prod = person("prd", [at("WEM", "staff", ["PROD"])]);
const SITES: Site[] = [
  { id: "EAS", name: "Eastcote", kind: "restaurant", status: "open" },
  { id: "WEM", name: "Wembley", kind: "production", status: "open" },
  { id: "SYD", name: "Sydenham", kind: "restaurant", status: "closed" },
];
const all = (m: "contains" | "free" | "removable" = "free"): Allergens => Object.fromEntries(ALLERGEN_KEYS.map((k) => [k, m]));
const PHOTO = { id: "8f0c8e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b", w: 1200, h: 900 };

const prepInput = (over: Partial<RecipeInput> = {}): RecipeInput => ({
  title: "  Pho   broth ", sections: ["PROD"], category: " Broth ", makes: { qty: 60, unit: "L" },
  items: [{ qty: 25, unit: "kg", name: " Marrow bones ", note: "" }, { qty: null, unit: "", name: "", note: "" }, { qty: 5, unit: "bottle", name: "Fish sauce", note: " added last " }],
  steps: [{ text: "Blanch the bones" }, { text: "" }, { text: "Simmer 12 hours", warning: "Keep below a rolling boil" }],
  storage: "Chilled 0–5°C, covered and labelled", shelfLife: { qty: 3, unit: "days" }, notes: "", allergens: { ...all("free"), fish: "contains" }, ...over,
});
const dishInput = (over: Partial<RecipeInput> = {}): RecipeInput => ({
  title: "Pho beef brisket", sections: ["BOH"], category: "Pho",
  items: [{ qty: 330, unit: "g", name: "Pho broth", note: "", prep: "1f0c8e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b" }, { qty: 80, unit: "g", name: "Brisket", note: "sliced thin" }],
  steps: [{ text: "Noodles in the bowl, brisket on top, broth over" }], allergens: { ...all("free"), fish: "contains", peanuts: "removable" },
  modifications: "Crushed peanuts on top: leave off", dietary: [], ...over,
});

describe("recipes: content", () => {
  it("cleans a prep recipe: tidies text, drops empty lines and steps", () => {
    const r = cleanRecipe("prep", prepInput());
    expect(r).toEqual({ ok: true, value: { title: "Pho broth", body: {
      sections: ["PROD"], category: "Broth", makes: { qty: 60, unit: "L" },
      ingredients: [{ qty: 25, unit: "kg", name: "Marrow bones" }, { qty: 5, unit: "bottle", name: "Fish sauce", note: "added last" }],
      steps: [{ text: "Blanch the bones" }, { text: "Simmer 12 hours", warning: "Keep below a rolling boil" }],
      storage: "Chilled 0–5°C, covered and labelled", shelfLife: { qty: 3, unit: "days" }, allergens: { ...all("free"), fish: "contains" }, notes: "",
    } } });
  });
  it("cleans a dish: per-portion components linked to prep recipes, dietary tags in order", () => {
    const r = cleanRecipe("dish", dishInput({ dietary: ["Vegan", "Vegetarian"], photo: PHOTO }));
    expect(r.ok && r.value.body).toMatchObject({ components: [{ qty: 330, unit: "g", name: "Pho broth", prep: "1f0c8e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b" }, { qty: 80, unit: "g", name: "Brisket", note: "sliced thin" }],
      dietary: ["Vegetarian", "Vegan"], photo: PHOTO, modifications: "Crushed peanuts on top: leave off" });
  });
  it("refuses what doesn't make sense", () => {
    expect(cleanRecipe("prep", prepInput({ sections: [] }))).toMatchObject({ ok: false, error: "Say who makes it: back of house, production, or both" });
    expect(cleanRecipe("prep", prepInput({ sections: ["FOH"] }))).toMatchObject({ ok: false, error: "Recipes are for back of house or production" });
    expect(cleanRecipe("prep", prepInput({ items: [{ qty: 2, unit: "kg", name: "", note: "" }] }))).toMatchObject({ ok: false, error: "Ingredient 1 needs a name" });
    expect(cleanRecipe("prep", prepInput({ items: [{ qty: -1, unit: "kg", name: "Salt", note: "" }] }))).toMatchObject({ ok: false, error: "Ingredient 1: the amount must be a number above 0" });
    expect(cleanRecipe("prep", prepInput({ items: [{ qty: 2, unit: "", name: "Salt", note: "" }] }))).toMatchObject({ ok: false, error: "Ingredient 1 needs a unit (g, ml, piece…)" });
    expect(cleanRecipe("prep", prepInput({ items: [{ qty: null, unit: "", name: "Sesame oil", note: "a drizzle" }] })).ok).toBe(true); // no amount: as written
    expect(cleanRecipe("prep", prepInput({ items: [{ qty: 1, unit: "L", name: "Broth", note: "", prep: "1f0c8e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b" }] }))).toMatchObject({ ok: false });
    expect(cleanRecipe("prep", prepInput({ allergens: { fish: "removable" } }))).toMatchObject({ ok: false, error: "Fish: choose contains or free from" });
    expect(cleanRecipe("dish", dishInput({ allergens: { pollen: "contains" } }))).toMatchObject({ ok: false, error: "Unknown allergen" });
    expect(cleanRecipe("prep", prepInput({ shelfLife: { qty: 100, unit: "hours" } }))).toMatchObject({ ok: false, error: "Shelf life: a whole number of hours, up to 72" });
    expect(cleanRecipe("prep", prepInput({ makes: { qty: 60, unit: "" } }))).toMatchObject({ ok: false });
    expect(cleanRecipe("prep", prepInput({ makes: { qty: null, unit: "L" } }))).toMatchObject({ ok: false, error: "Say how much one batch makes (a number)" });
    expect(cleanRecipe("prep", prepInput({ makes: { qty: 0.0004, unit: "L" } }))).toMatchObject({ ok: false }); // rounds to nothing
    expect(cleanRecipe("prep", prepInput({ items: [{ qty: 0.0004, unit: "g", name: "Salt", note: "" }] }))).toMatchObject({ ok: false });
    expect(cleanRecipe("dish", dishInput({ dietary: ["Halal"] }))).toMatchObject({ ok: false, error: "Unknown dietary tag" });
  });
  it("is ready for approval when everything a cook needs is there, and every allergen is marked", () => {
    const prepBody = (cleanRecipe("prep", prepInput()) as { ok: true; value: { body: PrepBody } }).value.body;
    expect(recipeReady("prep", prepBody)).toEqual({ ok: true });
    expect(recipeReady("prep", { ...prepBody, shelfLife: undefined })).toMatchObject({ ok: false, error: "Give its shelf life" });
    expect(recipeReady("prep", { ...prepBody, storage: "" })).toMatchObject({ ok: false, error: "Say how it's stored" });
    expect(recipeReady("prep", { ...prepBody, makes: undefined })).toMatchObject({ ok: false, error: "Say what one batch makes" });
    expect(recipeReady("prep", { ...prepBody, ingredients: [] })).toMatchObject({ ok: false, error: "Add the ingredients" });
    const partial = Object.fromEntries(Object.entries(prepBody.allergens).filter(([k]) => k !== "sesame" && k !== "soya"));
    expect(recipeReady("prep", { ...prepBody, allergens: partial })).toMatchObject({ ok: false, error: "Mark every allergen: Sesame, Soya aren't marked yet" });
    expect(unanswered({})).toHaveLength(15);
    const dishBody = (cleanRecipe("dish", dishInput()) as { ok: true; value: { body: DishBody } }).value.body;
    expect(recipeReady("dish", dishBody)).toEqual({ ok: true });
    expect(recipeReady("dish", { ...dishBody, category: "" })).toMatchObject({ ok: false, error: "Choose its menu section" });
    // A dish's allergens can go live before its portion and build steps are written.
    expect(recipeReady("dish", { ...dishBody, components: [], steps: [] })).toEqual({ ok: true });
    expect(recipeReady("dish", { ...dishBody, steps: [{ text: "", photo: PHOTO }] })).toMatchObject({ ok: false, error: "Step 1 needs words, not just a photo or warning" });
  });
  it("codes by kind and section; photos include the finished photo", () => {
    expect([codePrefix("prep", ["PROD"]), codePrefix("dish", ["BOH"]), codePrefix("prep", ["BOH", "PROD"]), codePrefix("sop", [])]).toEqual(["PREP-PROD-", "DISH-BOH-", "PREP-GEN-", "SOP-GEN-"]);
    const body = { steps: [{ text: "a", photo: { ...PHOTO, id: "9f0c8e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b" } }], photo: PHOTO };
    expect(photoIds(body)).toEqual(["9f0c8e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b", PHOTO.id]);
    expect(dropPhotos(body, new Set([PHOTO.id]))).toEqual({ steps: body.steps });
  });
});

describe("recipes: the card (pictures, labels, standards)", () => {
  const P2 = { ...PHOTO, id: "2f0c8e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b" }, P3 = { ...PHOTO, id: "3f0c8e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b" };
  it("an ingredient or component can carry a picture; a line with only a picture still needs a name", () => {
    const r = cleanRecipe("prep", prepInput({ items: [{ qty: 1, unit: "kg", name: "Sugar", note: "", photo: P2 }] }));
    expect(r.ok && (r.value.body as PrepBody).ingredients).toEqual([{ qty: 1, unit: "kg", name: "Sugar", photo: P2 }]);
    expect(cleanRecipe("prep", prepInput({ items: [{ qty: null, unit: "", name: "", note: "", photo: P2 }] }))).toMatchObject({ ok: false, error: "Ingredient 1 needs a name" });
    expect(cleanRecipe("dish", dishInput({ items: [{ qty: 1, unit: "piece", name: "Baguette", note: "", photo: { id: "nope", w: 1, h: 1 } }] })))
      .toMatchObject({ ok: false, error: "Component 1: the picture didn't upload properly. Add it again" });
  });
  it("a dish's labels sit on its photo (percent across and down) and its serving standards are short checks", () => {
    const r = cleanRecipe("dish", dishInput({
      callouts: [{ x: 12.345, y: 40, text: "  Protein   (generous) " }, { x: 50, y: 50, text: "  " }], standards: [" NOT over-burnt ", "", "Full, neat and consistent every time"],
    }));
    expect(r.ok && (r.value.body as DishBody).callouts).toEqual([{ x: 12.3, y: 40, text: "Protein (generous)" }]);
    expect(r.ok && (r.value.body as DishBody).standards).toEqual(["NOT over-burnt", "Full, neat and consistent every time"]);
    const none = cleanRecipe("dish", dishInput());
    expect(none.ok && "callouts" in none.value.body).toBe(false);
    expect(cleanRecipe("dish", dishInput({ callouts: [{ x: 120, y: 5, text: "Off" }] }))).toMatchObject({ ok: false, error: "A label isn't on the photo. Place it again" });
    expect(cleanRecipe("dish", dishInput({ callouts: Array.from({ length: 9 }, (_, i) => ({ x: i, y: i, text: `L${i}` })) }))).toMatchObject({ ok: false });
    expect(cleanRecipe("dish", dishInput({ standards: ["x".repeat(81)] }))).toMatchObject({ ok: false });
    expect(cleanRecipe("prep", prepInput({ standards: ["Clean"] }))).toMatchObject({ ok: false, error: "Labels and serving standards are for dishes" });
  });
  it("ingredient pictures count as used, and one the owner erases is dropped (the line stays)", () => {
    const body: Pick<PrepBody, "steps" | "ingredients"> = { steps: [{ text: "a" }], ingredients: [{ unit: "kg", name: "Sugar", photo: P2 }, { unit: "", name: "Water" }] };
    expect(photoIds(body)).toEqual([P2.id]);
    expect(dropPhotos(body, new Set([P2.id])).ingredients).toEqual([{ unit: "kg", name: "Sugar" }, { unit: "", name: "Water" }]);
    expect(photoIds({ steps: [], components: [{ unit: "", name: "Baguette", photo: P3 }] } as Pick<DishBody, "steps" | "components">)).toEqual([P3.id]);
  });
  it("a picture of an ingredient is offered wherever that ingredient appears, whatever the case or plural", () => {
    const same = (a: string, b: string) => ingredientKey(a) === ingredientKey(b);
    expect([same("Sugar", " sugar "), same("Birds eye chillies", "bird's eye chilli"), same("Garlic (minced)", "garlic"), same("Tomatoes", "tomato"),
      same("Berries", "berry"), same("Eggs", "egg"), same("Glass noodles", "glass noodle")]).toEqual([true, true, true, true, true, true, true]);
    expect([same("Sugar", "Salt"), same("Fish sauce", "Soy sauce")]).toEqual([false, false]);
    const older = { ...(cleanRecipe("prep", prepInput()) as { ok: true; value: { body: PrepBody } }).value.body, ingredients: [{ qty: 1, unit: "kg", name: "Sugar", photo: P2 }] };
    const newer = { ...older, ingredients: [{ qty: 6, unit: "g", name: "sugar", photo: P3 }, { qty: 2, unit: "piece", name: "Birds eye chilli", photo: PHOTO }] };
    const found = ingredientPhotos([older, newer] as PrepBody[]);
    expect(found.get("sugar")?.photo).toEqual(P3);
    expect(found.get(ingredientKey("Birds eye chilli"))?.photo).toEqual(PHOTO);
    expect(ingredientPhotos([older, newer] as PrepBody[], new Set([P3.id])).get("sugar")?.photo).toEqual(P2); // an erased photo is never offered: the one before it is
    expect(ingredientPhotos([older] as PrepBody[], new Set([P2.id])).get("sugar")).toBeUndefined();
  });
  it("a long method goes over two panels; notes become short checks", () => {
    expect(cardPanels([1, 2, 3], 12)).toEqual({ first: [1, 2, 3], more: [] });
    expect(cardPanels(Array.from({ length: 14 }, (_, i) => i + 1), 12)).toEqual({ first: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], more: [13, 14] });
    expect(noteLines("- Keep refrigerated\n• Use within 7–10 days\n\n")).toEqual(["Keep refrigerated", "Use within 7–10 days"]);
    expect(noteLines("Keep at 5°C. Max. 3 days.")).toEqual(["Keep at 5°C. Max. 3 days."]); // a paragraph stays one check
    expect(noteLines("-18°C or below\n✓ Label it")).toEqual(["-18°C or below", "Label it"]);
    expect(noteLines("")).toEqual([]);
  });
});

describe("recipes: allergens", () => {
  it("knows what changed, and when publishing a dish asks everyone to confirm", () => {
    const before = { ...all("free"), peanuts: "removable" as const }, after = { ...all("free"), sesame: "contains" as const };
    expect(allergenChanges(before, after)).toEqual([{ key: "peanuts", from: "removable", to: "free" }, { key: "sesame", from: "free", to: "contains" }]);
    const dish = (allergens: Allergens) => ({ allergens } as DishBody);
    expect(allergenAlert(undefined, dish(after))).toBe("none"); // a first version isn't a change
    expect(allergenAlert(dish(before), dish(after))).toBe("changed");
    expect(allergenAlert(dish(after), dish({ ...after }))).toBe("same");
  });
  it("everyone at the dish's sites confirms a change once (owners aren't asked); retired dishes drop out", () => {
    const doc = (id: string, changedAt: number | undefined, over: { retiredAt?: number } = {}) =>
      ({ id, retiredAt: undefined as number | undefined, published: { id: `${id}-v`, publishedAt: changedAt ?? 1, allergensChangedAt: changedAt, body: { sections: ["BOH" as const] } }, ...over });
    const dishes = [doc("a", 100), doc("b", 200), doc("c", undefined), doc("d", 300, { retiredAt: 400 })];
    expect(allergenAlerts(server, dishes, [], SITES).map((d) => d.id)).toEqual(["b", "a"]); // front of house too
    expect(allergenAlerts(cook, dishes, [{ docId: "a", at: 150 }, { docId: "b", at: 150 }], SITES).map((d) => d.id)).toEqual(["b"]); // b changed after they confirmed
    expect(allergenAlerts(prod, dishes, [], SITES)).toEqual([]); // Wembley doesn't serve it
    expect(allergenAlerts(owner, dishes, [], SITES)).toEqual([]);
    const stats = alertStats(["BOH"], "a", 100, [owner, mgr, cook, server, prod], [{ docId: "a", personId: "cook", at: 120 }, { docId: "a", personId: "srv", at: 50 }], SITES);
    expect(stats).toEqual([{ siteId: "EAS", siteName: "Eastcote", confirmed: 1, missing: ["mgr", "srv"], total: 3 }]);
  });
  it("the matrix: published dishes by menu section, in the order they were added", () => {
    const d = (code: string, title: string, category: string, over: Partial<LibraryDoc<DishBody>> = {}): LibraryDoc<DishBody> => ({
      id: code, kind: "dish", code, createdAt: 1,
      published: { id: `${code}-v`, docId: code, status: "published", title, authorId: "x", authorName: "x", createdAt: 1, updatedAt: 1, contributors: [], rev: 1,
        body: { sections: ["BOH"], category, components: [], steps: [], allergens: all(), modifications: "", dietary: [] } }, ...over,
    });
    const m = allergenMatrix([d("DISH-BOH-010", "Pho Prawns", "Pho"), d("DISH-BOH-002", "Spring Rolls", "Starters"), d("DISH-BOH-003", "Pho Brisket", "pho"),
      d("DISH-BOH-004", "Old dish", "Starters", { retiredAt: 5 }), d("DISH-BOH-005", "Draft only", "Rice", { published: undefined })]);
    expect(m.map((g) => [g.category, g.rows.map((r) => r.title)])).toEqual([["Starters", ["Spring Rolls"]], ["pho", ["Pho Brisket", "Pho Prawns"]]]);
  });
  it("for a guest avoiding allergens: fine, ask the kitchen to leave it out, or not for them", () => {
    const marks = { ...all("free"), peanuts: "removable" as const, fish: "contains" as const };
    expect([fitFor(marks, []), fitFor(marks, ["sesame"]), fitFor(marks, ["peanuts"]), fitFor(marks, ["peanuts", "fish"]), fitFor({}, ["milk"])]).toEqual(["safe", "safe", "ask", "no", "no"]);
  });
  it("warns before approving: tags that don't fit, and linked prep recipes that disagree", () => {
    const dish = (cleanRecipe("dish", dishInput()) as { ok: true; value: { body: DishBody } }).value.body;
    const broth = new Map([["1f0c8e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b", { title: "Pho broth", allergens: { ...all("free"), fish: "contains" as const, celery: "contains" as const } }]]);
    expect(dishWarnings(dish, broth)).toEqual(["Pho broth contains celery, but the dish is marked free from it"]);
    expect(dishWarnings({ ...dish, dietary: ["Vegan"], allergens: { ...dish.allergens, eggs: "contains" } }, new Map())).toEqual(["It's tagged vegan but contains eggs and fish"]);
    expect(dishWarnings({ ...dish, dietary: ["Vegetarian"] }, new Map())).toEqual(["It's tagged vegetarian but contains fish"]);
    expect(dishWarnings({ ...dish, dietary: ["Vegan"], allergens: { ...all("free"), eggs: "removable" } }, new Map())).toEqual([]); // vegan without the egg
    const retired = new Map([["1f0c8e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b", { title: "Pho broth", allergens: { ...all("free"), fish: "contains" as const }, retired: true }]]);
    expect(dishWarnings(dish, retired)).toEqual(["Pho broth is retired: link what replaced it"]);
  });
  it("publishing a prep recipe: the dishes using it that now disagree", () => {
    const broth = "1f0c8e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b";
    const dishDoc = (id: string, allergens: Allergens, linked: boolean, over: Partial<LibraryDoc<DishBody>> = {}): LibraryDoc<DishBody> => ({
      id, kind: "dish", code: id, createdAt: 1,
      published: { id: `${id}-v`, docId: id, status: "published", title: `Dish ${id}`, authorId: "x", authorName: "x", createdAt: 1, updatedAt: 1, contributors: [], rev: 1,
        body: { sections: ["BOH"], category: "Pho", components: linked ? [{ unit: "ml", name: "Broth", prep: broth }] : [], steps: [], allergens, modifications: "", dietary: [] } }, ...over,
    });
    const dishes = [dishDoc("a", { ...all("free"), fish: "contains" }, true), dishDoc("b", all("free"), true), dishDoc("c", all("free"), false), dishDoc("d", all("free"), true, { retiredAt: 3 })];
    expect(dishesAtOdds(broth, { ...all("free"), fish: "contains", celery: "contains" }, dishes)).toEqual([
      { id: "a", code: "a", title: "Dish a", missed: ["celery"] }, { id: "b", code: "b", title: "Dish b", missed: ["celery", "fish"] },
    ]);
  });
});

describe("recipes: who sees them", () => {
  it("kitchen know-how: writers and kitchen staff (any kitchen's recipes); not front of house", () => {
    expect([mgr, cook, server, prod, owner].map((p) => seesRecipes(p, SITES))).toEqual([true, true, false, true, true]);
    expect(seesRecipes({ ...cook, status: "frozen" }, SITES)).toBe(false);
    expect(seesRecipes(person("syd", [at("SYD", "staff", ["BOH"])]), SITES)).toBe(false); // a closed site
  });
});

describe("recipes: typed amounts", () => {
  it("reads numbers as typed, a decimal comma too, and refuses a comma that could mean thousands", () => {
    expect(["", "250", "1.5", "1,5", ".5", "1,500", "2,5005", "1.2.3", "-1", "1e3", "abc"].map(parseAmount))
      .toEqual([null, 250, 1.5, 1.5, 0.5, "ambiguous", 2.5005, "invalid", "invalid", "invalid", "invalid"]);
    expect([amountHint("1,500"), amountHint("abc"), amountHint("1,5"), amountHint("")]).toEqual(["Write 1500 or 1.500: a comma could mean either", "Just a number, like 250 or 1.5", undefined, undefined]);
  });
});

describe("recipes: scaling", () => {
  it("scales amounts and switches to kg or L past 1000", () => {
    expect(scaleQty(750, "g", 2)).toEqual({ qty: 1.5, unit: "kg" });
    expect(scaleQty(1.5, "kg", 0.5)).toEqual({ qty: 750, unit: "g" });
    expect(scaleQty(600, "ml", 2)).toEqual({ qty: 1.2, unit: "L" });
    expect(scaleQty(0.5, "bottle", 3)).toEqual({ qty: 1.5, unit: "bottle" });
    expect([formatQty(1.5, "kg"), formatQty(750, "g"), formatQty(7.25, "g"), formatQty(1 / 3, "pack"), formatQty(1200, "g"), formatQty(2, "")]).toEqual(["1.5 kg", "750 g", "7.3 g", "0.33 pack", "1,200 g", "2"]);
  });
  it("scales to what's to hand, converting kg and g, ml and L", () => {
    expect(factorFor(25, 18)).toBeCloseTo(0.72);
    expect([factorFor(undefined, 2), factorFor(25, 0), factorFor(0.001, 5000)]).toEqual([undefined, undefined, undefined]);
    expect([inUnit(18, "kg", "g"), inUnit(500, "g", "kg"), inUnit(2, "L", "ml"), inUnit(2, "pack", "g"), inUnit(3, "tbsp", "tbsp")]).toEqual([18000, 0.5, 2000, undefined, 3]);
  });
});
