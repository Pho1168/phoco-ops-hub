import type { AvailDay, Availability } from "@/lib/domain/availability";

/**
 * Weekly availability (migration 0044). Part of Store (both stores implement it). Answers are only ever added; the
 * latest for a person and week counts (`latestAvailability`).
 */
export interface AvailabilityStore {
  /** Every answer for this week (Monday), oldest first, with the person's name. */
  availability(week: string): Promise<Availability[]>;
  /** A person's answers for these weeks, oldest first. */
  myAvailability(personId: string, weeks: string[]): Promise<Availability[]>;
  addAvailability(personId: string, week: string, days: AvailDay[]): Promise<Availability>;
}
