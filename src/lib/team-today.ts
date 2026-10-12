import { store } from "@/lib/data";
import type { Store } from "@/lib/data/store";
import { reminderAt, reminderKey, sectionName, teamDay, todaysShifts, type TeamDayRow } from "@/lib/domain/reminders";
import { addDays, londonDate, shortDay } from "@/lib/domain/time";
import type { SiteId } from "@/lib/domain/types";

/** Today's published shifts at these sites (and last night's still going), with each one's reminder and latest reply. Read-only. */
export async function teamToday(siteIds: SiteId[], now = Date.now(), db: Store = store()): Promise<TeamDayRow[]> {
  const today = londonDate(now);
  const around = (await Promise.all([addDays(today, -1), today, addDays(today, 1)].map((d) => db.shiftsOnDate(d)))).flat();
  const shifts = todaysShifts(around.filter((s) => siteIds.includes(s.siteId)), today, now);
  if (!shifts.length) return [];
  const [people, replies, reminded, withPush] = await Promise.all([
    db.people(), db.shiftReplies(shifts.map((s) => s.id)), db.noticeKeys(shifts.map(reminderKey)), db.peopleWithPush(),
  ]);
  const names = new Map(people.map((p) => [p.id, p.name]));
  return teamDay(shifts.map((s) => ({ ...s, name: names.get(s.personId) ?? s.staffCode })), reminded, replies, withPush, now);
}

export interface TeamRowView {
  shiftId: string; name: string; siteId: SiteId; site: string; section: string; time: string;
  status?: { text: string; tone: "done" | "late" | "bad" | "" };
  /** When the reminder went (or will go), and whether it can reach a phone. */
  note: string; noteWarn: boolean;
  started: boolean;
  /** Until when a late or can't-make-it reply stays at the top of Today. */
  alertUntil?: number;
  /** Hasn't started and hasn't had a reminder: the owner's button would send one. */
  toRemind: boolean;
}

const hm = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

/** Today's team as shown to managers and the owner. Times on another day say which day ("Sun 21:40"). */
export function teamRowsView(rows: TeamDayRow[], now = Date.now()): TeamRowView[] {
  const today = londonDate(now);
  const stamp = (t: number) => (londonDate(t) === today ? hm(t) : `${shortDay(londonDate(t)).split(" ")[0]} ${hm(t)}`);
  return rows.map((r) => {
    const reply = r.reply;
    const status = reply
      ? { text: `${reply.kind === "on_my_way" ? "On my way" : reply.kind === "late" ? `About ${reply.lateMinutes} min late` : "Can't make it"} · ${stamp(reply.createdAt)}`,
          tone: reply.kind === "on_my_way" ? "done" as const : reply.kind === "late" ? "late" as const : "bad" as const }
      : r.remindedAt && !r.ended ? { text: "No reply yet", tone: "" as const } : undefined;
    const when = r.remindedAt ? `Reminded ${stamp(r.remindedAt)}` : r.started ? "Not reminded" : `Reminder at ${stamp(reminderAt(r))}`;
    return {
      shiftId: r.shiftId, name: r.name, siteId: r.siteId, site: r.siteName, section: sectionName(r.section),
      time: r.date === today ? `${r.start}–${r.end}` : `${shortDay(r.date).split(" ")[0]} ${r.start}–${r.end}`, status,
      note: r.notificationsOn ? when : `${when} · notifications off`, noteWarn: !r.notificationsOn,
      started: r.started, alertUntil: r.alertUntil, toRemind: !r.started && !r.remindedAt,
    };
  });
}
