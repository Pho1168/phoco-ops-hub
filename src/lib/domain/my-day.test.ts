import { describe, expect, it } from "vitest";
import {
  alertWords, cleanMyTask, currentDue, dueWords, handled, isoWeekday, monthDay, myAlerts, myDay, nextAfter, occurrenceFrom, repeatWords, startsFor,
  type MyMark, type MyTask,
} from "./my-day";
import { londonToUtc } from "./time";

const task = (over: Partial<MyTask> = {}): MyTask => ({
  id: "t1", personId: "own", title: "Pay YULEND £325", priority: 1, repeat: "weekly", day: 1, startsOn: "2026-11-01", top: false, status: "open",
  createdAt: 0, ...over,
});
let n = 0;
const mark = (taskId: string, dueOn: string, kind: MyMark["kind"] = "done", at = ++n): MyMark => ({ id: `m${n}`, taskId, dueOn, kind, at });
const SUN = "2026-11-01";
const start = londonToUtc(SUN, "00:00");

describe("dates", () => {
  it("knows the weekday", () => {
    expect(isoWeekday("2026-11-01")).toBe(7);
    expect(isoWeekday("2026-11-02")).toBe(1);
  });
  it("uses the last day in a shorter month", () => {
    expect(monthDay(2027, 2, 30)).toBe("2027-02-28");
    expect(monthDay(2028, 2, 30)).toBe("2028-02-29");
    expect(monthDay(2026, 11, 30)).toBe("2026-11-30");
    expect(monthDay(2026, 12, 31)).toBe("2026-12-31");
  });
  it("finds a weekly occurrence on or after a date", () => {
    expect(occurrenceFrom({ repeat: "weekly", day: 1 }, "2026-11-01")).toBe("2026-11-02");
    expect(occurrenceFrom({ repeat: "weekly", day: 7 }, "2026-11-01")).toBe("2026-11-01");
    expect(nextAfter({ repeat: "weekly", day: 1 }, "2026-11-02")).toBe("2026-11-09");
  });
  it("finds a monthly occurrence, rolling into the next month or year", () => {
    expect(occurrenceFrom({ repeat: "monthly", day: 15 }, "2026-11-01")).toBe("2026-11-15");
    expect(occurrenceFrom({ repeat: "monthly", day: 1 }, "2026-11-02")).toBe("2026-12-01");
    expect(occurrenceFrom({ repeat: "monthly", day: 18 }, "2026-12-20")).toBe("2027-01-18");
    expect(nextAfter({ repeat: "monthly", day: 30 }, "2027-01-30")).toBe("2027-02-28");
    expect(nextAfter({ repeat: "monthly", day: 30 }, "2027-02-28")).toBe("2027-03-30");
  });
});

describe("carrying forward", () => {
  it("shows the earliest occurrence not ticked, so a missed one stays", () => {
    const t = task({ startsOn: "2026-10-20" });
    expect(currentDue(t, handled([]))).toBe("2026-10-26");
    expect(currentDue(t, handled([mark("t1", "2026-10-26")]))).toBe("2026-11-02");
  });
  it("counts the latest tick: undone puts it back, skipped moves on", () => {
    const t = task({ startsOn: "2026-10-20" });
    expect(currentDue(t, handled([mark("t1", "2026-10-26"), mark("t1", "2026-10-26", "undone")]))).toBe("2026-10-26");
    expect(currentDue(t, handled([mark("t1", "2026-10-26", "skipped")]))).toBe("2026-11-02");
  });
  it("ends a once-task when it's done, and a stopped task straight away", () => {
    expect(currentDue(task({ repeat: "once", day: undefined, dueOn: SUN }), handled([mark("t1", SUN)]))).toBeUndefined();
    expect(currentDue(task({ repeat: "once", day: undefined, dueOn: SUN }), handled([]))).toBe(SUN);
    expect(currentDue(task({ status: "stopped" }), handled([]))).toBeUndefined();
  });
  it("keeps a whenever task's tick under its start date", () => {
    const t = task({ repeat: "once", day: undefined, startsOn: "2026-10-30" });
    expect(currentDue(t, handled([]))).toBe("2026-10-30");
    expect(currentDue(t, handled([mark("t1", "2026-10-30")]))).toBeUndefined();
  });
});

describe("the day's view", () => {
  const list = [
    task({ id: "gym", title: "Gym", priority: 3, repeat: "once", day: undefined, dueOn: SUN }),
    task({ id: "pay", title: "Café La Viet pay summary", priority: 1, repeat: "weekly", day: 7, startsOn: "2026-10-25" }),
    task({ id: "jit", title: "Forecast for Jit", priority: 2, repeat: "once", day: undefined, dueOn: "2026-10-30" }),
    task({ id: "yul", title: "Pay YULEND £325", priority: 1, repeat: "weekly", day: 1 }),
    task({ id: "rent", title: "Eastcote rent £5,625", priority: 1, repeat: "monthly", day: 18 }),
    task({ id: "idea", title: "Look at new POS", priority: 3, repeat: "once", day: undefined }),
  ];
  it("puts overdue first, then today's by priority, into a Top 3", () => {
    const v = myDay(list, [], SUN, start);
    expect(v.top.map((i) => i.task.id)).toEqual(["pay", "jit", "gym"]);
    expect(v.top[0]).toMatchObject({ due: "2026-10-25", state: "late", overdueDays: 7 });
    expect(v.today).toEqual([]);
    expect(v.week.map((i) => i.task.id)).toEqual(["yul"]);
    expect(v.later.map((i) => i.task.id)).toEqual(["rent"]);
    expect(v.anytime.map((i) => i.task.id)).toEqual(["idea"]);
    expect(v.leftToday).toBe(3);
  });
  it("moves a pinned task into the Top 3 and the rest down to today", () => {
    const v = myDay(list.map((t) => (t.id === "idea" ? { ...t, top: true } : t)), [], SUN, start);
    expect(v.top.map((i) => i.task.id)).toEqual(["idea", "pay", "jit"]);
    expect(v.today.map((i) => i.task.id)).toEqual(["gym"]);
  });
  it("lists what was ticked today, which can be put back", () => {
    const v = myDay(list, [mark("gym", SUN, "done", start + 1000), mark("jit", "2026-10-30", "skipped", start - 1000)], SUN, start);
    expect(v.doneToday.map((d) => [d.task.id, d.kind])).toEqual([["gym", "done"]]);
    expect(v.top.map((i) => i.task.id)).toEqual(["pay"]);
  });
  it("words due dates", () => {
    expect(dueWords({ due: "2026-10-30", state: "late" }, SUN)).toBe("Overdue since Fri 30 Oct");
    expect(dueWords({ due: SUN, state: "today" }, SUN)).toBe("Today");
    expect(dueWords({ due: "2026-11-02", state: "week" }, SUN)).toBe("Tomorrow");
    expect(dueWords({ due: "2026-11-18", state: "later" }, SUN)).toBe("Wed 18 Nov");
    expect(dueWords({ due: SUN, state: "anytime" }, SUN)).toBe("No date");
  });
  it("words schedules and reminders", () => {
    expect(repeatWords({ repeat: "weekly", day: 6 })).toBe("Every Saturday");
    expect(repeatWords({ repeat: "monthly", day: 1 })).toBe("Every month on the 1st");
    expect(repeatWords({ repeat: "monthly", day: 30 })).toBe("Every month on the 30th (last day in shorter months)");
    expect(repeatWords({ repeat: "monthly", day: 22 })).toBe("Every month on the 22nd");
    expect(repeatWords({ repeat: "monthly", day: 13 })).toBe("Every month on the 13th");
    expect(alertWords({ alertDays: 2 })).toBe("Alert 2 days before");
    expect(alertWords({ alertDays: 0 })).toBe("Alert on the day");
    expect(alertWords({})).toBe("");
  });
});

describe("phone reminders", () => {
  const rent = task({ id: "rent", title: "Eastcote rent £5,625", repeat: "monthly", day: 18, alertDays: 2 });
  it("sends a heads-up within the alert days and one on the day", () => {
    expect(myAlerts([rent], [], "2026-11-15")).toEqual([]);
    expect(myAlerts([rent], [], "2026-11-16")).toMatchObject([{ stage: "ahead", due: "2026-11-18", title: "Coming up: Eastcote rent £5,625", body: "Due Wed 18 Nov.", dedupeKey: "myday|rent|2026-11-18|ahead|own" }]);
    expect(myAlerts([rent], [], "2026-11-17")[0].body).toBe("Due tomorrow.");
    expect(myAlerts([rent], [], "2026-11-18")).toMatchObject([{ stage: "day", title: "Due today: Eastcote rent £5,625" }]);
  });
  it("stops once it's done, and moves on to the next one", () => {
    expect(myAlerts([rent], [mark("rent", "2026-11-18")], "2026-11-18")).toEqual([]);
    expect(myAlerts([rent], [mark("rent", "2026-11-18")], "2026-12-16")).toMatchObject([{ due: "2026-12-18", stage: "ahead" }]);
  });
  it("sends nothing without a reminder, a date, or once stopped", () => {
    expect(myAlerts([{ ...rent, alertDays: undefined }], [], "2026-11-18")).toEqual([]);
    expect(myAlerts([task({ repeat: "once", day: undefined, alertDays: 0 })], [], SUN)).toEqual([]);
    expect(myAlerts([{ ...rent, status: "stopped" }], [], "2026-11-18")).toEqual([]);
  });
});

describe("checking a task", () => {
  it("tidies a weekly task", () => {
    expect(cleanMyTask({ title: "  Pay   YULEND £325 ", priority: 1, repeat: "weekly", day: 1, alertDays: 1 }))
      .toEqual({ ok: true, value: { title: "Pay YULEND £325", note: undefined, priority: 1, repeat: "weekly", day: 1, alertDays: 1, top: false } });
  });
  it("refuses what doesn't make sense", () => {
    expect(cleanMyTask({ title: " ", priority: 1, repeat: "once" })).toMatchObject({ ok: false });
    expect(cleanMyTask({ title: "x", priority: 4, repeat: "once" })).toMatchObject({ ok: false });
    expect(cleanMyTask({ title: "x", priority: 1, repeat: "weekly", day: 8 })).toMatchObject({ ok: false });
    expect(cleanMyTask({ title: "x", priority: 1, repeat: "monthly", day: 0 })).toMatchObject({ ok: false });
    expect(cleanMyTask({ title: "x", priority: 1, repeat: "once", dueOn: "2026-02-30" })).toMatchObject({ ok: false });
    expect(cleanMyTask({ title: "x", priority: 1, repeat: "once", alertDays: 1 })).toMatchObject({ ok: false, error: "A reminder needs a date" });
    expect(cleanMyTask({ title: "x", priority: 1, repeat: "daily" })).toMatchObject({ ok: false });
  });
  it("restarts the count only when the schedule changes", () => {
    const before = { repeat: "weekly" as const, day: 1, startsOn: "2026-10-01" };
    expect(startsFor(before, { repeat: "weekly", day: 1 }, SUN)).toBe("2026-10-01");
    expect(startsFor(before, { repeat: "weekly", day: 2 }, SUN)).toBe(SUN);
    expect(startsFor(undefined, { repeat: "monthly", day: 1 }, SUN)).toBe(SUN);
  });
});
