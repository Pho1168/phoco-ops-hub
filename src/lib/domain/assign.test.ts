import { describe, expect, it } from "vitest";
import { canBeGiven, forLabel, nextPeriod, periodAt, periodBounds, periodLabel, pickList, pickPeriod, targetPeriod, worksIn } from "./assign";
import { londonToUtc } from "./time";
import type { Person } from "./types";

const at = londonToUtc;
// Tue 13 Oct 2026. Shifts as the rota import stores them: a London date and wall-clock times.
const s = (date: string, start: string, end: string, personId = "p1") => ({ date, start, end, personId });
const TUE = "2026-10-13", WED = "2026-10-14", THU = "2026-10-15";

describe("the shift a handover is for", () => {
  it("a morning runs to 15:00 and an evening on to 05:00, so a late close is still that evening", () => {
    expect(periodAt(at(TUE, "10:00"))).toEqual({ date: TUE, part: "am" });
    expect(periodAt(at(TUE, "14:59"))).toEqual({ date: TUE, part: "am" });
    expect(periodAt(at(TUE, "15:00"))).toEqual({ date: TUE, part: "pm" });
    expect(periodAt(at(TUE, "23:30"))).toEqual({ date: TUE, part: "pm" });
    expect(periodAt(at(WED, "00:30"))).toEqual({ date: TUE, part: "pm" });
    expect(periodAt(at(WED, "04:59"))).toEqual({ date: TUE, part: "pm" });
    expect(periodAt(at(WED, "05:00"))).toEqual({ date: WED, part: "am" });
    expect(periodBounds({ date: TUE, part: "pm" })).toEqual([at(TUE, "15:00"), at(WED, "05:00")]);
    expect(nextPeriod({ date: TUE, part: "pm" })).toEqual({ date: WED, part: "am" });
  });

  it("someone works it when their shift covers at least an hour of it", () => {
    const am = { date: TUE, part: "am" as const }, pm = { date: TUE, part: "pm" as const };
    expect([worksIn(s(TUE, "11:00", "22:15"), am), worksIn(s(TUE, "11:00", "22:15"), pm)]).toEqual([true, true]);
    expect([worksIn(s(TUE, "11:00", "15:30"), am), worksIn(s(TUE, "11:00", "15:30"), pm)]).toEqual([true, false]);
    expect([worksIn(s(TUE, "14:30", "22:15"), am), worksIn(s(TUE, "14:30", "22:15"), pm)]).toEqual([false, true]);
    expect(worksIn(s(TUE, "18:00", "01:00"), pm)).toBe(true);
    expect(worksIn(s(TUE, "11:00", "22:15"), { date: WED, part: "am" })).toBe(false);
  });

  it("next shift: where the next person on the rota starts, skipping days the site is shut", () => {
    const allDay = [s(TUE, "11:00", "22:15"), s(WED, "11:00", "22:15"), s(THU, "11:00", "22:15")];
    expect(targetPeriod("next", at(TUE, "22:30"), allDay)).toEqual({ date: WED, part: "am" });
    // Mid-afternoon with only all-day shifts: nobody new starts until tomorrow.
    expect(targetPeriod("next", at(TUE, "14:45"), allDay)).toEqual({ date: WED, part: "am" });
    // An evening shift starting later today is the next shift.
    expect(targetPeriod("next", at(TUE, "14:45"), [...allDay, s(TUE, "17:00", "22:15", "p2")])).toEqual({ date: TUE, part: "pm" });
    expect(targetPeriod("next", at(TUE, "22:30"), [s(THU, "11:00", "22:15")])).toEqual({ date: THU, part: "am" });
    // No rota: the shift after this one.
    expect(targetPeriod("next", at(TUE, "22:30"), [])).toEqual({ date: WED, part: "am" });
    expect(targetPeriod("next", at(TUE, "22:30"), [s("2026-10-23", "11:00", "22:15")])).toEqual({ date: WED, part: "am" });
  });

  it("tomorrow is the day after the one it was written on, even after midnight", () => {
    expect(targetPeriod("tomorrow_am", at(TUE, "22:30"), [])).toEqual({ date: WED, part: "am" });
    expect(targetPeriod("tomorrow_pm", at(TUE, "22:30"), [])).toEqual({ date: WED, part: "pm" });
    expect(targetPeriod("tomorrow_am", at(WED, "00:40"), [])).toEqual({ date: WED, part: "am" });
  });

  it("the Handover tab picks for the last handover's shift until it's over, then the shift on now or the next", () => {
    const rota = [s(TUE, "11:00", "22:15"), s(WED, "11:00", "22:15"), s(THU, "11:00", "22:15")];
    const latest = { shift: "tomorrow_am" as const, submittedAt: at(TUE, "22:30") };
    expect(pickPeriod(latest, at(TUE, "22:31"), rota)).toEqual({ date: WED, part: "am" });
    expect(pickPeriod(latest, at(WED, "12:00"), rota)).toEqual({ date: WED, part: "am" });
    expect(pickPeriod(latest, at(WED, "16:00"), rota)).toEqual({ date: WED, part: "pm" });
    expect(pickPeriod(latest, at(WED, "22:40"), rota)).toEqual({ date: THU, part: "am" });
    expect(pickPeriod(undefined, at(WED, "09:00"), rota)).toEqual({ date: WED, part: "am" });
  });

  it("a sent handover says what it's for with the date, so it reads right the next day", () => {
    expect(forLabel("tomorrow_am", { date: WED, part: "am" })).toBe("Tomorrow morning · Wed 14 Oct");
    expect(forLabel("next", { date: WED, part: "pm" })).toBe("Next shift · Wed 14 Oct evening");
  });

  it("says when in words, from now", () => {
    const now = at(TUE, "22:30");
    expect(periodLabel({ date: TUE, part: "pm" }, now)).toBe("this evening");
    expect(periodLabel({ date: WED, part: "am" }, now)).toBe("tomorrow morning");
    expect(periodLabel({ date: WED, part: "am" }, at(WED, "00:30"))).toBe("tomorrow morning");
    expect(periodLabel({ date: WED, part: "am" }, at(WED, "09:00"))).toBe("this morning");
    expect(periodLabel({ date: THU, part: "pm" }, now)).toBe("Thu 15 Oct evening");
  });
});

describe("the pick list", () => {
  const people = [{ id: "a", name: "Anh" }, { id: "b", name: "Binh" }, { id: "c", name: "Chi" }, { id: "d", name: "Dung" }];
  const now = at(TUE, "22:30");
  const wedAm = { date: WED, part: "am" as const };

  it("who's working that shift first, earliest start first with their times, then everyone else A to Z", () => {
    const rota = [s(WED, "11:00", "22:15", "c"), s(WED, "09:00", "15:00", "d"), s(WED, "17:00", "22:15", "a"), s(TUE, "11:00", "22:15", "b")];
    expect(pickList(people, rota, wedAm, "Eastcote", now)).toEqual([
      { label: "Working tomorrow morning", people: [{ id: "d", name: "Dung", times: "09:00–15:00" }, { id: "c", name: "Chi", times: "11:00–22:15" }] },
      { label: "Everyone else at Eastcote", people: [{ id: "a", name: "Anh" }, { id: "b", name: "Binh" }] },
    ]);
  });

  it("a split shift shows both parts; nobody on the rota gives one list", () => {
    const split = [s(WED, "14:00", "16:30", "a"), s(WED, "09:00", "12:00", "a")];
    expect(pickList(people, split, wedAm, "Eastcote", now)[0]).toEqual({ label: "Working tomorrow morning", people: [{ id: "a", name: "Anh", times: "09:00–12:00, 14:00–16:30" }] });
    expect(pickList(people.slice(0, 2), [], wedAm, "Eastcote", now)).toEqual([{ label: "Everyone at Eastcote", people: [{ id: "a", name: "Anh" }, { id: "b", name: "Binh" }] }]);
    expect(pickList([], [], wedAm, "Eastcote", now)).toEqual([]);
  });

  it("only active people who work at the site", () => {
    const p = (status: Person["status"], siteId: "EAS" | "WEM") => ({ status, access: [{ siteId, role: "staff" as const, sections: [] }] });
    expect(canBeGiven(p("active", "EAS"), "EAS")).toBe(true);
    expect(canBeGiven(p("active", "WEM"), "EAS")).toBe(false);
    expect(canBeGiven(p("frozen", "EAS"), "EAS")).toBe(false);
    expect(canBeGiven(p("left", "EAS"), "EAS")).toBe(false);
    expect(canBeGiven(undefined, "EAS")).toBe(false);
  });
});
