import { store } from "@/lib/data";
import type { Store } from "@/lib/data/store";
import { canCover, coverState, type CoverRequest, type CoverState } from "@/lib/domain/cover";
import { shiftStart } from "@/lib/domain/reminders";
import { addDays } from "@/lib/domain/time";
import type { Person } from "@/lib/domain/types";

/** Read-only helpers for shift cover. The rules are in src/lib/domain/cover.ts. */

/** Published shifts that could overlap a shift on this date: that day's and the night before's. */
async function shiftsAround(date: string, db: Store) {
  return (await Promise.all([addDays(date, -1), date].map((d) => db.shiftsOnDate(d)))).flat();
}

/** Everyone who could cover the request now: same site and section, not working then, not off. */
export async function coverCandidates(r: CoverRequest, db: Store = store()): Promise<Person[]> {
  const [people, shifts, off] = await Promise.all([db.people(), shiftsAround(r.date, db), db.timeOff({ from: r.date, to: r.date, statuses: ["approved"] })]);
  return people.filter((p) => canCover(p, r, shifts.filter((s) => s.personId === p.id), off.filter((t) => t.personId === p.id)).ok);
}

/** Whether one person can cover the request now. */
export async function canCoverNow(p: Person, r: CoverRequest, db: Store = store()) {
  const [shifts, off] = await Promise.all([db.shiftsForPerson(p.id, addDays(r.date, -1), r.date), db.timeOff({ personId: p.id, from: r.date, to: r.date, statuses: ["approved"] })]);
  return canCover(p, r, shifts.filter((s) => s.published && !s.cancelled), off);
}

/** Each request with where it stands (approved ones become "done" once the rota shows the shift moved). */
export async function withStates(requests: CoverRequest[], now = Date.now(), db: Store = store()): Promise<(CoverRequest & { state: CoverState })[]> {
  return Promise.all(requests.map(async (r) => {
    const coverers = r.status === "approved" && r.coveredBy ? (await db.shiftsForPerson(r.coveredBy, addDays(r.date, -1), r.date)).filter((s) => !s.cancelled && s.siteId === r.siteId) : [];
    return { ...r, state: coverState(r, coverers, now) };
  }));
}

/** Requests at the person's sites that they could still offer on (or already have). */
export async function couldCover(p: Person, now = Date.now(), db: Store = store()): Promise<CoverRequest[]> {
  const sites = p.access.map((a) => a.siteId);
  if (!sites.length) return [];
  const open = (await db.coverRequests({ siteIds: sites, live: true })).filter((r) => r.status === "open" && r.personId !== p.id && now < shiftStart(r));
  if (!open.length) return [];
  const dates = open.map((r) => r.date).sort();
  const [shifts, off] = await Promise.all([
    db.shiftsForPerson(p.id, addDays(dates[0], -1), dates[dates.length - 1]),
    db.timeOff({ personId: p.id, from: dates[0], to: dates[dates.length - 1], statuses: ["approved"] }),
  ]);
  const mine = shifts.filter((s) => s.published && !s.cancelled);
  return open.filter((r) => r.offers.some((o) => o.personId === p.id && !o.withdrawnAt) || canCover(p, r, mine, off).ok);
}
