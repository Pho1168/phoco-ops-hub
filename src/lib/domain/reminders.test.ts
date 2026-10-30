import { describe, expect, it } from "vitest";
import {
  canReply, canSayOnMyWay, ON_MY_WAY_OVER, shiftStart, dueReminders, forYou, forYouLine, latestReplies, PHONE_COUNT_CATEGORIES, PHONE_TEXT_CATEGORIES, phoneNote, reminderAt, reminderKey, replyAlertUntil,
  replyMessages, replyOpen, replySendAfter, sameReply, shiftEnd, shiftReminderMessage, startingLaterToday, TABLET_ONLY_CATEGORIES, teamDay, todaysShifts,
  waitingFrom, waitingLines, type ReminderShift, type ShiftReply,
} from "./reminders";
import { NOTE_CATEGORIES } from "./handover";
import { londonToUtc } from "./time";
import type { Person } from "./types";

const at = londonToUtc;
const shift = (over: Partial<ReminderShift> = {}): ReminderShift =>
  ({ id: "s1", personId: "p1", siteId: "EAS", siteName: "Eastcote", section: "BOH", date: "2026-10-14", start: "11:00", end: "22:15", ...over });
const reply = (over: Partial<ShiftReply> = {}): ShiftReply =>
  ({ id: "r1", shiftId: "s1", personId: "p1", siteId: "EAS", kind: "late", lateMinutes: 15, createdAt: at("2026-10-14", "09:10"), ...over });
const person = (id: string, access: Person["access"], status: Person["status"] = "active") => ({ id, status, access });
const people = [
  person("p1", [{ siteId: "EAS", role: "staff", sections: ["BOH"] }]),
  person("mgr", [{ siteId: "EAS", role: "manager", sections: ["FOH", "BOH"] }]),
  person("own", [{ siteId: "EAS", role: "owner", sections: [] }, { siteId: "WEM", role: "owner", sections: [] }]),
  person("wem", [{ siteId: "WEM", role: "manager", sections: ["PROD"] }]),
  person("old", [{ siteId: "EAS", role: "manager", sections: [] }], "left"),
  person("p2", [{ siteId: "EAS", role: "staff", sections: ["FOH"] }]),
];

describe("when shift reminders go", () => {
  it("goes 2 hours before the shift starts", () => {
    expect(reminderAt(shift())).toBe(at("2026-10-14", "09:00"));
    expect(reminderAt(shift({ start: "17:00" }))).toBe(at("2026-10-14", "15:00"));
  });
  it("doesn't go before 05:00 unless the shift starts before 05:30, and always leaves time for the 10-minute scheduler", () => {
    expect(reminderAt(shift({ start: "06:00" }))).toBe(at("2026-10-14", "05:00"));
    expect(reminderAt(shift({ start: "05:30" }))).toBe(at("2026-10-14", "05:00"));
    expect(reminderAt(shift({ start: "05:05" }))).toBe(at("2026-10-14", "03:05")); // 05:00 would leave only 5 minutes
    expect(reminderAt(shift({ start: "05:00" }))).toBe(at("2026-10-14", "03:00"));
    expect(reminderAt(shift({ start: "04:30" }))).toBe(at("2026-10-14", "02:30"));
    expect(reminderAt(shift({ start: "00:30", end: "08:00" }))).toBe(at("2026-10-13", "22:30"));
  });
  it("is 2 real hours before, across the clock changes", () => {
    // 25 Oct 2026: 02:00 BST becomes 01:00 GMT. A 03:00 start is reminded at 01:00 GMT, two hours earlier.
    expect(new Date(reminderAt(shift({ date: "2026-10-25", start: "03:00", end: "09:00" }))).toISOString()).toBe("2026-10-25T01:00:00.000Z");
    expect(reminderAt(shift({ date: "2026-10-25", start: "09:00" }))).toBe(at("2026-10-25", "07:00"));
    // 28 Mar 2027: 01:00 GMT becomes 02:00 BST. A 03:00 BST start (02:00 UTC) is reminded at 00:00 GMT.
    expect(new Date(reminderAt(shift({ date: "2027-03-28", start: "03:00", end: "09:00" }))).toISOString()).toBe("2027-03-28T00:00:00.000Z");
  });
  it("is due from its time until the shift starts", () => {
    const s = [shift()];
    expect(dueReminders(s, at("2026-10-14", "08:59"))).toEqual([]);
    expect(dueReminders(s, at("2026-10-14", "09:00"))).toHaveLength(1);
    expect(dueReminders(s, at("2026-10-14", "10:59"))).toHaveLength(1);
    expect(dueReminders(s, at("2026-10-14", "11:00"))).toEqual([]);
  });
  it("the button takes today's shifts that haven't started", () => {
    const list = [shift({ id: "a", start: "09:00" }), shift({ id: "b", start: "17:00" }), shift({ id: "c", date: "2026-10-15" })];
    expect(startingLaterToday(list, "2026-10-14", at("2026-10-14", "10:00")).map((s) => s.id)).toEqual(["b"]);
  });
  it("one per person per shift, and a new one if the shift moves", () => {
    expect(reminderKey(shift())).toBe("shift|s1|p1|2026-10-14T11:00");
    expect(reminderKey(shift({ start: "12:00" }))).not.toBe(reminderKey(shift()));
    expect(reminderKey(shift({ personId: "p2" }))).not.toBe(reminderKey(shift()));
  });
  it("a shift past midnight ends the next day", () => {
    expect(shiftEnd(shift({ start: "18:00", end: "01:00" }))).toBe(at("2026-10-15", "01:00"));
  });
});

describe("today's list", () => {
  it("today's shifts, last night's still going, and tonight's after midnight once within 6 hours", () => {
    const list = [
      shift({ id: "today" }),
      shift({ id: "lastnight", date: "2026-10-13", start: "18:00", end: "02:00" }),
      shift({ id: "yesterday", date: "2026-10-13", start: "11:00", end: "22:15" }),
      shift({ id: "early", date: "2026-10-15", start: "00:30", end: "06:00" }),
      shift({ id: "tomorrow", date: "2026-10-15", start: "11:00" }),
    ];
    expect(todaysShifts(list, "2026-10-14", at("2026-10-14", "01:00")).map((s) => s.id)).toEqual(["today", "lastnight"]);
    expect(todaysShifts(list, "2026-10-14", at("2026-10-14", "19:00")).map((s) => s.id)).toEqual(["today", "early"]);
  });
});

describe("what a reminder says", () => {
  const t = at("2026-10-14", "08:00");
  const note = (category: string, body: string, over: { needsAction?: boolean; closedAt?: number; createdAt?: number } = {}) =>
    ({ category, body, needsAction: true, createdAt: t, ...over });

  it("every handover category is decided: text on phones, a count, or tablet only", () => {
    for (const c of NOTE_CATEGORIES) expect([...PHONE_TEXT_CATEGORIES, ...PHONE_COUNT_CATEGORIES, ...TABLET_ONLY_CATEGORIES]).toContain(c);
    expect(waitingFrom([note("Something new", "Not decided yet")], []).actions).toEqual([]); // unknown categories stay on the tablet
  });
  it("only action notes that can be read on a lock screen: no staff notes, complaints as a count", () => {
    const w = waitingFrom([
      note("Equipment", "Fridge 2 door seal loose", { createdAt: t + 2 }),
      note("Food safety", "Chicken delivery came in at 9°C, check with supplier", { createdAt: t + 1 }),
      note("Staff note", "Talk to Sam about lateness"),
      note("Customer complaint", "Mrs Smith 07700 900123 says soup was cold"),
      note("Customer complaint", "Table 4 waited 40 minutes"),
      note("Stock shortage", "Out of beansprouts", { needsAction: false }),
      note("Other", "Bin store key is in the office", { closedAt: t + 5 }),
    ], []);
    expect(w.actions.map((n) => n.category)).toEqual(["Food safety", "Equipment"]);
    expect(w.complaints).toBe(2);
    const lines = waitingLines(w);
    expect(lines).toEqual([
      "• Food safety: Chicken delivery came in at 9°C, check with supplier",
      "• Fridge 2 door seal loose",
      "• 2 customer complaints to follow up",
    ]);
    expect(lines.join("\n")).not.toMatch(/Sam|Smith|07700/);
  });
  it("keeps it short: long notes are cut, extra ones counted, prep summarised with urgent first", () => {
    const long = "The extraction fan over the main range is making a grinding noise and smells of burning when it's on high";
    const w = waitingFrom(
      [note("Equipment", long, { createdAt: t + 4 }), note("Other", "B", { createdAt: t + 3 }), note("Other", "C", { createdAt: t + 2 }), note("Other", "D", { createdAt: t + 1 }), note("Other", "E")],
      [{ name: "Cook rice", urgent: false }, { name: "Soak pho noodles", urgent: true }, { name: "Smash ice", urgent: false }, { name: "Cook prawns", urgent: true }, { name: "Cook bun", urgent: false }],
    );
    const lines = waitingLines(w);
    expect(lines[0].length).toBeLessThanOrEqual(73);
    expect(lines[0].endsWith("…")).toBe(true);
    expect(lines).toContain("• +2 more on the tablet");
    expect(lines[lines.length - 1]).toBe("• Prep to do: 5 (2 urgent): Soak pho noodles, Cook prawns, Cook rice +2 more");
  });
  it("leads with the start time, then what's waiting, then how to reply", () => {
    const w = waitingFrom([note("Equipment", "Fridge 2 door seal loose")], [{ name: "Cook rice", urgent: false }]);
    const m = shiftReminderMessage(shift(), w, "2026-10-14");
    expect(m.title).toBe("Shift at 11:00 today · Eastcote");
    expect(m.body.split("\n")).toEqual([
      "11:00–22:15 · Back of house",
      "Waiting from handover:",
      "• Fridge 2 door seal loose",
      "• Prep to do: 1: Cook rice",
      "Tap to reply: on my way, running late or can't make it.",
    ]);
  });
  it("says nothing about handover when nothing is waiting", () => {
    const m = shiftReminderMessage(shift({ date: "2026-10-15", start: "00:30", end: "06:00", section: "FOH" }), waitingFrom([], []), "2026-10-14");
    expect(m.title).toBe("Shift at 00:30 tomorrow · Eastcote");
    expect(m.body).toBe("00:30–06:00 · Front of house\nTap to reply: on my way, running late or can't make it.");
  });
});

describe("what's been given to someone", () => {
  const t = at("2026-10-14", "08:00");
  const note = (category: string, body: string, assignedTo?: string, over: { needsAction?: boolean; closedAt?: number; createdAt?: number } = {}) =>
    ({ category, body, needsAction: true, createdAt: t, assignedTo, ...over });
  const notes = [
    note("Equipment", "Fridge 3 door not closing properly", "p1"),
    note("Food safety", "Walk-in chiller read 9°C at 15:00, moved stock", "p1", { createdAt: t - 1 }),
    note("Staff note", "Talk to Sam about lateness", "p1"),
    note("Customer complaint", "Mrs Smith 07700 900123 says soup was cold", "p1"),
    note("Customer complaint", "Table 4 waited 40 minutes"),
    note("Other", "Bins out", "p2"),
    note("Other", "Done already", "p1", { closedAt: t + 5 }),
    note("Other", "Just so you know", "p1", { needsAction: false }),
  ];
  const prep = [{ name: "Cook rice", urgent: false, assignedTo: "p1" }, { name: "Soak pho noodles", urgent: true, assignedTo: "p1" }, { name: "Smash ice", urgent: false, assignedTo: "p2" }, { name: "Salad", urgent: false }];

  it("in the Handover tab's order, with staff notes and complaints left to the tablet", () => {
    expect(forYou("p1", prep, notes)).toEqual([
      { kind: "note", text: "Food safety: Walk-in chiller read 9°C at 15:00, moved stock", urgent: true, onTablet: false },
      { kind: "prep", text: "Soak pho noodles", urgent: true, onTablet: false },
      { kind: "note", text: "Fridge 3 door not closing properly", urgent: false, onTablet: false },
      { kind: "note", text: "A staff note", urgent: false, onTablet: true },
      { kind: "note", text: "A customer complaint to follow up", urgent: false, onTablet: true },
      { kind: "prep", text: "Cook rice", urgent: false, onTablet: false },
    ]);
    expect(forYou("p3", prep, notes)).toEqual([]);
    expect(phoneNote({ category: "Something new", body: "Not decided yet" })).toEqual({ text: "A note", onTablet: true });
  });

  it("their reminder starts with it; then only what isn't for anyone in particular", () => {
    const w = waitingFrom(notes, prep);
    const m = shiftReminderMessage(shift({ personId: "p1" }), w, "2026-10-14");
    expect(m.body.split("\n")).toEqual([
      "11:00–22:15 · Back of house",
      "For you: Food safety: Walk-in chiller read 9°C at 15:00, m…, Soak pho noodles (urgent), Fridge 3 door not closing properly +3 more",
      "Also waiting from handover:",
      "• 1 customer complaint to follow up",
      "• Prep to do: 1: Salad",
      "Tap to reply: on my way, running late or can't make it.",
    ]);
    expect(m.body).not.toMatch(/Sam|Smith|07700|Table 4|Bins out|Smash ice/);
  });

  it("what's for someone else is theirs; with nothing for them, the reminder lists the rest", () => {
    const w = waitingFrom(notes, prep);
    const m = shiftReminderMessage(shift({ personId: "p2" }), w, "2026-10-14");
    expect(m.body.split("\n").slice(1, 5)).toEqual(["For you: Bins out, Smash ice", "Also waiting from handover:", "• 1 customer complaint to follow up", "• Prep to do: 1: Salad"]);
    const nobody = shiftReminderMessage(shift({ personId: "p9" }), w, "2026-10-14");
    expect(nobody.body.split("\n").slice(1, 4)).toEqual(["Waiting from handover:", "• 1 customer complaint to follow up", "• Prep to do: 1: Salad"]);
    expect(forYouLine(w, "p9")).toBeUndefined();
    // Without a person (and with nothing given to anyone) the lines are as they always were.
    expect(waitingLines(w)).toContain("• Prep to do: 4 (1 urgent): Soak pho noodles, Cook rice, Smash ice +1 more");
  });

  it("a staff note or complaint for them says to read it on the tablet", () => {
    const w = waitingFrom([note("Staff note", "Talk to Sam", "p1"), note("Customer complaint", "Mrs Smith", "p1")], []);
    expect(forYouLine(w, "p1")).toBe("For you: a staff note (on the tablet), a customer complaint to follow up (on the tablet)");
  });
});

describe("replies", () => {
  const live = { ...shift(), published: true, cancelled: false };
  it("only for your own shift on the rota, from the start of its day until it ends", () => {
    expect(canReply(live, "p2", at("2026-10-14", "10:00"))).toMatchObject({ ok: false, error: "That isn't your shift" });
    expect(canReply({ ...live, published: false }, "p1", at("2026-10-14", "10:00")).ok).toBe(false);
    expect(canReply({ ...live, cancelled: true }, "p1", at("2026-10-14", "10:00")).ok).toBe(false);
    expect(canReply(live, "p1", at("2026-10-13", "23:59"))).toMatchObject({ ok: false, error: "You can reply on the day of the shift" });
    expect(canReply(live, "p1", at("2026-10-14", "00:00")).ok).toBe(true);
    expect(canReply({ ...live, start: "21:00", end: "23:00" }, "p1", at("2026-10-14", "08:30")).ok).toBe(true); // the owner sent reminders early
    expect(canReply(live, "p1", at("2026-10-14", "11:20")).ok).toBe(true);
    expect(canReply(live, "p1", at("2026-10-14", "22:15"))).toMatchObject({ ok: false, error: "That shift has finished" });
    expect(canReply({ ...live, start: "18:00", end: "01:00" }, "p1", at("2026-10-15", "00:30")).ok).toBe(true);
  });
  it("on my way only before the shift starts; late and can't make it still work after", () => {
    const start = shiftStart(live);
    expect(canReply(live, "p1", start - 60_000, "on_my_way").ok).toBe(true);
    expect(canReply(live, "p1", start, "on_my_way")).toMatchObject({ ok: false });
    expect(canReply(live, "p1", start + 60_000, "on_my_way")).toMatchObject({ ok: false, error: ON_MY_WAY_OVER });
    expect(canReply(live, "p1", start + 60_000, "late").ok).toBe(true);
    expect(canReply(live, "p1", start + 60_000, "cant_make_it").ok).toBe(true);
    expect(canSayOnMyWay(live, start - 1)).toBe(true);
    expect(canSayOnMyWay(live, start)).toBe(false);
  });
  it("a shift just after midnight can be answered from its reminder the evening before", () => {
    const early = shift({ date: "2026-10-15", start: "00:30", end: "06:00" });
    expect(replyOpen(early, at("2026-10-14", "22:29"))).toBe(false);
    expect(replyOpen(early, at("2026-10-14", "22:30"))).toBe(true);
  });
  it("late and can't make it go to the site's managers and owners, not the person or other staff", () => {
    const late = replyMessages(reply(), undefined, shift(), "Anh", people, "2026-10-14");
    expect(late.map((m) => m.personId).sort()).toEqual(["mgr", "own"]);
    expect(late[0]).toMatchObject({ title: "Running late: Anh", body: "About 15 min late for today 11:00–22:15 (Back of house) at Eastcote" });
    expect(late.find((m) => m.personId === "own")?.url).toBe("/owner");
    expect(late.find((m) => m.personId === "mgr")?.url).toBe("/today");
    expect(late.map((m) => m.dedupeKey)).toContain("reply|r1|mgr");
    const cant = replyMessages(reply({ kind: "cant_make_it", lateMinutes: undefined }), undefined, shift(), "Anh", people, "2026-10-14");
    expect(cant[0].title).toBe("Can't make it: Anh");
    expect(cant[0].body).toContain("phone you");
  });
  it("on my way is only passed on when it takes back a late or can't-make-it reply", () => {
    const omw = reply({ id: "r2", kind: "on_my_way", lateMinutes: undefined });
    expect(replyMessages(omw, undefined, shift(), "Anh", people, "2026-10-14")).toEqual([]);
    expect(replyMessages(omw, reply({ kind: "on_my_way", lateMinutes: undefined }), shift(), "Anh", people, "2026-10-14")).toEqual([]);
    expect(replyMessages(omw, reply({ kind: "cant_make_it", lateMinutes: undefined }), shift(), "Anh", people, "2026-10-14")[0].title).toBe("Can make it after all: Anh");
    expect(replyMessages(omw, reply(), shift(), "Anh", people, "2026-10-14")[0].title).toBe("On the way: Anh");
  });
  it("a second tap of the same reply is nothing new", () => {
    expect(sameReply(reply(), { kind: "late", lateMinutes: 15 })).toBe(true);
    expect(sameReply(reply(), { kind: "late", lateMinutes: 30 })).toBe(false);
    expect(sameReply(undefined, { kind: "on_my_way" })).toBe(false);
  });
  it("the latest reply counts", () => {
    const m = latestReplies([reply({ id: "b", kind: "on_my_way", lateMinutes: undefined, createdAt: 2 }), reply({ id: "a", createdAt: 1 })]);
    expect(m.get("s1")?.id).toBe("b");
  });
  it("reaches managers at once when the shift is close, otherwise waits out the night", () => {
    expect(replySendAfter(at("2026-10-14", "06:30"), shift({ start: "09:00" }))).toBe(at("2026-10-14", "06:30"));
    expect(replySendAfter(at("2026-10-14", "02:00"), shift({ start: "09:00" }))).toBe(at("2026-10-14", "06:00")); // 3 hours before
    expect(replySendAfter(at("2026-10-14", "00:30"), shift())).toBe(at("2026-10-14", "08:00"));
    expect(replySendAfter(at("2026-10-13", "23:30"), shift())).toBe(at("2026-10-13", "23:30"));
  });
  it("late replies stay at the top of Today until half an hour after the time given; can't make it until the shift ends", () => {
    expect(replyAlertUntil(reply(), shift())).toBe(at("2026-10-14", "11:45"));
    expect(replyAlertUntil(reply({ kind: "cant_make_it", lateMinutes: undefined }), shift())).toBe(at("2026-10-14", "22:15"));
    expect(replyAlertUntil(reply({ kind: "on_my_way", lateMinutes: undefined }), shift())).toBeUndefined();
    expect(replyAlertUntil(undefined, shift())).toBeUndefined();
  });
});

describe("today's team", () => {
  it("lists shifts by site and start, with the reminder, the latest reply and whether notifications are on", () => {
    const shifts = [
      { ...shift({ id: "b", personId: "p2", start: "17:00", section: "FOH" }), name: "Bo" },
      { ...shift({ id: "a" }), name: "Anh" },
      { ...shift({ id: "w", personId: "p3", siteId: "WEM", siteName: "Wembley", start: "07:00", end: "15:00" }), name: "Cy" },
    ];
    const reminded = new Map([[reminderKey(shifts[1]), at("2026-10-14", "09:00")]]);
    const rows = teamDay(shifts, reminded, [reply({ shiftId: "a" }), reply({ id: "r9", shiftId: "a", kind: "on_my_way", lateMinutes: undefined, createdAt: at("2026-10-14", "10:30") })], new Set(["p2"]), at("2026-10-14", "12:00"));
    expect(rows.map((r) => r.shiftId)).toEqual(["a", "b", "w"]);
    expect(rows[0]).toMatchObject({ started: true, ended: false, remindedAt: at("2026-10-14", "09:00"), notificationsOn: false });
    expect(rows[0].reply?.kind).toBe("on_my_way");
    expect(rows[1]).toMatchObject({ started: false, notificationsOn: true, remindedAt: undefined });
  });
});
