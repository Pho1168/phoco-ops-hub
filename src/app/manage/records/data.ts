import { store } from "@/lib/data";
import { datesBetween, readingLog, recordsSummary, signoffLog } from "@/lib/domain/records";
import { addDays, londonToUtc } from "@/lib/domain/time";
import type { SiteId } from "@/lib/domain/types";

/** Everything the inspection records page and its CSV download show, for one site and date range. */
export async function loadRecords(siteId: SiteId, from: string, to: string, now = Date.now()) {
  const db = store();
  const [data, rules, notes] = await Promise.all([
    db.recordsData(siteId, from, to), db.rules(), db.handover(siteId, londonToUtc(from, "00:00")),
  ]);
  const end = londonToUtc(addDays(to, 1), "00:00");
  const readings = readingLog(data.answers);
  const signoffs = signoffLog(data.lists, data.runs, datesBetween(from, to), now, data.trackingFrom);
  const foodSafety = notes.filter((n) => n.category === "Food safety" && n.createdAt < end).sort((a, b) => a.createdAt - b.createdAt);
  return { readings, signoffs, alerts: data.alerts, foodSafety, rules, trackingFrom: data.trackingFrom, summary: recordsSummary(readings, signoffs) };
}
