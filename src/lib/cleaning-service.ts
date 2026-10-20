import type { Store } from "@/lib/data/store";
import { canManage } from "@/lib/domain/access";
import { AREA_LABEL, cleaningBoard, howOften, missedJobs, missedMessage, periodStart, previousPeriod, statusLine, type CleaningJob, type JobView } from "@/lib/domain/cleaning";
import { afterQuietHours } from "@/lib/domain/time";
import type { SiteId } from "@/lib/domain/types";

/** Far enough back to see last month's "missed" (the earliest period any board looks at). */
const since = (now: number) => previousPeriod("month", periodStart("month", now)) < previousPeriod("week", periodStart("week", now))
  ? previousPeriod("month", periodStart("month", now)) : previousPeriod("week", periodStart("week", now));

/** Each site's cleaning board as it stands now (only sites with jobs). */
export async function cleaningBoards(db: Store, siteIds: SiteId[], now: number): Promise<Map<SiteId, JobView[]>> {
  const out = new Map<SiteId, JobView[]>();
  if (!siteIds.length) return out;
  const [jobs, events] = await Promise.all([db.cleaningJobs(siteIds), db.cleaningEvents(siteIds, since(now))]);
  for (const id of siteIds) {
    const board = cleaningBoard(jobs.filter((j) => j.siteId === id), events, now);
    if (board.length) out.set(id, board);
  }
  return out;
}

/**
 * Every run of `tick()`: jobs not done in the week or month just ended are marked missed (once each), and each open
 * site's managers (owners and ops too) get one message per site and period listing them.
 */
export async function queueCleaningMissed(now: number, db: Store): Promise<number> {
  const sites = (await db.sites()).filter((s) => s.status === "open");
  if (!sites.length) return 0;
  const ids = sites.map((s) => s.id);
  const [jobs, events] = await Promise.all([db.cleaningJobs(ids), db.cleaningEvents(ids, since(now))]);
  const marked: { job: CleaningJob; period: string; count: number }[] = [];
  for (const m of missedJobs(jobs, events, now)) {
    if (await db.cleaningMissed(m.job.id, m.period, `${m.count} of ${m.job.times} done`)) marked.push(m);
  }
  if (!marked.length) return 0;
  const people = (await db.people()).filter((p) => p.status === "active");
  let queued = 0;
  for (const site of sites) {
    for (const period of [...new Set(marked.filter((m) => m.job.siteId === site.id).map((m) => `${m.job.per}|${m.period}`))]) {
      const list = marked.filter((m) => m.job.siteId === site.id && `${m.job.per}|${m.period}` === period);
      const msg = missedMessage(site.name, list);
      for (const p of people.filter((x) => canManage(x, site.id))) {
        if (await db.queueNotice({ personId: p.id, kind: "cleaning", title: msg.title, body: msg.body, dedupeKey: `cleaning|${site.id}|${period}|${p.id}`, sendAfter: afterQuietHours(now), url: "/today" })) queued++;
      }
    }
  }
  return queued;
}

/** One line of the board, ready for the screen. */
export interface BoardRow {
  id: string; name: string; area: string; often: string; status: string;
  urgency: "ok" | "soon" | "late"; complete: boolean;
  /** Claimed by the person looking (they can let go). */
  mine: boolean;
  missedLast: boolean;
}
export function boardRows(board: JobView[], meId: string): BoardRow[] {
  return board.map((v) => ({
    id: v.job.id, name: v.job.name, area: AREA_LABEL[v.job.area], often: howOften(v.job), status: statusLine(v),
    urgency: v.urgency, complete: v.complete, mine: v.claimed?.personId === meId, missedLast: v.missedLast,
  }));
}
