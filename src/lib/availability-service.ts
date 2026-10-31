import { store } from "@/lib/data";
import type { Store } from "@/lib/data/store";
import { askedWeek, asksAvailability, availReminderMessage, availReminderStage, latestAvailability } from "@/lib/domain/availability";

/**
 * Wednesday and Thursday from midday (London): a message to everyone asked who hasn't said when they can work next
 * week. Once per person, week and day (the key), and not to anyone who has answered.
 */
export async function queueAvailabilityReminders(now = Date.now(), db: Store = store()): Promise<number> {
  const week = askedWeek(now);
  const stage = availReminderStage(week, now);
  if (!stage) return 0;
  const [people, sites, answers] = await Promise.all([db.people(), db.sites(), db.availability(week)]);
  const answered = latestAvailability(answers);
  const msg = availReminderMessage(week, stage);
  let queued = 0;
  for (const p of people.filter((x) => asksAvailability(x, sites) && !answered.has(x.id))) {
    if (await db.queueNotice({ personId: p.id, kind: "availability", title: msg.title, body: msg.body,
      dedupeKey: `avail|${week}|${stage}|${p.id}`, sendAfter: now, url: "/me/availability" })) queued++;
  }
  return queued;
}
