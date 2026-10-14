import type { HandoverItem, PrepEntryView } from "@/lib/data/store";
import { entryCanBeFor, noteCanBeFor } from "@/lib/domain/assign";
import { kindLabel, type PrepItem } from "@/lib/domain/prep";
import type { Tile } from "./HandoverList";

const when = (t: number) => new Date(t).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

/**
 * Who it's for and who said so when (shown only while it names someone), and when that last changed (`forAt`).
 * `here`: who can be given things at the site now; anyone else is marked as no longer here (it counts as for anyone).
 */
const forFields = (x: { assignedTo?: string; assignedToName?: string; assignedByName?: string; assignedAt?: number }, here?: Set<string>) => ({
  forAt: x.assignedAt,
  ...(x.assignedTo ? {
    forId: x.assignedTo, forName: x.assignedToName || "someone", forGone: here ? !here.has(x.assignedTo) : undefined,
    forBy: x.assignedAt ? `by ${x.assignedByName || "someone"}, ${when(x.assignedAt)}` : undefined,
  } : {}),
});

/** `recipes`: the recipe sheets this reader can open (published prep recipes, on the full app); absent on a phone. */
export function prepTile(e: PrepEntryView, items: Map<string, PrepItem>, here?: Set<string>, recipes?: Set<string>): Tile {
  const item = items.get(e.itemId);
  const recipe = item?.recipeId && recipes?.has(item.recipeId) ? { href: `/library/${item.recipeId}`, label: "Recipe" } : undefined;
  return {
    kind: "prep", id: e.id, title: item?.name ?? e.itemId, label: item ? `${kindLabel(item.kind)} · ${item.group}` : "To prep",
    urgent: e.urgent, carried: !!e.carriedFrom, detail: e.note, completedAt: e.completedAt, completedByName: e.completedByName,
    assignable: entryCanBeFor(e), ...forFields(e, here), link: recipe,
  };
}

export function noteTile(n: HandoverItem, here?: Set<string>): Tile {
  return {
    kind: "note", id: n.id, title: n.body, label: n.category, urgent: n.category === "Food safety" && n.needsAction,
    info: !n.needsAction, meta: `${n.createdByName} · ${when(n.createdAt)}`, completedAt: n.closedAt, completedByName: n.closedByName,
    assignable: noteCanBeFor(n), ...forFields(n, here),
  };
}
