import { store } from "@/lib/data";
import type { Alert, Store } from "@/lib/data/store";
import { gasDay, gasExpected, gasState, lastCloseDay, openGasDay, readyToOpen, type DayFacts, type GasCheck, type GasDay, type GasState, type Ready, type ReadyInput } from "@/lib/domain/daily";
import { faultsOf, keepsFoodSafe, type Equipment, type EquipmentEvent } from "@/lib/domain/equipment";
import { datesBetween, readingLog, signoffLog } from "@/lib/domain/records";
import { latestReplies } from "@/lib/domain/reminders";
import { addDays, londonDate, londonToUtc } from "@/lib/domain/time";
import type { Person, Site, SiteId } from "@/lib/domain/types";

/**
 * Read-only: gathers what the daily loop's rules need. The rules themselves are in src/lib/domain/daily.ts.
 * Pages pass in what they've already loaded (`Known`), so nothing is fetched twice.
 */

export type DayShift = Awaited<ReturnType<Store["shiftsOnDate"]>>[number];
export interface Known {
  /** Published shifts on the days asked about (from shiftsAround). */
  shifts?: DayShift[];
  /** Today's checklists with whether each is signed. */
  lists?: ReadyInput["lists"];
  kit?: Equipment[];
  /** Open faults at the site (equipmentEvents with openFaultsOnly). */
  openFaults?: EquipmentEvent[];
  /** The site's unresolved alerts. */
  alerts?: Alert[];
  people?: Person[];
}

/** Published shifts for the day before yesterday, yesterday and today, at every site: load once, pass to the rest. */
export async function shiftsAround(now = Date.now(), db: Store = store()): Promise<DayShift[]> {
  const today = londonDate(now);
  return (await Promise.all([addDays(today, -2), addDays(today, -1), today].map((d) => db.shiftsOnDate(d)))).flat();
}

async function siteShifts(siteId: SiteId, dates: string[], db: Store, known?: DayShift[]): Promise<DayShift[]> {
  const all = known ?? (await Promise.all(dates.map((d) => db.shiftsOnDate(d)))).flat();
  return all.filter((s) => s.siteId === siteId && dates.includes(s.date));
}

/**
 * Ready to open, for today. Undefined when the site has no ready time, hasn't started using checklists in the app
 * (like the records, they count from the first one recorded), or nobody on the published rota starts by then (a shut
 * day, or an evening-only one). `forStaff` leaves out who's late or not coming (managers only see that); `asOf`
 * judges kit, alerts and replies as they were then.
 */
export async function readyFor(site: Site, now = Date.now(), db: Store = store(), known: Known = {}, opts: { forStaff?: boolean; asOf?: number } = {}): Promise<Ready | undefined> {
  if (!site.readyBy || site.status !== "open") return undefined;
  const today = londonDate(now);
  const opening = (await siteShifts(site.id, [today], db, known.shifts)).filter((s) => s.start <= site.readyBy!);
  if (!opening.length || !(await db.checklistsStartedOn(site.id))) return undefined;
  const [kit, open, alerts, people, replies] = await Promise.all([
    known.kit ?? db.equipment(site.id),
    known.openFaults ?? db.equipmentEvents({ siteId: site.id, openFaultsOnly: true }),
    known.alerts ?? db.alerts(site.id),
    opts.forStaff ? [] : known.people ?? db.people(),
    opts.forStaff ? [] : db.shiftReplies(opening.map((s) => s.id)),
  ]);
  let lists = known.lists;
  if (!lists) {
    const all = await db.checklists(site.id);
    const runs = await Promise.all(all.map((l) => db.run(l.id, today)));
    lists = all.map((l, i) => ({ name: l.name, due: l.due, signed: !!runs[i].signedAt }));
  }
  const latest = latestReplies(replies);
  const names = new Map(people.map((p) => [p.id, p.name]));
  return readyToOpen({
    date: today, readyBy: site.readyBy, now, asOf: opts.asOf, lists,
    kitDown: kit.flatMap((eq) => {
      const down = faultsOf(open.filter((e) => e.equipmentId === eq.id)).filter((f) => !f.fixed && f.fault.severity === "down");
      return down.length ? [{ name: eq.name, foodSafety: keepsFoodSafe(eq.kind), since: Math.min(...down.map((f) => f.fault.createdAt)) }] : [];
    }),
    alerts: alerts.filter((a) => !a.resolvedAt && a.siteId === site.id).map((a) => ({ title: a.title, critical: a.level === "critical", createdAt: a.createdAt })),
    team: opts.forStaff ? [] : opening.map((s) => ({ name: names.get(s.personId) ?? s.staffCode, start: s.start, reply: latest.get(s.id) })),
  });
}

export interface GasNow { day: GasDay; state: GasState; check?: GasCheck }

/**
 * The site's gas check that's open now (today's, or last night's after midnight), with its state. Undefined outside
 * the window. People who said they can't make the closing shift aren't counted as closers.
 */
export async function gasFor(site: Pick<Site, "id" | "status">, now = Date.now(), db: Store = store(), known: Pick<Known, "shifts"> = {}): Promise<GasNow | undefined> {
  if (site.status !== "open") return undefined;
  const today = londonDate(now), yesterday = addDays(today, -1);
  const shifts = await siteShifts(site.id, [yesterday, today], db, known.shifts);
  const open = openGasDay([gasDay(site.id, today, shifts), gasDay(site.id, yesterday, shifts)], now);
  if (!open) return undefined;
  const [replies, [check]] = await Promise.all([
    db.shiftReplies(shifts.filter((s) => s.date === open.date).map((s) => s.id)),
    db.gasChecks([site.id], open.date, open.date),
  ]);
  const absent = new Set(Array.from(latestReplies(replies).values()).filter((r) => r.kind === "cant_make_it").map((r) => r.shiftId));
  const day = gasDay(site.id, open.date, shifts, absent)!;
  return { day, state: gasState(day, check?.createdAt, now), check };
}

/** The site's last close whose gas check window is over, and whether the check was done. Undefined if there's none in the last 3 days. */
export async function lastClose(site: Pick<Site, "id">, now = Date.now(), db: Store = store(), known: Pick<Known, "shifts"> = {}): Promise<{ date: string; check?: GasCheck } | undefined> {
  const today = londonDate(now);
  const dates = [addDays(today, -2), addDays(today, -1), today];
  const shifts = await siteShifts(site.id, dates, db, known.shifts);
  const day = lastCloseDay(dates.map((d) => gasDay(site.id, d, shifts)), now);
  if (!day) return undefined;
  const [check] = await db.gasChecks([site.id], day.date, day.date);
  return { date: day.date, check };
}

/** The facts for one site's day, for the 08:00 summary. */
export async function dayFacts(site: Site, date: string, now = Date.now(), db: Store = store()): Promise<DayFacts> {
  const from = londonToUtc(date, "00:00"), until = londonToUtc(addDays(date, 1), "00:00");
  const [data, notes, kit, kitEvents, tasks, gas, shifts] = await Promise.all([
    db.recordsData(site.id, date, date),
    db.handover(site.id, from),
    db.equipment(site.id, true),
    db.equipmentEvents({ siteId: site.id }),
    db.tasks({ siteIds: [site.id] }),
    db.gasChecks([site.id], date, date),
    siteShifts(site.id, [date], db),
  ]);
  const replies = latestReplies(await db.shiftReplies(shifts.map((s) => s.id)));
  // Checks only count on a day the site was open: on the rota, or someone started a checklist. A shut day isn't "missed".
  const open = shifts.length > 0 || data.runs.some((r) => r.date === date && (r.answered > 0 || r.signedAt));
  const signoffs = open ? signoffLog(data.lists, data.runs, datesBetween(date, date), now, data.trackingFrom).filter((r) => r.status !== "open") : [];
  const kitById = new Map(kit.map((e) => [e.id, e]));
  const faults = faultsOf(kitEvents);
  const [g] = gas;
  return {
    siteName: site.name,
    onRota: shifts.length > 0,
    gasExpected: gasExpected(date, shifts.length > 0),
    checks: { expected: signoffs.length, signed: signoffs.filter((r) => r.status !== "not_signed").length, missed: signoffs.filter((r) => r.status === "not_signed").map((r) => r.listName) },
    outOfRange: readingLog(data.answers).filter((r) => r.date === date && (r.outcome === "warn" || r.outcome === "bad")).length,
    alertsRaised: data.alerts.filter((a) => a.createdAt >= from && a.createdAt < until).length,
    faults: {
      reported: faults.filter((f) => f.fault.createdAt >= from && f.fault.createdAt < until).length,
      fixed: faults.filter((f) => f.fixed && f.fixed.createdAt >= from && f.fixed.createdAt < until).length,
      stillDown: faults.filter((f) => !f.fixed && f.fault.severity === "down" && !kitById.get(f.fault.equipmentId)?.retiredAt)
        .map((f) => kitById.get(f.fault.equipmentId)?.name ?? "Equipment"),
    },
    notesLeft: notes.filter((n) => n.createdAt >= from && n.createdAt < until).length,
    tasksOverdue: tasks.filter((t) => t.status === "open" && t.dueOn && t.dueOn < londonDate(now)).length,
    gas: g ? { byName: g.personName, at: g.createdAt, onTablet: g.onTablet } : undefined,
    late: Array.from(replies.values()).filter((r) => r.kind === "late").length,
    cantMakeIt: Array.from(replies.values()).filter((r) => r.kind === "cant_make_it").length,
  };
}
