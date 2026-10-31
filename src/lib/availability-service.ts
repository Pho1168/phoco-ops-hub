import { store } from "@/lib/data";
import type { Store } from "@/lib/data/store";
import { askedWeek, asksAvailability, availReminderMessage, availReminderStage, latestAvailability, OWNER_ROTA_DAYS } from "@/lib/domain/availability";
import { isOwner } from "@/lib/domain/access";
import { addDays, londonDate } from "@/lib/domain/time";
import type { Person } from "@/lib/domain/types";

/**
 * Where each owner has been or is on the published rota, within OWNER_ROTA_DAYS either side of today (owners who
 * work shifts are asked for their availability). Only owners are looked up.
 */
export async function ownerRotaSites(db: Store, people: Pick<Person, "id" | "status" | "access">[], now: number): Promise<Map<string, string[]>> {
  const today = londonDate(now);
  const out = new Map<string, string[]>();
  for (const p of people.filter((x) => x.status === "active" && isOwner(x))) {
    const shifts = (await db.shiftsForPerson(p.id, addDays(today, -OWNER_ROTA_DAYS), addDays(today, OWNER_ROTA_DAYS))).filter((s) => s.published && !s.cancelled);
    if (shifts.length) out.set(p.id, [...new Set(shifts.map((s) => s.siteId))]);
  }
  return out;
}
/** The same for one person (empty unless they're an owner on the rota). */
export async function rotaSitesOf(db: Store, p: Pick<Person, "id" | "status" | "access">, now: number): Promise<string[]> {
  return isOwner(p) ? (await ownerRotaSites(db, [p], now)).get(p.id) ?? [] : [];
}

/**
 * Friday from 12:00 and Saturday from 10:00 until it closes at 15:00 (London): a message to everyone asked who hasn't said when they can work next
 * week. Once per person, week and day (the key), and not to anyone who has answered.
 */
export async function queueAvailabilityReminders(now = Date.now(), db: Store = store()): Promise<number> {
  const week = askedWeek(now);
  const stage = availReminderStage(week, now);
  if (!stage) return 0;
  const [people, sites, answers] = await Promise.all([db.people(), db.sites(), db.availability(week)]);
  const ownerRota = await ownerRotaSites(db, people, now);
  const answered = latestAvailability(answers);
  const msg = availReminderMessage(week, stage);
  let queued = 0;
  for (const p of people.filter((x) => asksAvailability(x, sites, ownerRota.get(x.id)) && !answered.has(x.id))) {
    if (await db.queueNotice({ personId: p.id, kind: "availability", title: msg.title, body: msg.body,
      dedupeKey: `avail|${week}|${stage}|${p.id}`, sendAfter: now, url: "/me/availability" })) queued++;
  }
  return queued;
}
