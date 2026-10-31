import type { CleaningAction, CleaningEvent, CleaningJob, JobFields } from "@/lib/domain/cleaning";
import type { SiteId } from "@/lib/domain/types";
import type { Done } from "./stock-store";

/**
 * The cleaning board's records (migration 0040). Part of Store (both stores implement it). Jobs are kept (never
 * deleted); events are only ever added. Claiming, letting go and ticking done run the board rules (`canAct`) again
 * with the job locked, so two people at once can't both tick the last one.
 */
export interface CleaningStore {
  /** Jobs at these sites (all sites when left out), in list order; retired ones too. */
  cleaningJobs(siteIds?: SiteId[]): Promise<CleaningJob[]>;
  /** Events for these sites' jobs counting for periods from `sinceDate` (YYYY-MM-DD) on. */
  cleaningEvents(siteIds: SiteId[], sinceDate: string): Promise<CleaningEvent[]>;
  /** Claim, let go or tick done, checked against the board as it is now. */
  cleaningAct(jobId: string, action: CleaningAction, personId: string, now: number): Promise<Done<CleaningJob>>;
  /** Marks a job missed for a period (once: false if it already was). */
  cleaningMissed(jobId: string, period: string, note: string): Promise<boolean>;
  /** The owner adds a job at a site (last on its list) or changes one; false if the id is taken or it isn't there. */
  saveCleaningJob(id: string, siteId: SiteId | undefined, fields: JobFields): Promise<boolean>;
  /** Switches a job off (off the board, never deleted) or back on; false if it already was. */
  setCleaningJobActive(id: string, active: boolean): Promise<boolean>;
}
