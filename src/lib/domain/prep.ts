import type { Area, SiteAccess } from "./types";

/**
 * Kitchen prep handover. One master list is shared by every restaurant; each site keeps its own handovers.
 *
 * Outgoing shift: tap only the items that are Needed (saved as a draft as they go), then submit with
 * "everything else is stocked", which records that the rest was checked. Incoming shift: one report of
 * what's outstanding; tapping an item marks it done and it leaves the outstanding list, but the record stays.
 * Anything still outstanding when the next handover is submitted carries over into it, and the manager is alerted.
 */

export type PrepCategory = "cooking" | "fresh" | "sauces" | "defrost" | "drinks";
export type PrepShift = "next" | "tomorrow_am" | "tomorrow_pm";
export type PrepStatus = "outstanding" | "completed" | "carried";

export const PREP_CATEGORIES: { id: PrepCategory; label: string }[] = [
  { id: "cooking", label: "Cooking & kitchen prep" },
  { id: "fresh", label: "Fresh prep & vegetables" },
  { id: "sauces", label: "Sauces & condiments" },
  { id: "defrost", label: "Defrosting & replenishment" },
  { id: "drinks", label: "Drinks & desserts" },
];

export const PREP_SHIFTS: { id: PrepShift; label: string }[] = [
  { id: "next", label: "Next shift" },
  { id: "tomorrow_am", label: "Tomorrow morning" },
  { id: "tomorrow_pm", label: "Tomorrow evening" },
];

export const categoryLabel = (c: PrepCategory) => PREP_CATEGORIES.find((x) => x.id === c)?.label ?? c;
export const shiftLabel = (s: PrepShift) => PREP_SHIFTS.find((x) => x.id === s)?.label ?? s;

export interface PrepItem { id: string; name: string; category: PrepCategory; position: number; active: boolean }

/**
 * The master list (63 items). Ids are stable: never reuse or renumber one. To drop an item, mark it
 * inactive in a migration (prep_items.active = false) so past handovers still point at it.
 * supabase/migrations/0006_kitchen_prep.sql seeds the same list; a test keeps the two in step.
 */
export const PREP_MASTER: [id: string, name: string, category: PrepCategory][] = [
  ["kp-001", "Change oil – left", "cooking"],
  ["kp-002", "Change oil – right", "cooking"],
  ["kp-003", "Change oil – large fryer", "cooking"],
  ["kp-004", "Cook bun", "cooking"],
  ["kp-005", "Cook prawns", "cooking"],
  ["kp-006", "Soak pho noodles", "cooking"],
  ["kp-007", "Cook rice", "cooking"],
  ["kp-008", "Smash ice", "cooking"],
  ["kp-009", "Fry chicken wings", "cooking"],
  ["kp-010", "Fry chicken bombs", "cooking"],
  ["kp-011", "Fry chicken thigh", "cooking"],
  ["kp-012", "Marinated chicken thigh", "cooking"],
  ["kp-013", "Marinated wings", "cooking"],
  ["kp-014", "Banh mi – sausage", "cooking"],
  ["kp-015", "Banh mi – char siu", "cooking"],
  ["kp-016", "Banh mi – cold pork fat", "cooking"],
  ["kp-017", "Vegetarian pho", "cooking"],
  ["kp-018", "Salad", "fresh"],
  ["kp-019", "Bun/rice – cucumber", "fresh"],
  ["kp-020", "Pho – spring onion", "fresh"],
  ["kp-021", "Pho – onion", "fresh"],
  ["kp-022", "Pho – coriander", "fresh"],
  ["kp-023", "Rice – red cabbage", "fresh"],
  ["kp-024", "Rice – white cabbage", "fresh"],
  ["kp-025", "Rice – shredded carrot (pickle)", "fresh"],
  ["kp-026", "Papaya", "fresh"],
  ["kp-027", "Lime wedges (cut white part in between)", "fresh"],
  ["kp-028", "Pickles", "fresh"],
  ["kp-029", "Pickled onions", "fresh"],
  ["kp-030", "Carrot – papaya", "fresh"],
  ["kp-031", "Carrot – shred", "fresh"],
  ["kp-032", "Banh mi/summer roll – spring onion (use shredder tool)", "fresh"],
  ["kp-033", "Banh mi – red chilli (slices)", "fresh"],
  ["kp-034", "Banh mi/summer roll – cucumber (long way)", "fresh"],
  ["kp-035", "Fish sauce", "sauces"],
  ["kp-036", "Soy sauce", "sauces"],
  ["kp-037", "Peanut sauce", "sauces"],
  ["kp-038", "Chilli mayo", "sauces"],
  ["kp-039", "Egg mayo", "sauces"],
  ["kp-040", "Crushed peanuts", "sauces"],
  ["kp-041", "Defrost – banh mi", "defrost"],
  ["kp-042", "Refill – fish sauce", "defrost"],
  ["kp-043", "Refill – hoisin/sriracha/chilli oil/chilli mayo", "defrost"],
  ["kp-044", "Refill – takeaway containers", "defrost"],
  ["kp-045", "Defrost – prawns", "defrost"],
  ["kp-046", "Defrost – pho soup", "defrost"],
  ["kp-047", "Defrost – brisket", "defrost"],
  ["kp-048", "Defrost – corn chicken", "defrost"],
  ["kp-049", "Defrost – beef balls", "defrost"],
  ["kp-050", "Defrost – S/V chicken", "defrost"],
  ["kp-051", "Defrost – S/V pork", "defrost"],
  ["kp-052", "Defrost – S/V lamb", "defrost"],
  ["kp-053", "Defrost – S/V pork chop", "defrost"],
  ["kp-054", "Defrost – S/V char siu", "defrost"],
  ["kp-055", "Red bean", "drinks"],
  ["kp-056", "Black sugar", "drinks"],
  ["kp-057", "Sugar syrup", "drinks"],
  ["kp-058", "Grass jelly", "drinks"],
  ["kp-059", "Sago pearls", "drinks"],
  ["kp-060", "Basil seed", "drinks"],
  ["kp-061", "Coffee", "drinks"],
  ["kp-062", "Lemon tea", "drinks"],
  ["kp-063", "Lemonade", "drinks"],
];

export const masterItems = (): PrepItem[] => PREP_MASTER.map(([id, name, category], i) => ({ id, name, category, position: i + 1, active: true }));

/** Kitchen staff (BOH) and managers use the prep board. */
export function canUsePrep(access: SiteAccess, isManager: boolean): boolean {
  return isManager || access.sections.includes("BOH" as Area);
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Active items in a category ("all" for every one) whose name contains every word typed, in list order. */
export function filterPrep(items: PrepItem[], category: PrepCategory | "all", query: string): PrepItem[] {
  const words = fold(query).split(/[^a-z0-9]+/).filter(Boolean);
  const order = (c: PrepCategory) => PREP_CATEGORIES.findIndex((x) => x.id === c);
  return items
    .filter((i) => i.active && (category === "all" || i.category === category))
    .filter((i) => { const n = fold(i.name); return words.every((w) => n.includes(w)); })
    .sort((a, b) => order(a.category) - order(b.category) || a.position - b.position);
}

export interface PrepEntry {
  id: string; handoverId: string; siteId: string; itemId: string; status: PrepStatus;
  urgent: boolean; note?: string; carriedFrom?: string;
  createdBy: string; createdAt: number; completedBy?: string; completedAt?: number;
}

export interface SubmitPlan {
  /** Outstanding items from earlier handovers that weren't picked again: added to the new handover. */
  carryIn: { itemId: string; from: string; urgent: boolean; note?: string }[];
  /** Outstanding items that were also picked again: the draft entry is linked to the old one instead of duplicated. */
  merge: { entryId: string; from: string; urgent: boolean; note?: string }[];
  /** Old entries that now live on in the new handover. */
  markCarried: string[];
  /** Items that were still outstanding when this handover was submitted, i.e. their shift ended without them. */
  missed: PrepEntry[];
  /** Active items not needed, which the outgoing shift confirms are stocked by submitting. */
  stockedCount: number;
}

/**
 * Submitting a draft. Nothing outstanding is lost: it moves into the new handover once, never twice,
 * keeping the urgent flag and note. The old entry is kept as "carried" so the history shows the hand-on.
 */
export function planSubmit(draft: PrepEntry[], outstanding: PrepEntry[], activeItemIds: string[]): SubmitPlan {
  const byItem = new Map(draft.map((e) => [e.itemId, e]));
  const plan: SubmitPlan = { carryIn: [], merge: [], markCarried: [], missed: [], stockedCount: 0 };
  const seen = new Set<string>();
  for (const old of [...outstanding].sort((a, b) => b.createdAt - a.createdAt)) {
    plan.markCarried.push(old.id);
    plan.missed.push(old);
    if (seen.has(old.itemId)) continue; // already carried from a newer handover
    seen.add(old.itemId);
    const mine = byItem.get(old.itemId);
    if (mine) plan.merge.push({ entryId: mine.id, from: old.id, urgent: mine.urgent || old.urgent, note: mine.note || old.note });
    else plan.carryIn.push({ itemId: old.itemId, from: old.id, urgent: old.urgent, note: old.note });
  }
  const needed = new Set([...draft.map((e) => e.itemId), ...Array.from(seen)]);
  plan.stockedCount = activeItemIds.filter((id) => !needed.has(id)).length;
  return plan;
}

/** Outstanding first by urgency, then in list order. */
export function reportOrder<T extends { urgent: boolean; itemId: string }>(entries: T[], items: PrepItem[]): T[] {
  const pos = new Map(filterPrep(items.map((i) => ({ ...i, active: true })), "all", "").map((i, n) => [i.id, n]));
  return [...entries].sort((a, b) => Number(b.urgent) - Number(a.urgent) || (pos.get(a.itemId) ?? 999) - (pos.get(b.itemId) ?? 999));
}

/** A completed item can be put back for a short while, in case it was tapped by mistake. */
export const UNDO_MINUTES = 10;
export const canUndo = (completedAt: number | undefined, now: number) => !!completedAt && now - completedAt <= UNDO_MINUTES * 60_000;
