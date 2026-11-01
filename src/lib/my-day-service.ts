import type { Store } from "@/lib/data/store";
import { alertWords, dueWords, myAlerts, myDay, repeatWords, type MyDayView, type MyItem, type MyTask } from "@/lib/domain/my-day";
import type { MyRowView } from "@/components/MyDay";
import { afterQuietHours, londonDate, londonToUtc } from "@/lib/domain/time";

/** A person's My Day as it stands now (London date). */
export async function myDayFor(db: Store, personId: string, now: number): Promise<{ view: MyDayView; tasks: MyTask[]; today: string }> {
  const today = londonDate(now);
  const tasks = await db.myTasks(personId);
  const marks = await db.myTaskMarks(tasks.map((t) => t.id));
  return { view: myDay(tasks, marks, today, londonToUtc(today, "00:00")), tasks, today };
}

/**
 * Run by tick() every time: the heads-up and on-the-day messages for owners' tasks with a reminder (kind `myday`,
 * key `myday|<task>|<due>|<stage>|<person>`, so each goes once). They wait for the end of quiet hours.
 */
export async function queueMyDayAlerts(now: number, db: Store): Promise<number> {
  const tasks = await db.myTasksWithAlerts();
  if (!tasks.length) return 0;
  const alerts = myAlerts(tasks, await db.myTaskMarks(tasks.map((t) => t.id)), londonDate(now));
  let queued = 0;
  for (const a of alerts) {
    if (await db.queueNotice({ personId: a.personId, kind: "myday", title: a.title, body: a.body, dedupeKey: a.dedupeKey, sendAfter: afterQuietHours(now), url: "/owner/day" })) queued++;
  }
  return queued;
}

/** What a row on the screen shows. */
export const rowView = (i: MyItem, today: string): MyRowView => ({
  id: i.task.id, title: i.task.title, note: i.task.note, priority: i.task.priority, due: i.due, dueWords: dueWords(i, today), late: i.state === "late",
  top: i.task.top, repeatWords: repeatWords(i.task), alertWords: alertWords(i.task),
});
