import { store } from "@/lib/data";
import type { Store } from "@/lib/data/store";
import { canCover, coverState, pendingCovers, type Checked, type CoverRequest } from "@/lib/domain/cover";
import type { ShiftTimes } from "@/lib/domain/reminders";
import { addDays } from "@/lib/domain/time";
import type { Person } from "@/lib/domain/types";

/** Read-only helpers for shift cover. The rules are in src/lib/domain/cover.ts. */

/** Approved covers still waiting for the rota, by who's covering: they count as busy then. */
async function pending(now: number, db: Store): Promise<Map<string, ShiftTimes[]>> {
  return pendingCovers((await db.coverRequests({ live: true, shiftEndsAfter: now })).filter((r) => r.status === "approved"), now);
}

/** Published shifts that could overlap a shift on this date: the day before, the day and the day after (overnight shifts). */
async function shiftsAround(date: string, db: Store) {
  return (await Promise.all([addDays(date, -1), date, addDays(date, 1)].map((d) => db.shiftsOnDate(d)))).flat();
}

/** Everyone who could cover the request now: same site and section, not working or covering then, not off. */
export async function coverCandidates(r: CoverRequest, now = Date.now(), db: Store = store()): Promise<Person[]> {
  const [people, shifts, off, covers] = await Promise.all([
    db.people(), shiftsAround(r.date, db), db.timeOff({ from: r.date, to: r.date, statuses: ["approved"] }), pending(now, db),
  ]);
  return people.filter((p) => canCover(p, r, [...shifts.filter((s) => s.personId === p.id), ...(covers.get(p.id) ?? [])], off.filter((t) => t.personId === p.id)).ok);
}

/** Whether one person can cover the request now. `name` words the reason for a manager. */
export async function canCoverNow(p: Person, r: CoverRequest, now = Date.now(), db: Store = store(), name?: string): Promise<Checked> {
  const [shifts, off, covers] = await Promise.all([
    db.shiftsForPerson(p.id, addDays(r.date, -1), addDays(r.date, 1)),
    db.timeOff({ personId: p.id, from: r.date, to: r.date, statuses: ["approved"] }),
    pending(now, db),
  ]);
  return canCover(p, r, [...shifts.filter((s) => s.published && !s.cancelled), ...(covers.get(p.id) ?? [])], off, name);
}

/** Open requests at the person's sites that they could still offer on, or already have. */
export async function couldCover(p: Person, now = Date.now(), db: Store = store()): Promise<CoverRequest[]> {
  const sites = p.access.map((a) => a.siteId);
  if (!sites.length || p.status !== "active") return [];
  const live = await db.coverRequests({ siteIds: sites, live: true, shiftEndsAfter: now });
  const open = live.filter((r) => r.personId !== p.id && coverState(r, now) === "open");
  if (!open.length) return [];
  const dates = open.map((r) => r.date).sort();
  const [shifts, off] = await Promise.all([
    db.shiftsForPerson(p.id, addDays(dates[0], -1), addDays(dates[dates.length - 1], 1)),
    db.timeOff({ personId: p.id, from: dates[0], to: dates[dates.length - 1], statuses: ["approved"] }),
  ]);
  const busy = [...shifts.filter((s) => s.published && !s.cancelled), ...(pendingCovers(live, now).get(p.id) ?? [])];
  return open.filter((r) => r.offers.some((o) => o.personId === p.id && !o.withdrawnAt) || canCover(p, r, busy, off).ok);
}
