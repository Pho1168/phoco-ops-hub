import { randomUUID } from "node:crypto";
import { canAct, jobView, type CleaningEvent, type CleaningJob } from "@/lib/domain/cleaning";
import type { CleaningStore } from "./cleaning-store";

/** The cleaning board in demo mode: in memory, with the same rules as the database. A few demo jobs per site. */

interface CleaningState { jobs: CleaningJob[]; events: CleaningEvent[] }
const g = globalThis as unknown as { __phocoCleaningDemo?: CleaningState };

function seed(): CleaningState {
  const at = Date.UTC(2026, 0, 5);
  let position = 0;
  const job = (siteId: string, area: CleaningJob["area"], name: string, times = 1, per: CleaningJob["per"] = "week"): CleaningJob =>
    ({ id: `${siteId}-${area}-${++position}`, siteId, area, name, per, times, position, active: true, createdAt: at });
  return {
    jobs: [
      job("EAS", "BOH", "Grease traps", 2), job("EAS", "BOH", "Canopy / extraction grills and hood"), job("EAS", "BOH", "6 ring burner"),
      job("EAS", "BOH", "Inside fridges and freezers"), { ...job("EAS", "FOH", "Air con cleaned", 1, "every"), everyMonths: 6, firstDue: "2027-04-22" },
      job("EAS", "FOH", "Light pendants wiped"), job("EAS", "FOH", "Main windows cleaned"),
      job("WEM", "PROD", "Grease traps", 2), job("WEM", "PROD", "Extraction grills and hood"), job("WEM", "PROD", "Cold room evaporators", 1, "month"),
    ],
    events: [],
  };
}
const S = () => (g.__phocoCleaningDemo ??= seed());
export function resetCleaningDemo() { g.__phocoCleaningDemo = seed(); }

export function makeCleaningDemo(deps: { personName: (id: string) => string | undefined }): CleaningStore {
  const named = (e: CleaningEvent): CleaningEvent => ({ ...e, personName: e.personId ? deps.personName(e.personId) : undefined });
  return {
    async cleaningJobs(siteIds) {
      return S().jobs.filter((j) => !siteIds || siteIds.includes(j.siteId)).sort((a, b) => a.siteId.localeCompare(b.siteId) || a.position - b.position).map((j) => ({ ...j }));
    },
    async cleaningEvents(siteIds, sinceDate) {
      const jobs = new Set(S().jobs.filter((j) => siteIds.includes(j.siteId)).map((j) => j.id));
      return S().events.filter((e) => jobs.has(e.jobId) && e.period >= sinceDate).map(named);
    },
    async cleaningAct(jobId, action, personId, now) {
      const job = S().jobs.find((j) => j.id === jobId);
      if (!job || !job.active) return { ok: false, error: "That job isn't on the board any more" };
      const view = jobView(job, S().events.filter((e) => e.jobId === jobId).map(named), now);
      const ok = canAct(view, action, personId);
      if (!ok.ok) return ok;
      S().events.push({ id: randomUUID(), jobId, period: view.period, kind: action, personId, at: now });
      return { ok: true, value: { ...job } };
    },
    async saveCleaningJob(id, siteId, f) {
      const jobs = S().jobs;
      const fields = { area: f.area, name: f.name, per: f.per, times: f.times, everyMonths: f.everyMonths, firstDue: f.firstDue };
      if (siteId) {
        if (jobs.some((j) => j.id === id)) return false;
        jobs.push({ id, siteId, ...fields, position: Math.max(0, ...jobs.filter((j) => j.siteId === siteId).map((j) => j.position)) + 1, active: true, createdAt: Date.now() });
        return true;
      }
      const j = jobs.find((x) => x.id === id);
      if (!j) return false;
      Object.assign(j, fields);
      return true;
    },
    async setCleaningJobActive(id, active) {
      const j = S().jobs.find((x) => x.id === id);
      if (!j || j.active === active) return false;
      j.active = active;
      return true;
    },
    async cleaningMissed(jobId, period, note) {
      if (S().events.some((e) => e.jobId === jobId && e.period === period && e.kind === "missed")) return false;
      S().events.push({ id: randomUUID(), jobId, period, kind: "missed", note, at: Date.now() });
      return true;
    },
  };
}
