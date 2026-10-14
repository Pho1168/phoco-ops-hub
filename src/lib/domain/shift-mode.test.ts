import { describe, expect, it } from "vitest";
import {
  firstUp, laneChoices, laneOf, lanesToday, shiftItems, shiftNow, shiftSummary, windowLabel, type RotaShift, type ShiftInput,
} from "./shift-mode";
import { londonToUtc } from "./time";

const at = londonToUtc;
const D = "2026-10-14";
const rota = (over: Partial<RotaShift> = {}): RotaShift => ({ id: "s1", personId: "minh", siteId: "EAS", section: "BOH", date: D, start: "16:00", end: "23:00", ...over });
const window = { lane: "BOH" as const, date: D, startsAt: at(D, "16:00"), endsAt: at(D, "23:00") };
const base = (over: Partial<ShiftInput> = {}): ShiftInput => ({
  now: at(D, "17:42"), date: D, window, personId: "minh", onTablet: true,
  lists: [], prep: [], notes: [], allergens: [], sops: [], training: { overdue: 0, again: 0 }, kitDown: [], tasks: [], ...over,
});

describe("which lane a rota section is", () => {
  it("reads the app's sections and a few spellings a sheet might use", () => {
    expect(laneOf("BOH")).toBe("BOH");
    expect(laneOf(" foh ")).toBe("FOH");
    expect(laneOf("Prod")).toBe("PROD");
    expect(laneOf("Kitchen")).toBe("BOH");
    expect(laneOf("Front of house")).toBe("FOH");
  });
  it("falls back to the person's own section, else nothing", () => {
    expect(laneOf("Floor", ["FOH"])).toBe("FOH");
    expect(laneOf("Floor")).toBeUndefined();
  });
});

describe("the shift to show now", () => {
  const shifts = [rota(), rota({ id: "s2", personId: "lin", section: "FOH", start: "11:00", end: "15:30" }), rota({ id: "s3", personId: "minh", siteId: "WEM", section: "PROD", start: "06:00", end: "14:00" })];
  it("is the one running", () => {
    expect(shiftNow(shifts, "minh", D, at(D, "17:42"), "EAS")?.id).toBe("s1");
    expect(shiftNow(shifts, "minh", D, at(D, "17:42"), "EAS")?.lane).toBe("BOH");
  });
  it("is the next one today before it starts, and nothing once it's long over", () => {
    expect(shiftNow(shifts, "minh", D, at(D, "09:00"), "EAS")?.id).toBe("s1");
    expect(shiftNow(shifts, "lin", D, at(D, "15:50"), "EAS")?.id).toBe("s2"); // 20 minutes after: still writing the handover
    expect(shiftNow(shifts, "lin", D, at(D, "17:00"), "EAS")).toBeUndefined();
  });
  it("on a tablet only that site's shifts count; on a phone any site's", () => {
    expect(shiftNow(shifts, "minh", D, at(D, "10:00"), "EAS")?.id).toBe("s1");
    expect(shiftNow(shifts, "minh", D, at(D, "10:00"))?.id).toBe("s3"); // Wembley, running now
  });
  it("a shift over midnight still shows after midnight, and one with an unknown section uses the person's own", () => {
    const late = [rota({ start: "18:00", end: "01:00" })];
    expect(shiftNow(late, "minh", "2026-10-15", at("2026-10-15", "00:30"), "EAS")?.id).toBe("s1");
    expect(shiftNow([rota({ section: "Floor" })], "minh", D, at(D, "17:00"), "EAS", ["FOH"])?.lane).toBe("FOH");
    expect(shiftNow([rota({ section: "Floor" })], "minh", D, at(D, "17:00"), "EAS")).toBeUndefined();
  });
});

describe("picking a lane when not on the rota", () => {
  const site = { id: "EAS" as const, kind: "restaurant" as const };
  it("offers staff their own sections and a manager with none the site's", () => {
    expect(laneChoices({ access: [{ siteId: "EAS", role: "staff", sections: ["BOH"] }] }, site)).toEqual(["BOH"]);
    expect(laneChoices({ access: [{ siteId: "EAS", role: "manager", sections: [] }] }, site)).toEqual(["FOH", "BOH"]);
    expect(laneChoices({ access: [{ siteId: "WEM", role: "owner", sections: [] }] }, { id: "WEM", kind: "production" })).toEqual(["PROD"]);
    expect(laneChoices({ access: [{ siteId: "EAS", role: "staff", sections: [] }] }, site)).toEqual([]);
    expect(laneChoices({ access: [{ siteId: "WEM", role: "staff", sections: ["PROD"] }] }, site)).toEqual([]);
  });
});

describe("what's on a kitchen shift", () => {
  const lists = [
    { id: "open", name: "Opening checks", area: "BOH" as const, due: "11:00", signedAt: at(D, "10:52"), signedByName: "Sofia", answered: 12, total: 12 },
    { id: "hot", name: "Hot hold temps", area: "BOH" as const, due: "17:30", answered: 0, total: 3 },
    { id: "oil", name: "Fryer oil", area: "BOH" as const, due: "18:00", answered: 1, total: 4 },
    { id: "fridge", name: "Fridge temps (pm)", area: "BOH" as const, due: "21:00", answered: 0, total: 6 },
    { id: "close", name: "Closing checks", area: "FOH" as const, due: "23:00", answered: 0, total: 8 },
    { id: "weekly", name: "Weekly deep clean", area: "BOH" as const, answered: 0, total: 5 },
  ];
  it("keeps the lane's checks due this shift, an overdue one from earlier, and no front-of-house ones", () => {
    const items = shiftItems(base({ lists: [...lists, { id: "lunch", name: "Lunch temps", area: "BOH", due: "13:30", answered: 0, total: 3 }] }));
    const checks = items.filter((i) => i.kind === "check").map((i) => `${i.id}:${i.state}`);
    expect(checks).toEqual(["lunch:late", "hot:late", "oil:now", "fridge:later", "weekly:whenever"]);
    expect(items.some((i) => i.id === "close")).toBe(false); // front of house
    expect(items.some((i) => i.id === "open")).toBe(false); // signed, before the shift
  });
  it("counts a signed check in the shift as done, with who signed it", () => {
    const items = shiftItems(base({ lists: [{ ...lists[1], signedAt: at(D, "17:35"), signedByName: "Minh", answered: 3 }] }));
    expect(items[0]).toMatchObject({ id: "hot", state: "done", detail: "Signed 17:35 · Minh", doneBy: "Minh" });
  });
  it("shows the whole prep list to the kitchen, theirs first, and only theirs to front of house", () => {
    const prep = [{ id: "a", name: "Pickles", urgent: false, assignedTo: "lin", assignedToName: "Lin" }, { id: "b", name: "Fish sauce", urgent: false, assignedTo: "minh", assignedToName: "Minh" }, { id: "c", name: "Cook rice", urgent: true }];
    const kitchen = shiftItems(base({ prep })).filter((i) => i.kind === "prep");
    expect(kitchen.map((i) => `${i.id}:${i.state}`)).toEqual(["c:now", "b:whenever", "a:whenever"]);
    expect(kitchen[1].detail).toBe("For you");
    expect(kitchen[2]).toMatchObject({ forName: "Lin", detail: "For Lin" });
    const front = shiftItems(base({ prep, window: { ...window, lane: "FOH" } })).filter((i) => i.kind === "prep");
    expect(front.map((i) => i.id)).toEqual(["b"]); // Minh's own, nothing else
    expect(shiftItems(base({ prep, personId: "dan", window: { ...window, lane: "FOH" } })).filter((i) => i.kind === "prep").map((i) => i.id)).toEqual([]);
  });
  it("shows notes for them and for nobody in particular; a manager's lane shows everyone's", () => {
    const notes = [
      { id: "n1", category: "Food safety", body: "Walk-in door seal split", needsAction: true, assignedTo: undefined },
      { id: "n2", category: "Other", body: "Marinade short", needsAction: true, assignedTo: "minh", assignedToName: "Minh" },
      { id: "n3", category: "Other", body: "Call the fish supplier", needsAction: true, assignedTo: "sofia", assignedToName: "Sofia" },
      { id: "n4", category: "Other", body: "Done one", needsAction: true, closedAt: at(D, "12:00") },
      { id: "n5", category: "Staff note", body: "Info only", needsAction: false },
    ];
    const mine = shiftItems(base({ notes })).filter((i) => i.kind === "note");
    expect(mine.map((i) => i.id)).toEqual(["n1", "n2"]);
    expect(mine[0]).toMatchObject({ urgent: true, state: "whenever" });
    const lane = shiftItems(base({ notes, personId: undefined })).filter((i) => i.kind === "note");
    expect(lane.map((i) => i.id)).toEqual(["n1", "n2", "n3"]);
    expect(lane[2].forName).toBe("Sofia");
  });
  it("keeps complaint details and staff notes off a phone", () => {
    const notes = [{ id: "c", category: "Customer complaint", body: "Table 6 said the broth was cold", needsAction: true }];
    expect(shiftItems(base({ notes, onTablet: false })).find((i) => i.kind === "note")).toMatchObject({ title: "A customer complaint to follow up", onTablet: true });
    expect(shiftItems(base({ notes, onTablet: true })).find((i) => i.kind === "note")).toMatchObject({ title: "Table 6 said the broth was cold", onTablet: false });
  });
  it("adds allergen changes, SOPs to read and training as things to do whenever", () => {
    const items = shiftItems(base({ allergens: [{ id: "d1", title: "Papaya Salad" }], sops: [{ id: "s9", title: "Fryer isolation" }], training: { overdue: 1, again: 0 } }));
    expect(items.map((i) => `${i.kind}:${i.state}:${i.urgent}`)).toEqual(["allergen:whenever:true", "training:whenever:true", "sop:whenever:false"]);
    expect(items[0].href).toBe("/library/allergens/d1");
  });
  it("puts the gas check at close for closers only, and ready to open on morning shifts only", () => {
    const gas = { state: "due" as const, closeAt: at(D, "23:00"), closer: true };
    expect(shiftItems(base({ gas })).find((i) => i.kind === "gas")).toMatchObject({ state: "now", when: "at close" });
    expect(shiftItems(base({ gas: { ...gas, closer: false } })).some((i) => i.kind === "gas")).toBe(false);
    expect(shiftItems(base({ gas: { ...gas, closer: false }, personId: undefined })).some((i) => i.kind === "gas")).toBe(true); // a manager's lane
    expect(shiftItems(base({ gas: { ...gas, state: "done", doneBy: "Minh", doneAt: at(D, "23:05") }, now: at(D, "23:10") })).find((i) => i.kind === "gas")).toMatchObject({ state: "done", detail: "Checked by Minh at 23:05" });
    const ready = { light: "amber" as const, readyBy: "12:00", headline: "2 checks to sign" };
    expect(shiftItems(base({ ready })).some((i) => i.kind === "ready")).toBe(false); // an evening shift
    const morning = { ...window, startsAt: at(D, "10:00"), endsAt: at(D, "16:00") };
    expect(shiftItems(base({ ready, window: morning, now: at(D, "11:30") })).find((i) => i.kind === "ready")).toMatchObject({ state: "now", when: "by 12:00" });
    expect(shiftItems(base({ ready: { ...ready, light: "red" }, window: morning, now: at(D, "12:10") })).find((i) => i.kind === "ready")?.state).toBe("late");
    expect(shiftItems(base({ ready: { ...ready, light: "green" }, window: morning, now: at(D, "11:30") })).find((i) => i.kind === "ready")?.state).toBe("done");
  });
  it("orders late, now, later by time, whenever, then done; kit that's down sits with now", () => {
    const items = shiftItems(base({
      lists: [lists[1], lists[2], lists[3], { ...lists[0], due: "16:30", signedAt: at(D, "16:20") }],
      kitDown: [{ id: "fr2", name: "Fryer 2", body: "Not heating", since: at(D, "17:21") }],
      prep: [{ id: "p", name: "Fish sauce", urgent: false }],
      tasks: [{ id: "t1", title: "Call the engineer", priority: 1, dueOn: D }],
    }));
    expect(items.map((i) => `${i.kind}:${i.id}:${i.state}`)).toEqual([
      "check:hot:late", "kit:fr2:now", "task:t1:now", "check:oil:now", "check:fridge:later", "prep:p:whenever", "check:open:done",
    ]);
    expect(shiftSummary(items)).toEqual({ done: 1, late: 1, toCome: 5 });
    expect(firstUp(items)?.id).toBe("hot");
    expect(firstUp(items.filter((i) => i.state !== "late"))?.id).toBe("fr2");
  });
});

describe("a manager's lanes", () => {
  const shifts = [
    { ...rota({ id: "a", personId: "minh", section: "BOH", start: "16:00", end: "23:00" }), name: "Minh" },
    { ...rota({ id: "b", personId: "lin", section: "BOH", start: "11:00", end: "19:00" }), name: "Lin" },
    { ...rota({ id: "c", personId: "dan", section: "FOH", start: "16:00", end: "23:30" }), name: "Daniel" },
    { ...rota({ id: "d", personId: "hanh", siteId: "WEM", section: "PROD", start: "06:00", end: "14:00" }), name: "Hanh" },
    { ...rota({ id: "e", personId: "old", section: "BOH", date: "2026-10-13", start: "16:00", end: "23:00" }), name: "Yesterday" },
  ];
  it("has a lane per section with people on at the site today, front of house first, spanning their shifts", () => {
    const lanes = lanesToday(shifts, "EAS", D, at(D, "17:42"));
    expect(lanes.map((l) => l.lane)).toEqual(["FOH", "BOH"]);
    expect(lanes[1].on.map((p) => p.name)).toEqual(["Lin", "Minh"]);
    expect(windowLabel(lanes[1])).toBe("11:00–23:00");
    expect(lanesToday(shifts, "WEM", D, at(D, "10:00")).map((l) => l.lane)).toEqual(["PROD"]);
    expect(lanesToday(shifts, "SYD", D, at(D, "10:00"))).toEqual([]);
  });
});
