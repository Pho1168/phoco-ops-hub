import { store } from "@/lib/data";
import type { Store } from "@/lib/data/store";
import { passport, tally, type PassportRow, type TrainingData } from "@/lib/domain/training";
import { londonDate } from "@/lib/domain/time";
import type { Person, Site } from "@/lib/domain/types";

/**
 * Read-only: everything the training rules need (rules in src/lib/domain/training.ts). `personIds` limits the
 * records and start dates to those people; skills, questions and deadlines are always all of them.
 */
export async function trainingData(db: Store = store(), personIds?: string[]): Promise<TrainingData> {
  const [skills, questions, pathways, starts, events] = await Promise.all([
    db.trainingSkills(), db.trainingQuestions(), db.trainingPathways(), db.trainingStarts(personIds), db.trainingEvents({ personIds }),
  ]);
  const majorChanges = await db.libraryMajorChanges(Array.from(new Set(skills.filter((s) => !s.retiredAt).flatMap((s) => s.links))));
  return { skills, questions, pathways, starts, events, majorChanges };
}

/** Someone's own passport and how it adds up, for My training, Today and My shifts. */
export async function myTraining(person: Pick<Person, "id" | "status" | "access">, sites: Pick<Site, "id" | "status">[], db: Store = store()):
  Promise<{ rows: PassportRow[]; tally: ReturnType<typeof tally> }> {
  const rows = passport(person, sites, await trainingData(db, [person.id]), londonDate(Date.now()));
  return { rows, tally: tally(rows) };
}
