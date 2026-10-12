import { store } from "@/lib/data";
import type { Store } from "@/lib/data/store";
import { datesBetween, readingLog, signoffLog } from "@/lib/domain/records";
import { siteWeekReport, type SiteWeekReport } from "@/lib/domain/report";
import { faultsOf } from "@/lib/domain/equipment";
import { addDays, londonDate, londonToUtc } from "@/lib/domain/time";
import type { Site } from "@/lib/domain/types";

export interface SiteReport { site: Site; week: SiteWeekReport; last: SiteWeekReport; people: string[] }

/** This week's and last week's report for one site. */
export async function loadSiteReport(site: Site, week: string, now = Date.now(), db: Store = store()): Promise<SiteReport> {
  const today = londonDate(now);
  const lastWeek = addDays(week, -7);
  const to = addDays(week, 6) < today ? addDays(week, 6) : today;
  const [data, notes, prepOn, shifts, lastShifts, kit, kitEvents] = await Promise.all([
    db.recordsData(site.id, lastWeek, to < lastWeek ? lastWeek : to),
    db.handover(site.id, londonToUtc(lastWeek, "00:00")),
    db.prepEnabledSites().then((s) => s.includes(site.id)),
    db.teamShifts(site.id, week),
    db.teamShifts(site.id, lastWeek),
    db.equipment(site.id, true),
    db.equipmentEvents({ siteId: site.id }),
  ]);
  const kitById = new Map(kit.map((e) => [e.id, e]));
  // Kit taken off the register ends any problem still open on it.
  const faults = faultsOf(kitEvents).map((f) => {
    const eq = kitById.get(f.fault.equipmentId);
    return { equipment: eq?.name ?? "Equipment", severity: f.fault.severity!, createdAt: f.fault.createdAt, fixedAt: f.fixed?.createdAt ?? eq?.retiredAt };
  });
  const prep = prepOn ? await db.prepHandovers(site.id, 60) : [];
  const readings = readingLog(data.answers);

  const one = (start: string, weekShifts: typeof shifts): SiteWeekReport => {
    const end = addDays(start, 6);
    const from = londonToUtc(start, "00:00"), until = londonToUtc(addDays(start, 7), "00:00");
    const lastDay = end < today ? end : today;
    return siteWeekReport({
      week: start, now, trackingFrom: data.trackingFrom,
      readings: readings.filter((r) => r.date >= start && r.date <= end),
      signoffs: start > today ? [] : signoffLog(data.lists, data.runs, datesBetween(start, lastDay), now, data.trackingFrom),
      alerts: data.alerts.filter((a) => a.createdAt >= from && a.createdAt < until),
      notes: notes.filter((n) => n.createdAt >= from && n.createdAt < until),
      prep: prep.filter((h) => h.submittedAt && h.submittedAt >= from && h.submittedAt < until).map((h) => ({ submittedAt: h.submittedAt!, entries: h.entries })),
      shifts: weekShifts,
      faults: faults.filter((f) => f.createdAt < until),
    });
  };
  return { site, week: one(week, shifts), last: one(lastWeek, lastShifts), people: Array.from(new Set(shifts.map((s) => s.personId))) };
}
