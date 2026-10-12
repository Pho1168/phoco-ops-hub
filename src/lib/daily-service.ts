import { store } from "@/lib/data";
import type { Store } from "@/lib/data/store";
import { gasDay, gasState, openGasDay, readyToOpen, type DayFacts, type GasCheck, type GasDay, type GasState, type Ready, type ReadyInput } from "@/lib/domain/daily";
import { faultsOf, keepsFoodSafe } from "@/lib/domain/equipment";
import { datesBetween, readingLog, signoffLog } from "@/lib/domain/records";
import { latestReplies } from "@/lib/domain/reminders";
import { addDays, londonDate, londonToUtc } from "@/lib/domain/time";
import type { Site, SiteId } from "@/lib/domain/types";

/** Read-only: gathers what the daily loop's rules need. The rules themselves are in src/lib/domain/daily.ts. */

/** The site's published shifts on these London dates. */
async function siteShiftsOn(siteId: SiteId, dates: string[], db: Store) {
  return (await Promise.all(dates.map((d) => db.shiftsOnDate(d)))).flat().filter((s) => s.siteId === siteId);
}

/**
 * Ready to open, for today. Undefined when the site has no ready time or nobody on the published rota today.
 * A page that has already loaded today's checklists passes them in (`lists`), saving a query per checklist.
 */
export async function readyFor(site: Site, now = Date.now(), db: Store = store(), lists?: ReadyInput["lists"]): Promise<Ready | undefined> {
  if (!site.readyBy || site.status !== "open") return undefined;
  const today = londonDate(now);
  const shifts = await siteShiftsOn(site.id, [today], db);
  if (!shifts.length) return undefined;
  const opening = shifts.filter((s) => s.start <= site.readyBy!);
  const [kit, open, alerts, people, replies] = await Promise.all([
    db.equipment(site.id), db.equipmentEvents({ siteId: site.id, openFaultsOnly: true }), db.alerts(site.id), db.people(),
    db.shiftReplies(opening.map((s) => s.id)),
  ]);
  if (!lists) {
    const all = await db.checklists(site.id);
    const runs = await Promise.all(all.map((l) => db.run(l.id, today)));
    lists = all.map((l, i) => ({ name: l.name, due: l.due, signed: !!runs[i].signedAt }));
  }
  const latest = latestReplies(replies);
  const names = new Map(people.map((p) => [p.id, p.name]));
  return readyToOpen({
    date: today, readyBy: site.readyBy, now,
    lists,
    kitDown: kit.filter((eq) => faultsOf(open.filter((e) => e.equipmentId === eq.id)).some((f) => f.fault.severity === "down"))
      .map((eq) => ({ name: eq.name, foodSafety: keepsFoodSafe(eq.kind) })),
    alerts: alerts.filter((a) => !a.resolvedAt).map((a) => ({ title: a.title, critical: a.level === "critical" })),
    team: opening.map((s) => ({ name: names.get(s.personId) ?? s.staffCode, start: s.start, reply: latest.get(s.id) })),
  });
}

export interface GasNow { day: GasDay; state: GasState; check?: GasCheck }

/** The site's gas check that's open now (today's, or last night's after midnight), with its state. Undefined outside the window. */
export async function gasFor(site: Pick<Site, "id" | "status">, now = Date.now(), db: Store = store()): Promise<GasNow | undefined> {
  if (site.status !== "open") return undefined;
  const today = londonDate(now), yesterday = addDays(today, -1);
  const shifts = await siteShiftsOn(site.id, [yesterday, today], db);
  const day = openGasDay([gasDay(site.id, today, shifts), gasDay(site.id, yesterday, shifts)], now);
  if (!day) return undefined;
  const [check] = await db.gasChecks([site.id], day.date, day.date);
  return { day, state: gasState(day, check?.createdAt, now), check };
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
    siteShiftsOn(site.id, [date], db),
  ]);
  const replies = latestReplies(await db.shiftReplies(shifts.map((s) => s.id)));
  const signoffs = signoffLog(data.lists, data.runs, datesBetween(date, date), now, data.trackingFrom).filter((r) => r.status !== "open");
  const kitById = new Map(kit.map((e) => [e.id, e]));
  const faults = faultsOf(kitEvents);
  const [g] = gas;
  return {
    siteName: site.name,
    onRota: shifts.length > 0,
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

/** The site's last close before today: whether the gas check was done. Undefined if it had no shifts yesterday. */
export async function lastClose(site: Pick<Site, "id">, now = Date.now(), db: Store = store()): Promise<{ date: string; check?: GasCheck } | undefined> {
  const yesterday = addDays(londonDate(now), -1);
  if (!(await siteShiftsOn(site.id, [yesterday], db)).length) return undefined;
  const [check] = await db.gasChecks([site.id], yesterday, yesterday);
  return { date: yesterday, check };
}
