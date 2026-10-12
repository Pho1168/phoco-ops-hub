import { describe, expect, it } from "vitest";
import {
  dailyDigest, dayLine, gasConfirmedMessages, gasDay, gasMessages, gasState, lastCloseDay, notReadyMessages, openGasDay, readyHeadline, readyShownUntil, readyToOpen,
  type DayFacts, type ReadyInput,
} from "./daily";
import { londonToUtc } from "./time";
import type { Person } from "./types";

const at = londonToUtc;
const base = (over: Partial<ReadyInput> = {}): ReadyInput => ({
  date: "2026-10-14", readyBy: "12:00", now: at("2026-10-14", "11:00"),
  lists: [
    { name: "BOH Opening", due: "11:00", signed: true },
    { name: "FOH Opening", due: "11:30", signed: false },
    { name: "Cooking Temps", due: "12:00", signed: false },
    { name: "BOH Closing", due: "22:30", signed: false },
    { name: "Toilet Check", signed: false },
  ],
  kitDown: [], alerts: [], team: [], ...over,
});
const person = (id: string, name: string, access: Person["access"], status: Person["status"] = "active") => ({ id, name, status, access });
const people = [
  person("own", "Owner", [{ siteId: "EAS", role: "owner", sections: [] }, { siteId: "WEM", role: "owner", sections: [] }]),
  person("mgr", "Mia", [{ siteId: "EAS", role: "manager", sections: ["FOH", "BOH"] }]),
  person("wem", "Wes", [{ siteId: "WEM", role: "manager", sections: ["PROD"] }]),
  person("old", "Ola", [{ siteId: "EAS", role: "manager", sections: [] }], "left"),
  person("a", "Anh", [{ siteId: "EAS", role: "staff", sections: ["BOH"] }]),
  person("b", "Bo", [{ siteId: "EAS", role: "staff", sections: ["FOH"] }]),
];

describe("ready to open", () => {
  it("before the ready time, opening checks still to sign are amber; checklists due later or without a time don't count", () => {
    const r = readyToOpen(base());
    expect(r).toMatchObject({ light: "amber", signed: 1, total: 3, past: false });
    expect(r.reasons).toEqual([{ level: "amber", text: "Still to sign: FOH Opening and Cooking Temps" }]);
    expect(readyHeadline(r)).toBe("Getting ready for 12:00 · 1 of 3 opening checks signed");
  });
  it("from the ready time, unsigned opening checks are red", () => {
    const r = readyToOpen(base({ now: at("2026-10-14", "12:00") }));
    expect(r.light).toBe("red");
    expect(r.reasons[0]).toEqual({ level: "red", text: "Not signed: FOH Opening and Cooking Temps" });
    expect(readyHeadline(r)).toBe("Not ready at 12:00");
  });
  it("green when the opening checks are signed and nothing is in the way", () => {
    const signed = base().lists.map((l) => ({ ...l, signed: l.due ? l.due <= "12:00" : false }));
    const r = readyToOpen(base({ lists: signed }));
    expect(r).toMatchObject({ light: "green", reasons: [] });
    expect(readyHeadline(r)).toBe("Ready to open · 3 opening checks signed");
  });
  it("food-safety kit down or a critical alert is red at any time; other kit, warnings and people late are amber", () => {
    const signed = base().lists.map((l) => ({ ...l, signed: true }));
    expect(readyToOpen(base({ lists: signed, kitDown: [{ name: "Walk-in fridge", foodSafety: true }] })).light).toBe("red");
    expect(readyToOpen(base({ lists: signed, alerts: [{ title: "Fridge 2 at 9.2°C", critical: true }] })).light).toBe("red");
    const r = readyToOpen(base({ lists: signed, kitDown: [{ name: "Glasswasher", foodSafety: false }], alerts: [{ title: "Freezer at -15°C", critical: false }],
      team: [{ name: "Anh", start: "11:00", reply: { kind: "cant_make_it" } }, { name: "Bo", start: "11:30", reply: { kind: "late", lateMinutes: 15 } }, { name: "Cy", start: "11:00", reply: { kind: "on_my_way" } }] }));
    expect(r.light).toBe("amber");
    expect(r.reasons.map((x) => x.text)).toEqual(["Not working: Glasswasher", "Open alert: Freezer at -15°C", "Anh can't make it (11:00)", "Bo about 15 min late (11:30)"]);
  });
  it("judged as at the ready time: kit, alerts and replies that came later don't count", () => {
    const signed = base().lists.map((l) => ({ ...l, signed: true }));
    const asOf = at("2026-10-14", "12:00");
    const r = readyToOpen(base({ now: at("2026-10-14", "12:25"), asOf, lists: signed,
      kitDown: [{ name: "Walk-in fridge", foodSafety: true, since: at("2026-10-14", "12:20") }, { name: "Glasswasher", foodSafety: false, since: at("2026-10-14", "09:00") }],
      alerts: [{ title: "Fridge 2 at 9.2°C", critical: true, createdAt: at("2026-10-14", "12:10") }],
      team: [{ name: "Anh", start: "11:00", reply: { kind: "cant_make_it", createdAt: at("2026-10-14", "12:01") } }] }));
    expect(r.light).toBe("amber");
    expect(r.reasons.map((x) => x.text)).toEqual(["Not working: Glasswasher"]);
    expect(readyHeadline(r)).toBe("Ready, with things to sort");
  });
  it("is shown until an hour after the ready time", () => {
    expect(readyShownUntil("2026-10-14", "12:00")).toBe(at("2026-10-14", "13:00"));
  });
  it("red reasons come first", () => {
    const r = readyToOpen(base({ now: at("2026-10-14", "12:30"), kitDown: [{ name: "Glasswasher", foodSafety: false }, { name: "Probe", foodSafety: true }] }));
    expect(r.reasons.map((x) => x.level)).toEqual(["red", "red", "amber"]);
  });
  it("only a red light at the ready time tells the site's managers and owners, once a day each", () => {
    const site = { id: "EAS" as const, name: "Eastcote" };
    expect(notReadyMessages(site, "2026-10-14", readyToOpen(base()), people)).toEqual([]); // before the time
    const signedExceptKit = readyToOpen(base({ now: at("2026-10-14", "12:05"), lists: base().lists.map((l) => ({ ...l, signed: true })), kitDown: [{ name: "Glasswasher", foodSafety: false }] }));
    expect(notReadyMessages(site, "2026-10-14", signedExceptKit, people)).toEqual([]); // amber: no message
    const m = notReadyMessages(site, "2026-10-14", readyToOpen(base({ now: at("2026-10-14", "12:05") })), people);
    expect(m.map((x) => x.personId).sort()).toEqual(["mgr", "own"]);
    expect(m[0]).toMatchObject({ title: "Eastcote not ready to open (12:00)", body: "Not signed: FOH Opening and Cooking Temps" });
    expect(m.find((x) => x.personId === "own")).toMatchObject({ url: "/owner", dedupeKey: "ready|EAS|2026-10-14|own" });
    expect(m.find((x) => x.personId === "mgr")?.url).toBe("/today");
  });
});

describe("gas off at close", () => {
  const sh = (personId: string, start: string, end: string, date = "2026-10-14", siteId: "EAS" | "WEM" = "EAS") => ({ personId, siteId, date, start, end });
  const shifts = [sh("a", "11:00", "22:15"), sh("b", "17:00", "22:00"), sh("c", "11:00", "15:00"), sh("w", "07:00", "15:00", "2026-10-14", "WEM")];

  it("closes when the last shift ends; the closers are everyone finishing within 30 minutes of it", () => {
    const d = gasDay("EAS", "2026-10-14", shifts)!;
    expect(d.closeAt).toBe(at("2026-10-14", "22:15"));
    expect(d.closers.sort()).toEqual(["a", "b"]);
    expect(gasDay("EAS", "2026-10-15", shifts)).toBeUndefined(); // no rota that day: nothing expected
  });
  it("someone who said they can't make the closing shift isn't asked", () => {
    const withIds = shifts.map((x, i) => ({ ...x, id: `s${i}` }));
    expect(gasDay("EAS", "2026-10-14", withIds, new Set(["s1"]))!.closers).toEqual(["a"]);
  });
  it("the last close is the latest one whose window is over", () => {
    const d13 = gasDay("EAS", "2026-10-13", [sh("a", "11:00", "22:15", "2026-10-13")])!;
    const d14 = gasDay("EAS", "2026-10-14", [sh("a", "09:00", "15:00")])!;
    expect(lastCloseDay([d13, d14], at("2026-10-14", "20:59"))?.date).toBe("2026-10-13"); // today's window open until 21:00
    expect(lastCloseDay([d13, d14], at("2026-10-14", "21:00"))?.date).toBe("2026-10-14");
    const late = gasDay("EAS", "2026-10-14", [sh("a", "18:00", "00:30")])!;
    expect(lastCloseDay([d13, late], at("2026-10-15", "00:10"))?.date).toBe("2026-10-13"); // tonight's close hasn't happened
  });
  it("a close after midnight belongs to the day the shift started", () => {
    const d = gasDay("EAS", "2026-10-14", [sh("a", "18:00", "00:30")])!;
    expect(d.closeAt).toBe(at("2026-10-15", "00:30"));
    expect(openGasDay([gasDay("EAS", "2026-10-15", []), d], at("2026-10-15", "00:40"))?.date).toBe("2026-10-14");
  });
  it("goes from later to due (15 min before) to overdue (30 min after) to missed (6 hours after); done once tapped", () => {
    const d = gasDay("EAS", "2026-10-14", shifts)!;
    expect(gasState(d, undefined, at("2026-10-14", "21:59"))).toBe("later");
    expect(gasState(d, undefined, at("2026-10-14", "22:00"))).toBe("due");
    expect(gasState(d, undefined, at("2026-10-14", "22:44"))).toBe("due");
    expect(gasState(d, undefined, at("2026-10-14", "22:45"))).toBe("overdue");
    expect(gasState(d, undefined, at("2026-10-15", "04:15"))).toBe("missed");
    expect(gasState(d, at("2026-10-14", "22:20"), at("2026-10-14", "23:00"))).toBe("done");
    expect(openGasDay([d], at("2026-10-14", "21:59"))).toBeUndefined();
    expect(openGasDay([d], at("2026-10-14", "22:00"))).toBe(d);
  });
  it("reminds the closers, then alerts the site's managers and owners with who was closing", () => {
    const site = { id: "EAS" as const, name: "Eastcote" };
    const d = gasDay("EAS", "2026-10-14", shifts)!;
    const due = gasMessages(site, d, "due", people, at("2026-10-14", "22:00"));
    expect(due.map((m) => m.personId).sort()).toEqual(["a", "b"]);
    expect(due[0]).toMatchObject({ kind: "reminder", title: "Gas check before you leave · Eastcote", url: "/me" });
    expect(due.map((m) => m.dedupeKey)).toContain("gas|EAS|2026-10-14|a");
    const late = gasMessages(site, d, "overdue", people, at("2026-10-14", "22:45"));
    expect(late.map((m) => m.personId).sort()).toEqual(["mgr", "own"]);
    expect(late[0]).toMatchObject({ kind: "alert", title: "No gas-off check at Eastcote" });
    expect(late[0].body).toBe("The last shift ended at 22:15 and nobody has confirmed the gas is off. Closing: Anh and Bo.");
    expect(gasMessages(site, d, "later", people, at("2026-10-14", "21:00"))).toEqual([]);
    expect(gasMessages(site, d, "done", people, at("2026-10-14", "22:50"))).toEqual([]);
  });
  it("after an alert, those alerted hear when it's done and how", () => {
    const d = gasDay("EAS", "2026-10-14", shifts)!;
    const m = gasConfirmedMessages({ id: "EAS", name: "Eastcote" }, d, "Anh", true, at("2026-10-14", "22:52"), ["mgr"]);
    expect(m).toEqual([{ personId: "mgr", title: "Gas off at Eastcote", body: "Confirmed by Anh at 22:52 on the tablet.", dedupeKey: "gasok|EAS|2026-10-14|mgr", url: "/today" }]);
  });
});

describe("yesterday at a glance", () => {
  const facts = (over: Partial<DayFacts> = {}): DayFacts => ({
    siteName: "Eastcote", onRota: true, checks: { expected: 12, signed: 11, missed: ["BOH Cleaning"] }, outOfRange: 1, alertsRaised: 1,
    faults: { reported: 1, fixed: 0, stillDown: ["Fryer 2"] }, notesLeft: 2, tasksOverdue: 0,
    gas: { byName: "Anh", at: at("2026-10-13", "22:21"), onTablet: true }, late: 1, cantMakeIt: 0, ...over,
  });
  it("one line per site, most important first", () => {
    expect(dayLine(facts())).toBe("Eastcote: 11/12 checks signed (missed: BOH Cleaning) · 1 temperature out of range · 1 alert · Fryer 2 still not working · 1 fault reported · 1 late · 2 handover notes · gas off ✓ Anh 22:21");
  });
  it("a missing gas check leads the line, but only on a day the site was on the rota", () => {
    expect(dayLine(facts({ gas: undefined })).startsWith("Eastcote: NO gas-off check · ")).toBe(true);
    expect(dayLine(facts({ gas: undefined, onRota: false }))).not.toContain("gas");
  });
  it("a quiet day says so", () => {
    expect(dayLine({ siteName: "Wembley", onRota: false, checks: { expected: 0, signed: 0, missed: [] }, outOfRange: 0, alertsRaised: 0, faults: { reported: 0, fixed: 0, stillDown: [] }, notesLeft: 0, tasksOverdue: 0, late: 0, cantMakeIt: 0 }))
      .toBe("Wembley: a quiet day");
  });
  it("titled with the day, pointing to the records", () => {
    const d = dailyDigest("2026-10-13", [facts()]);
    expect(d.title).toBe("Yesterday at a glance: Tue 13 Oct");
    expect(d.body.endsWith("Details: Manage → Records.")).toBe(true);
  });
});
