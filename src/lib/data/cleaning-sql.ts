import { canAct, jobView, previousPeriod, periodStart, type CleaningEvent, type CleaningJob } from "@/lib/domain/cleaning";
import { sql, withTx } from "./pg";
import type { CleaningStore } from "./cleaning-store";

/** Postgres implementation of the cleaning board (migration 0040). */

interface JobRow { id: string; site_id: string; area: CleaningJob["area"]; name: string; per: CleaningJob["per"]; times: number; position: number; active: boolean; created_at: Date;
  every_months: number | null; first_due: Date | string | null }
const isoDay = (d: Date | string) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));
const toJob = (r: JobRow): CleaningJob => ({ id: r.id, siteId: r.site_id, area: r.area, name: r.name, per: r.per, times: r.times, position: r.position, active: r.active, createdAt: r.created_at.getTime(),
  ...(r.every_months ? { everyMonths: r.every_months } : {}), ...(r.first_due ? { firstDue: isoDay(r.first_due) } : {}) });
interface EventRow { id: string; job_id: string; period: string; kind: CleaningEvent["kind"]; person_id: string | null; person_name: string | null; note: string | null; at: Date }
const toEvent = (r: EventRow): CleaningEvent => ({ id: r.id, jobId: r.job_id, period: r.period, kind: r.kind, personId: r.person_id ?? undefined, personName: r.person_name ?? undefined, note: r.note ?? undefined, at: r.at.getTime() });

export const cleaningSql: CleaningStore = {
  async cleaningJobs(siteIds) {
    const q = sql();
    const rows = siteIds
      ? await q<JobRow[]>`select * from cleaning_jobs where site_id = any(${siteIds}) order by site_id, position, id`
      : await q<JobRow[]>`select * from cleaning_jobs order by site_id, position, id`;
    return rows.map(toJob);
  },
  async cleaningEvents(siteIds, sinceDate) {
    const q = sql();
    return (await q<EventRow[]>`select e.id, e.job_id, to_char(e.period, 'YYYY-MM-DD') as period, e.kind, e.person_id, p.display_name as person_name, e.note, e.at
      from cleaning_events e join cleaning_jobs j on j.id = e.job_id left join people p on p.id = e.person_id
      where j.site_id = any(${siteIds}) and e.period >= ${sinceDate} order by e.at, e.id`).map(toEvent);
  },
  async cleaningAct(jobId, action, personId, now) {
    return withTx(async (tx) => {
      const [j] = await tx<JobRow[]>`select * from cleaning_jobs where id = ${jobId} for update`;
      if (!j || !j.active) return { ok: false as const, error: "That job isn't on the board any more" };
      const job = toJob(j);
      // An "every" job looks back to when it was last done; the others only need this period and the one before.
      const since = job.per === "every" ? "2000-01-01" : previousPeriod(job.per, periodStart(job.per, now));
      const events = (await tx<EventRow[]>`select e.id, e.job_id, to_char(e.period, 'YYYY-MM-DD') as period, e.kind, e.person_id, p.display_name as person_name, e.note, e.at
        from cleaning_events e left join people p on p.id = e.person_id where e.job_id = ${jobId} and e.period >= ${since} order by e.at, e.id`).map(toEvent);
      const view = jobView(job, events, now);
      const ok = canAct(view, action, personId);
      if (!ok.ok) return ok;
      await tx`insert into cleaning_events (job_id, period, kind, person_id, at) values (${jobId}, ${view.period}, ${action}, ${personId}, ${new Date(now)})`;
      return { ok: true as const, value: job };
    });
  },
  async cleaningMissed(jobId, period, note) {
    const rows = await sql()`insert into cleaning_events (job_id, period, kind, note) values (${jobId}, ${period}, 'missed', ${note})
      on conflict (job_id, period) where kind = 'missed' do nothing returning id`;
    return rows.length > 0;
  },
};
