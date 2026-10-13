import type { HandoverItem, PrepEntryView } from "@/lib/data/store";
import { categoryLabel, type PrepItem } from "@/lib/domain/prep";
import type { Tile } from "./HandoverList";

const when = (t: number) => new Date(t).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

/** Who it's for, and who said so when (only while it names someone). */
const forFields = (x: { assignedTo?: string; assignedToName?: string; assignedByName?: string; assignedAt?: number }) =>
  x.assignedTo ? { forId: x.assignedTo, forName: x.assignedToName || "someone", forBy: x.assignedAt ? `by ${x.assignedByName || "someone"}, ${when(x.assignedAt)}` : undefined } : {};

export function prepTile(e: PrepEntryView, items: Map<string, PrepItem>): Tile {
  const item = items.get(e.itemId);
  return {
    kind: "prep", id: e.id, title: item?.name ?? e.itemId, label: `Prep · ${categoryLabel(item?.category ?? "cooking")}`,
    urgent: e.urgent, carried: !!e.carriedFrom, detail: e.note, completedAt: e.completedAt, completedByName: e.completedByName,
    assignable: e.status === "outstanding", ...forFields(e),
  };
}

export function noteTile(n: HandoverItem): Tile {
  return {
    kind: "note", id: n.id, title: n.body, label: n.category, urgent: n.category === "Food safety" && n.needsAction,
    info: !n.needsAction, meta: `${n.createdByName} · ${when(n.createdAt)}`, completedAt: n.closedAt, completedByName: n.closedByName,
    assignable: n.needsAction && !n.closedAt, ...forFields(n),
  };
}
