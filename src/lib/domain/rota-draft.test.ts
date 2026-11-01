import { describe, expect, it } from "vitest";
import { availableFor, candidatesFor, draftRota, peopleOnDays, sheetRows, shiftHours, slotsFromTemplate, type DraftInput, type DraftPerson, type TemplateShift } from "./rota-draft";
import type { AvailDay } from "./availability";

const WEEK = "2026-11-09"; // Monday
const LAST = "2026-11-02";
const p = (id: string, sections: ("FOH" | "BOH")[]): DraftPerson => ({ id, name: id[0].toUpperCase() + id.slice(1), sections });
const all = (a: AvailDay["a"] = "all"): AvailDay[] => Array.from({ length: 7 }, () => ({ a }));
const day = (date: string, section: string, start: string, end: string, personId?: string): TemplateShift => ({ date, section, start, end, personId });

const people = [p("ann", ["FOH"]), p("bob", ["FOH"]), p("cat", ["BOH"]), p("dan", ["BOH"]), p("eve", ["FOH", "BOH"]), p("fay", ["BOH"]), p("gus", ["FOH"])];
const input = (over: Partial<DraftInput> = {}): DraftInput => ({
  siteId: "CLV", week: WEEK, people, busy: [], weekendMin: 6,
  template: [
    day("2026-11-02", "FOH", "11:00", "22:15", "ann"), day("2026-11-02", "BOH", "11:00", "22:15", "cat"),
    day("2026-11-07", "FOH", "11:00", "22:15", "ann"), day("2026-11-07", "FOH", "16:30", "22:15", "bob"), day("2026-11-07", "BOH", "11:00", "22:15", "cat"),
  ],
  availability: new Map(people.map((x) => [x.id, all()])),
  ...over,
});

describe("drafting next week's rota", () => {
  it("paid hours take an hour's break off; morning and evening answers match the shift's times", () => {
    expect(shiftHours("11:00", "22:15")).toBe(10.25);
    expect(shiftHours("16:30", "22:15")).toBe(4.75);
    expect(shiftHours("22:00", "02:00")).toBe(3);
    expect(availableFor({ a: "all" }, "11:00", "22:15")).toBe(true);
    expect(availableFor({ a: "am" }, "11:00", "15:00")).toBe(true);
    expect(availableFor({ a: "am" }, "11:00", "22:15")).toBe(false);
    expect(availableFor({ a: "pm" }, "16:30", "22:15")).toBe(true);
    expect(availableFor({ a: "pm" }, "11:00", "22:15")).toBe(false);
    expect(availableFor({ a: "off" }, "11:00", "15:00")).toBe(false);
    expect(availableFor(undefined, "11:00", "15:00")).toBe(false);
  });

  it("copies last week's shape onto next week, same weekday, and remembers who had each shift", () => {
    const slots = slotsFromTemplate(WEEK, input().template, people);
    expect(slots.map((s) => `${s.day} ${s.date} ${s.section} ${s.start}`)).toEqual([
      "0 2026-11-09 BOH 11:00", "0 2026-11-09 FOH 11:00", "5 2026-11-14 BOH 11:00", "5 2026-11-14 FOH 11:00", "5 2026-11-14 FOH 16:30",
    ]);
    expect(slots.find((s) => s.day === 5 && s.start === "16:30")?.wasPersonId).toBe("bob");
    expect(slotsFromTemplate(WEEK, [day(LAST, "FOH", "11:00", "22:15", "left")], people)[0].wasPersonId).toBeUndefined();
  });

  it("keeps people on their usual shift when they can, fills the rest fairly, and tops Saturday up to six people", () => {
    const d = draftRota(input());
    const who = (dayN: number, start: string, section: string) => people.find((x) => x.id === d.fills.get(d.slots.find((s) => s.day === dayN && s.start === start && s.section === section)!.id))?.name;
    expect(who(0, "11:00", "FOH")).toBe("Ann");
    expect(who(0, "11:00", "BOH")).toBe("Cat");
    expect(who(5, "16:30", "FOH")).toBe("Bob");
    // Saturday had 3 shifts (2 FOH, 1 BOH); three more were added, spread across the sections, until 6 people were on.
    expect(peopleOnDays(d.slots, d.fills)[5]).toBe(6);
    expect(d.slots.filter((s) => s.added).map((s) => `${s.section} ${s.start}`).sort()).toEqual(["BOH 11:00", "BOH 11:00", "FOH 11:00"]);
    expect(d.gaps).toEqual([]);
    // Monday isn't a weekend day: left as last week.
    expect(peopleOnDays(d.slots, d.fills)[0]).toBe(2);
  });

  it("leaves a gap, with why, when nobody fits; someone who didn't answer isn't put on", () => {
    const availability = new Map(people.map((x) => [x.id, all()]));
    availability.set("cat", all("off"));
    availability.set("dan", all("am"));
    availability.delete("fay");
    const d = draftRota(input({ availability, people: people.filter((x) => x.id !== "eve") }));
    const monBoh = d.slots.find((s) => s.day === 0 && s.section === "BOH")!;
    expect(d.fills.has(monBoh.id)).toBe(false);
    expect(d.gaps.find((g) => g.slotId === monBoh.id)?.reason).toBe("1 said off, 1 said morning only, 1 didn't send availability");
    expect(d.noAnswer.map((x) => x.id)).toEqual(["fay"]);
  });

  it("never puts someone on twice in a day, or on a day they're busy elsewhere or off", () => {
    const d = draftRota(input({
      template: [day("2026-11-02", "FOH", "11:00", "16:00", "ann"), day("2026-11-02", "FOH", "16:00", "22:15", "ann")],
      people: [p("ann", ["FOH"])],
      busy: [{ personId: "ann", date: "2026-11-10", why: "Eastcote 11:00–22:15" }],
    }));
    expect(d.fills.size).toBe(1); // Ann once on Monday, the second shift a gap
    expect(d.gaps[0].reason).toBe("1 already on 11:00–16:00");
    const d2 = draftRota(input({ template: [day("2026-11-03", "FOH", "11:00", "16:00", "ann")], people: [p("ann", ["FOH"])], busy: [{ personId: "ann", date: "2026-11-10", why: "Eastcote 11:00–22:15" }] }));
    expect(d2.gaps[0].reason).toBe("1 Eastcote 11:00–22:15");
  });

  it("offers swap candidates who fit, and lays the draft out like the sheet", () => {
    const d = draftRota(input());
    const mon = d.slots.find((s) => s.day === 0 && s.section === "FOH")!;
    const { fit, unfit } = candidatesFor({ input: input(), slots: d.slots, fills: d.fills, hours: d.hours }, mon);
    expect(fit.map((x) => x.id)).toEqual(["ann", "bob", "eve", "gus"]);
    expect(unfit.find((u) => u.person.id === "cat")?.why).toBe("not FOH");
    const rows = sheetRows(d, people);
    expect(rows[0]).toMatchObject({ name: "Ann", section: "FOH", hours: 20.5 });
    expect(rows[0].days[0]).toBe("11:00–22:15");
    expect(rows[0].days[1]).toBe("");
    expect(rows.every((r) => r.hours > 0)).toBe(true);
  });
});
