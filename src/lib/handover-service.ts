import { store } from "@/lib/data";
import type { Store } from "@/lib/data/store";
import { canBeGiven, NEXT_SHIFT_DAYS, periodAt, pickList, type Period, type PickGroup } from "@/lib/domain/assign";
import { forYou, type ForYouItem } from "@/lib/domain/reminders";
import type { ShiftTimes } from "@/lib/domain/reminders";
import { addDays } from "@/lib/domain/time";
import type { Person, Site, SiteId } from "@/lib/domain/types";

export type RotaShift = ShiftTimes & { personId: string };

/**
 * The site's published rota from the day before `from` (a late shift still going) to far enough after `to` to find
 * the next shift after a few days shut. Read-only.
 */
export async function rotaAround(siteId: SiteId, from: number, to = from, db: Store = store()): Promise<RotaShift[]> {
  const shifts = await db.shiftsOnDate(addDays(periodAt(from).date, -1), addDays(periodAt(to).date, NEXT_SHIFT_DAYS + 1));
  return shifts.filter((s) => s.siteId === siteId).map((s) => ({ personId: s.personId, date: s.date, start: s.start, end: s.end }));
}

/** Everyone a handover item at the site can be given to. */
export function givablePeople(people: Person[], siteId: SiteId): { id: string; name: string }[] {
  return people.filter((p) => canBeGiven(p, siteId)).map((p) => ({ id: p.id, name: p.name }));
}

/** The pick list for a shift at the site. */
export function pickFor(site: Pick<Site, "id" | "name">, period: Period, rota: RotaShift[], people: Person[], now: number): PickGroup[] {
  return pickList(givablePeople(people, site.id), rota, period, site.name, now);
}

/**
 * What's been given to someone and is still to do, at each open site they work at (prep only where the board is on):
 * for My shifts. Phone rules apply (forYou): staff notes and complaint details stay on the tablet.
 */
export async function forYouAt(person: Pick<Person, "id" | "access">, sites: Site[], db: Store = store()): Promise<{ site: Site; items: ForYouItem[] }[]> {
  const mine = sites.filter((s) => s.status === "open" && person.access.some((a) => a.siteId === s.id));
  if (!mine.length) return [];
  const [prepOn, items] = await Promise.all([db.prepEnabledSites(), db.prepItems()]);
  const names = new Map(items.map((i) => [i.id, i.name]));
  const out = await Promise.all(mine.map(async (site) => {
    const [notes, prep] = await Promise.all([db.handover(site.id), prepOn.includes(site.id) ? db.prepOutstanding(site.id) : Promise.resolve([])]);
    const list = forYou(person.id, prep.map((e) => ({ name: names.get(e.itemId) ?? "Prep item", urgent: e.urgent, assignedTo: e.assignedTo })), notes);
    return { site, items: list };
  }));
  return out.filter((x) => x.items.length > 0);
}
