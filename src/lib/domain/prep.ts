import { isLead, managedSites } from "./access";
import type { Person, SiteAccess } from "./types";

/**
 * Kitchen handover list: things to do and things to prep. One master list is shared by every restaurant; each site
 * keeps its own handovers. Managers add and edit items (Manage → Handover list); the owner and operations managers
 * also take them off the list and put them back. Items are never deleted, so past handovers still point at them.
 *
 * Outgoing shift: tap only the items that are Needed (saved as a draft as they go), then submit with
 * "everything else is stocked", which records that the rest was checked. Incoming shift: one report of
 * what's outstanding; tapping an item marks it done and it leaves the outstanding list, but the record stays.
 * Anything still outstanding when the next handover is submitted carries over into it, and the manager is alerted.
 */

export type PrepKind = "todo" | "prep";
export type PrepShift = "next" | "tomorrow_am" | "tomorrow_pm";
export type PrepStatus = "outstanding" | "completed" | "carried";

/** The two lists, in the order they show: things to do, then things to prep. */
export const PREP_KINDS: { id: PrepKind; label: string }[] = [
  { id: "todo", label: "To do" },
  { id: "prep", label: "To prep" },
];
export const kindLabel = (k: PrepKind) => PREP_KINDS.find((x) => x.id === k)?.label ?? k;

/** The groups the original list was seeded with (prep_items.category, kept for history). */
export type PrepCategory = "cooking" | "fresh" | "sauces" | "defrost" | "drinks";
export const PREP_CATEGORIES: { id: PrepCategory; label: string }[] = [
  { id: "cooking", label: "Cooking & kitchen prep" },
  { id: "fresh", label: "Fresh prep & vegetables" },
  { id: "sauces", label: "Sauces & condiments" },
  { id: "defrost", label: "Defrosting & replenishment" },
  { id: "drinks", label: "Drinks & desserts" },
];
export const categoryLabel = (c: PrepCategory) => PREP_CATEGORIES.find((x) => x.id === c)?.label ?? c;

export const PREP_SHIFTS: { id: PrepShift; label: string }[] = [
  { id: "next", label: "Next shift" },
  { id: "tomorrow_am", label: "Tomorrow morning" },
  { id: "tomorrow_pm", label: "Tomorrow evening" },
];

export const shiftLabel = (s: PrepShift) => PREP_SHIFTS.find((x) => x.id === s)?.label ?? s;

/** One thing on the master list. Groups show in the order of their first item; items by position within a group. */
export interface PrepItem { id: string; name: string; kind: PrepKind; group: string; position: number; active: boolean;
  /** The prep recipe in the library it's made from, if a manager has linked one (`/library/<id>`). */
  recipeId?: string }

/** A recipe can be linked to a handover item when it's a published, live prep recipe. */
export function canLinkRecipe(doc: { kind: string; retiredAt?: number; published?: unknown } | undefined): { ok: true } | { ok: false; error: string } {
  if (!doc) return { ok: false, error: "That recipe isn't in the library" };
  if (doc.kind !== "prep") return { ok: false, error: "Only a prep recipe can be linked: a dish spec isn't a recipe sheet" };
  if (doc.retiredAt) return { ok: false, error: "That recipe has been retired" };
  if (!doc.published) return { ok: false, error: "That recipe isn't approved yet" };
  return { ok: true };
}

/**
 * The list the database was first seeded with (63 items, all to prep): supabase/migrations/0006_kitchen_prep.sql has
 * the same, and a test keeps the two in step. It's edited in the app since; ids are never reused or renumbered.
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

/**
 * The bar and counter jobs that were the "Bar & Counter Prep" checklist (retired), added to the list as their own
 * group by migration 0024 (a test keeps the two in step).
 */
export const BAR_ITEMS: [id: string, name: string, kind: PrepKind][] = [
  ["kp-064", "Cut limes into wedges", "prep"],
  ["kp-065", "Cut coriander stalks to length", "prep"],
  ["kp-066", "Slice cucumber", "prep"],
  ["kp-067", "Slice chillies", "prep"],
  ["kp-068", "Shred spring onions finely", "prep"],
  ["kp-069", "Pick coriander leaves", "prep"],
  ["kp-070", "Pick mint leaves", "prep"],
  ["kp-071", "Cut romaine to size", "prep"],
  ["kp-072", "Portion bun", "prep"],
  ["kp-073", "Slice lemons", "prep"],
  ["kp-074", "Break ice", "prep"],
  ["kp-075", "Check sweet chilli onions", "todo"],
  ["kp-076", "Restock packaging", "todo"],
  ["kp-077", "Restock drinks", "todo"],
  ["kp-078", "Check banh mi stock", "todo"],
  ["kp-079", "Check house mayo", "todo"],
  ["kp-080", "Restock pickle", "todo"],
  ["kp-081", "Restock pate", "todo"],
  ["kp-082", "Restock sauces", "todo"],
  ["kp-083", "Refill and freeze water containers", "todo"],
  ["kp-084", "Check mix jugs", "todo"],
  ["kp-085", "Restock che", "todo"],
];
export const BAR_GROUP = "Bar & counter";

/** The list as it is after migration 0024 (the demo starts from it). */
export const masterItems = (): PrepItem[] => [
  ...PREP_MASTER.map(([id, name, category], i): PrepItem => ({ id, name, kind: "prep", group: categoryLabel(category), position: i + 1, active: true })),
  ...BAR_ITEMS.map(([id, name, kind], i): PrepItem => ({ id, name, kind, group: BAR_GROUP, position: PREP_MASTER.length + i + 1, active: true })),
];

// ---------- the master list ----------

/** Managers (and the owner and operations managers) add and edit items; there's one list for every site. */
export const canEditPrepList = (p: Pick<Person, "access">) => managedSites(p).length > 0;
/** Only the owner and operations managers take an item off the list, or put one back. */
export const canRetirePrepItem = (p: Pick<Person, "access">) => isLead(p);

export const PREP_NAME_MAX = 80;
export const PREP_GROUP_MAX = 40;

/** A new or changed item, tidied and checked. Names are unique on each list (ignoring case), among items in use. */
export function cleanPrepItem(input: { name: string; kind: string; group: string }, items: PrepItem[], id?: string):
  { ok: true; value: { name: string; kind: PrepKind; group: string } } | { ok: false; error: string } {
  const name = input.name.trim().replace(/\s+/g, " "), group = input.group.trim().replace(/\s+/g, " ");
  if (!PREP_KINDS.some((k) => k.id === input.kind)) return { ok: false, error: "Choose To do or To prep" };
  const kind = input.kind as PrepKind;
  if (!name) return { ok: false, error: "Write what it is" };
  if (name.length > PREP_NAME_MAX) return { ok: false, error: `Keep it under ${PREP_NAME_MAX} characters` };
  if (!group) return { ok: false, error: "Choose a group, or type a new one" };
  if (group.length > PREP_GROUP_MAX) return { ok: false, error: `Keep the group under ${PREP_GROUP_MAX} characters` };
  const same = items.find((i) => i.id !== id && i.active && i.kind === kind && i.name.toLowerCase() === name.toLowerCase());
  if (same) return { ok: false, error: `"${same.name}" is already on the ${kindLabel(kind)} list` };
  // An existing group keeps its spelling.
  const known = items.find((i) => i.kind === kind && i.group.toLowerCase() === group.toLowerCase());
  return { ok: true, value: { name, kind, group: known?.group ?? group } };
}

/** The groups on each list, in order: to do first, then to prep, each group where its first item is. */
export function prepGroups(items: PrepItem[]): { kind: PrepKind; group: string }[] {
  const seen = new Map<string, { kind: PrepKind; group: string; first: number }>();
  for (const i of items) {
    const k = `${i.kind}|${i.group}`;
    const g = seen.get(k);
    if (!g || i.position < g.first) seen.set(k, { kind: i.kind, group: i.group, first: i.position });
  }
  const kindOrder = (k: PrepKind) => PREP_KINDS.findIndex((x) => x.id === k);
  return Array.from(seen.values()).sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind) || a.first - b.first).map(({ kind, group }) => ({ kind, group }));
}

/** The item a move swaps places with: the one before or after it in its group (in use), if any. */
export function moveTarget(items: PrepItem[], id: string, dir: "up" | "down"): PrepItem | undefined {
  const it = items.find((i) => i.id === id);
  if (!it) return undefined;
  const group = items.filter((i) => i.kind === it.kind && i.group === it.group && i.active).sort((a, b) => a.position - b.position);
  const at = group.findIndex((i) => i.id === id);
  return at < 0 ? undefined : group[dir === "up" ? at - 1 : at + 1];
}

/**
 * Everyone working at the site uses the prep board, front and back of house alike: the teams are small and
 * help each other. (Whether the board is on at all is per site, in prep_sites.)
 */
export function canUsePrep(access: SiteAccess | undefined): boolean {
  return !!access;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Active items in a group (`"kind|group"`, or "all" for every one) whose name contains every word typed, in list order:
 * to do first, then to prep, groups in order, items by position.
 */
export function filterPrep(items: PrepItem[], filter: string, query: string): PrepItem[] {
  const words = fold(query).split(/[^a-z0-9]+/).filter(Boolean);
  const order = new Map(prepGroups(items).map((g, n) => [`${g.kind}|${g.group}`, n]));
  return items
    .filter((i) => i.active && (filter === "all" || `${i.kind}|${i.group}` === filter))
    .filter((i) => { const n = fold(i.name); return words.every((w) => n.includes(w)); })
    .sort((a, b) => (order.get(`${a.kind}|${a.group}`) ?? 0) - (order.get(`${b.kind}|${b.group}`) ?? 0) || a.position - b.position);
}

export interface PrepEntry {
  id: string; handoverId: string; siteId: string; itemId: string; status: PrepStatus;
  urgent: boolean; note?: string; carriedFrom?: string;
  createdBy: string; createdAt: number; completedBy?: string; completedAt?: number;
  /** Who it's for (rules in assign.ts), and who last changed that and when. Carried into a newer handover, it's for nobody in particular. */
  assignedTo?: string; assignedBy?: string; assignedAt?: number;
}

/** Who a carried item is for, and who said so when: it stays with them (assign.ts). */
export type CarriedFor = Pick<PrepEntry, "assignedTo" | "assignedBy" | "assignedAt">;

export interface SubmitPlan {
  /** Outstanding items from earlier handovers that weren't picked again: added to the new handover. */
  carryIn: ({ itemId: string; from: string; urgent: boolean; note?: string } & CarriedFor)[];
  /** Outstanding items that were also picked again: the draft entry is linked to the old one instead of duplicated. */
  merge: ({ entryId: string; from: string; urgent: boolean; note?: string } & CarriedFor)[];
  /** Old entries that now live on in the new handover. */
  markCarried: string[];
  /** Items that were still outstanding when this handover was submitted, i.e. their shift ended without them. */
  missed: PrepEntry[];
  /** Active items not needed, which the outgoing shift confirms are stocked by submitting. */
  stockedCount: number;
}

/**
 * Submitting a draft. Nothing outstanding is lost: it moves into the new handover once, never twice,
 * keeping the urgent flag, the note and who it's for. The old entry is kept as "carried" so the history shows the hand-on.
 */
export function planSubmit(draft: PrepEntry[], outstanding: PrepEntry[], activeItemIds: string[]): SubmitPlan {
  const byItem = new Map(draft.map((e) => [e.itemId, e]));
  const plan: SubmitPlan = { carryIn: [], merge: [], markCarried: [], missed: [], stockedCount: 0 };
  const seen = new Set<string>();
  const forOf = (e: PrepEntry): CarriedFor => (e.assignedBy ? { assignedTo: e.assignedTo, assignedBy: e.assignedBy, assignedAt: e.assignedAt } : {});
  for (const old of [...outstanding].sort((a, b) => b.createdAt - a.createdAt)) {
    plan.markCarried.push(old.id);
    plan.missed.push(old);
    if (seen.has(old.itemId)) continue; // already carried from a newer handover
    seen.add(old.itemId);
    const mine = byItem.get(old.itemId);
    // Picked again (it was done, then put back): it stays with whoever the waiting item is for, as the review step shows.
    if (mine) plan.merge.push({ entryId: mine.id, from: old.id, urgent: mine.urgent || old.urgent, note: mine.note || old.note, ...forOf(old) });
    else plan.carryIn.push({ itemId: old.itemId, from: old.id, urgent: old.urgent, note: old.note, ...forOf(old) });
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
