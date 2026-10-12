import { downSince, openFaults, serviceState, sinceText, type Equipment, type EquipmentEvent } from "@/lib/domain/equipment";
import { dayMonthYear } from "@/lib/domain/time";

export interface ItemStatus { level: "down" | "attention" | "ok"; text: string; chip: string; open: number }

/** One line on how a piece of kit is: not working (and for how long), needs attention, or fine. */
export function itemStatus(events: EquipmentEvent[], now: number): ItemStatus {
  const open = openFaults(events);
  const since = downSince(events);
  if (since !== undefined) return { level: "down", text: `Not working · ${sinceText(since, now)}`, chip: "bad", open: open.length };
  if (open.length) return { level: "attention", text: open.length > 1 ? `${open.length} problems reported` : "Needs attention", chip: "warn", open: open.length };
  return { level: "ok", text: "Working", chip: "done", open: 0 };
}

/** For managers: when the next service is due. */
export function serviceText(eq: Pick<Equipment, "serviceEveryMonths">, events: EquipmentEvent[], today: string): { text: string; chip: string } {
  const s = serviceState(eq, events, today);
  switch (s.status) {
    case "none": return { text: "No regular service", chip: "" };
    case "unknown": return { text: "Last service not recorded", chip: "late" };
    case "ok": return { text: `Next service ${dayMonthYear(s.due!)}`, chip: "" };
    case "soon": return { text: `Service due ${dayMonthYear(s.due!)}`, chip: "warn" };
    case "overdue": return { text: `Service overdue since ${dayMonthYear(s.due!)}`, chip: "bad" };
  }
}

export const RANK = { down: 0, attention: 1, ok: 2 } as const;
