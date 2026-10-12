import { store } from "@/lib/data";
import type { Store } from "@/lib/data/store";
import { reminderAt, reminderKey, shiftEnd, shiftStart, teamDay, type TeamDayRow } from "@/lib/domain/reminders";
import { londonDate } from "@/lib/domain/time";
import type { SiteId } from "@/lib/domain/types";

/** Today's published shifts at these sites, with each one's reminder and latest reply. Read-only. */
export async function teamToday(siteIds: SiteId[], now = Date.now(), db: Store = store()): Promise<TeamDayRow[]> {
  const shifts = (await db.shiftsOnDate(londonDate(now))).filter((s) => siteIds.includes(s.siteId));
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
  /** Until when a late or can't-make-it reply stays at the top of Today (a late one: half an hour after they said they'd arrive). */
  alertUntil?: number;
  /** Hasn't started and hasn't had a reminder: the owner's button would send one. */
  toRemind: boolean;
}

const hm = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

/** Today's team as shown to managers and the owner. */
export function teamRowsView(rows: TeamDayRow[]): TeamRowView[] {
  return rows.map((r) => {
    const reply = r.reply;
    const status = reply
      ? { text: `${reply.kind === "on_my_way" ? "On my way" : reply.kind === "late" ? `About ${reply.lateMinutes} min late` : "Can't make it"} · ${hm(reply.createdAt)}`,
          tone: reply.kind === "on_my_way" ? "done" as const : reply.kind === "late" ? "late" as const : "bad" as const }
      : r.remindedAt && !r.ended ? { text: "No reply yet", tone: "" as const } : undefined;
    const when = r.remindedAt ? `Reminded ${hm(r.remindedAt)}` : r.started ? "Not reminded" : `Reminder at ${hm(reminderAt(r))}`;
    return {
      shiftId: r.shiftId, name: r.name, siteId: r.siteId, site: r.siteName, section: r.section, time: `${r.start}–${r.end}`, status,
      note: r.notificationsOn ? when : `${when} · notifications off`, noteWarn: !r.notificationsOn,
      started: r.started, toRemind: !r.started && !r.remindedAt,
      alertUntil: reply?.kind === "cant_make_it" ? shiftEnd(r) : reply?.kind === "late" ? shiftStart(r) + ((reply.lateMinutes ?? 0) + 30) * 60_000 : undefined,
    };
  });
}
