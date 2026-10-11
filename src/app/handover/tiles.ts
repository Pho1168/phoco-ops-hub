import type { HandoverItem, PrepEntryView } from "@/lib/data/store";
import { categoryLabel, type PrepItem } from "@/lib/domain/prep";
import type { Tile } from "./HandoverList";

const when = (t: number) => new Date(t).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

export function prepTile(e: PrepEntryView, items: Map<string, PrepItem>): Tile {
  const item = items.get(e.itemId);
  return {
    kind: "prep", id: e.id, title: item?.name ?? e.itemId, label: `Prep · ${categoryLabel(item?.category ?? "cooking")}`,
    urgent: e.urgent, carried: !!e.carriedFrom, detail: e.note, completedAt: e.completedAt, completedByName: e.completedByName,
  };
}

export function noteTile(n: HandoverItem): Tile {
  return {
    kind: "note", id: n.id, title: n.body, label: n.category, urgent: n.category === "Food safety" && n.needsAction,
    info: !n.needsAction, meta: `${n.createdByName} · ${when(n.createdAt)}`, completedAt: n.closedAt, completedByName: n.closedByName,
  };
}
