import { describe, expect, it } from "vitest";
import { demoStore, resetDemo } from "@/lib/data/demo-store";
import { couldCover, coverCandidates, withStates } from "@/lib/cover-service";
import { londonToUtc } from "@/lib/domain/time";
import { weekStartOf } from "@/lib/domain/rota";

// Runs against the in-memory demo store only, never a real database.
describe("shift cover on the store", () => {
  const day = "2026-11-07";
  const week = weekStartOf(day);
  const sh = (code: string, section: string, start: string, end: string) =>
    ({ sourceKey: `EAS|${week}|${code}|${section}|5`, staffCode: code, section, week, date: day, start, end, endsNextDay: false });
  async function setUp() {
    resetDemo();
    // The cook asks; the floater (BOH too) is on at the same time, so can't cover.
    await demoStore.applyShiftSync("EAS", { added: [sh("DEMO-BOH", "BOH", "11:00", "22:15"), sh("DEMO-FLT", "BOH", "17:00", "22:15")], changed: [], cancelled: [] },
      new Map([["DEMO-BOH", "DEMO-BOH"], ["DEMO-FLT", "DEMO-FLT"]]));
    await demoStore.setWeekStatuses("EAS", new Map([[week, "published"]]));
    const shifts = await demoStore.shiftsOnDate(day);
    return shifts.find((s) => s.personId === "DEMO-BOH")!;
  }

  it("one request in play per shift; only someone who offered can be approved; the person asking withdraws", async () => {
    const shift = await setUp();
    const id = (await demoStore.addCoverRequest({ shiftId: shift.id, siteId: "EAS", personId: "DEMO-BOH", section: "BOH" }))!;
    expect(await demoStore.addCoverRequest({ shiftId: shift.id, siteId: "EAS", personId: "DEMO-BOH", section: "BOH" })).toBeUndefined();
    const r = (await demoStore.coverRequest(id))!;
    const candidates = (await coverCandidates(r, demoStore)).map((p) => p.id).sort();
    // Not the person asking, not FOH or Wembley-only staff, not the floater (on 17:00–22:15); the manager works BOH too.
    expect(candidates).not.toContain("DEMO-BOH");
    expect(candidates).not.toContain("DEMO-FLT");
    expect(candidates).not.toContain("DEMO-FOH");
    expect(candidates).not.toContain("DEMO-PRD");
    expect(candidates).toContain("DEMO-MGR");
    expect(await demoStore.decideCover(id, { status: "approved", personId: "DEMO-MGR", coveredBy: "DEMO-MGR" })).toBe(false); // no offer yet
    const offer = await demoStore.addCoverOffer(id, "DEMO-MGR");
    expect(offer).toBeTruthy();
    expect(await demoStore.addCoverOffer(id, "DEMO-MGR")).toBeUndefined();
    expect(await demoStore.decideCover(id, { status: "withdrawn", personId: "DEMO-MGR" })).toBe(false); // only the person asking
    expect(await demoStore.decideCover(id, { status: "approved", personId: "DEMO-OWN", coveredBy: "DEMO-MGR" })).toBe(true);
    expect(await demoStore.decideCover(id, { status: "declined", personId: "DEMO-OWN" })).toBe(false); // already decided
    const [approved] = await withStates([(await demoStore.coverRequest(id))!], londonToUtc("2026-11-05", "12:00"), demoStore);
    expect(approved).toMatchObject({ status: "approved", coveredByName: "Manager (demo)", state: "approved" });
    // The manager moves the shift in the sheet: the cook's shift is cancelled and the manager gets one.
    await demoStore.applyShiftSync("EAS", { added: [sh("DEMO-MGR", "BOH", "11:00", "22:15")], changed: [], cancelled: [{ ...sh("DEMO-BOH", "BOH", "11:00", "22:15"), cancelled: false }] },
      new Map([["DEMO-MGR", "DEMO-MGR"]]));
    const [done] = await withStates([(await demoStore.coverRequest(id))!], londonToUtc("2026-11-05", "12:00"), demoStore);
    expect(done.state).toBe("done");
    resetDemo();
  });

  it("shows open requests to the people who could cover them, and to anyone who has offered", async () => {
    const shift = await setUp();
    const id = (await demoStore.addCoverRequest({ shiftId: shift.id, siteId: "EAS", personId: "DEMO-BOH", section: "BOH", note: "Wedding" }))!;
    const now = londonToUtc("2026-11-05", "12:00");
    const person = async (pid: string) => (await demoStore.person(pid))!;
    expect((await couldCover(await person("DEMO-MGR"), now, demoStore)).map((r) => r.id)).toEqual([id]);
    expect(await couldCover(await person("DEMO-FOH"), now, demoStore)).toEqual([]);
    expect(await couldCover(await person("DEMO-FLT"), now, demoStore)).toEqual([]); // working then
    expect(await couldCover(await person("DEMO-BOH"), now, demoStore)).toEqual([]); // their own
    expect(await couldCover(await person("DEMO-MGR"), londonToUtc(day, "11:00"), demoStore)).toEqual([]); // the shift has started
    resetDemo();
  });
});
