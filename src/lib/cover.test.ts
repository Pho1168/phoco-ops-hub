import { describe, expect, it } from "vitest";
import { demoStore, resetDemo } from "@/lib/data/demo-store";
import { canCoverNow, couldCover, coverCandidates } from "@/lib/cover-service";
import { coverState } from "@/lib/domain/cover";
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

  it("one request in play per shift; only someone who offered can be approved; done once the rota shows it", async () => {
    const shift = await setUp();
    const now = londonToUtc("2026-11-05", "12:00");
    const id = (await demoStore.addCoverRequest({ shiftId: shift.id, siteId: "EAS", personId: "DEMO-BOH", section: "BOH" }))!;
    expect(await demoStore.addCoverRequest({ shiftId: shift.id, siteId: "EAS", personId: "DEMO-BOH", section: "BOH" })).toBeUndefined();
    const r = (await demoStore.coverRequest(id))!;
    const candidates = (await coverCandidates(r, now, demoStore)).map((p) => p.id).sort();
    // Not the person asking, not FOH or Wembley-only staff, not the floater (on 17:00–22:15); the manager works BOH too.
    expect(candidates).not.toContain("DEMO-BOH");
    expect(candidates).not.toContain("DEMO-FLT");
    expect(candidates).not.toContain("DEMO-FOH");
    expect(candidates).not.toContain("DEMO-PRD");
    expect(candidates).toContain("DEMO-MGR");
    expect(await demoStore.decideCover(id, { status: "approved", personId: "DEMO-MGR", coveredBy: "DEMO-MGR" })).toBe(false); // no offer yet
    expect(await demoStore.addCoverOffer(id, "DEMO-MGR")).toBeTruthy();
    expect(await demoStore.addCoverOffer(id, "DEMO-MGR")).toBeUndefined();
    expect(await demoStore.decideCover(id, { status: "withdrawn", personId: "DEMO-MGR" })).toBe(false); // only the person asking
    expect(await demoStore.decideCover(id, { status: "approved", personId: "DEMO-OWN", coveredBy: "DEMO-MGR" })).toBe(true);
    expect(await demoStore.decideCover(id, { status: "declined", personId: "DEMO-OWN" })).toBe(false); // already decided
    expect(await demoStore.withdrawCoverOffer(id, "DEMO-MGR")).toBeUndefined(); // can't take back once approved
    expect(coverState((await demoStore.coverRequest(id))!, now)).toBe("approved");
    // The manager moves the shift in the sheet: the cook's shift is cancelled and the manager gets one.
    await demoStore.applyShiftSync("EAS", { added: [sh("DEMO-MGR", "BOH", "11:00", "22:15")], changed: [], cancelled: [{ ...sh("DEMO-BOH", "BOH", "11:00", "22:15"), cancelled: false }] },
      new Map([["DEMO-MGR", "DEMO-MGR"]]));
    expect(coverState((await demoStore.coverRequest(id))!, now)).toBe("done");
    resetDemo();
  });

  it("someone approved to cover can't be approved for another shift at the same time", async () => {
    const shift = await setUp();
    const now = londonToUtc("2026-11-05", "12:00");
    const id = (await demoStore.addCoverRequest({ shiftId: shift.id, siteId: "EAS", personId: "DEMO-BOH", section: "BOH" }))!;
    await demoStore.addCoverOffer(id, "DEMO-MGR");
    await demoStore.decideCover(id, { status: "approved", personId: "DEMO-OWN", coveredBy: "DEMO-MGR" });
    // The floater asks for cover on their overlapping 17:00 shift: the manager is now busy then.
    const flt = (await demoStore.shiftsOnDate(day)).find((s) => s.personId === "DEMO-FLT")!;
    const id2 = (await demoStore.addCoverRequest({ shiftId: flt.id, siteId: "EAS", personId: "DEMO-FLT", section: "BOH" }))!;
    const r2 = (await demoStore.coverRequest(id2))!;
    expect((await coverCandidates(r2, now, demoStore)).map((p) => p.id)).not.toContain("DEMO-MGR");
    expect(await canCoverNow((await demoStore.person("DEMO-MGR"))!, r2, now, demoStore, "Manager")).toMatchObject({ ok: false, error: "Manager is already working then" });
    // Cancelling the first approval frees them again.
    expect(await demoStore.decideCover(id, { status: "cancelled", personId: "DEMO-OWN", note: "Plans changed" })).toBe(true);
    expect((await canCoverNow((await demoStore.person("DEMO-MGR"))!, r2, now, demoStore)).ok).toBe(true);
    expect(await demoStore.addCoverRequest({ shiftId: shift.id, siteId: "EAS", personId: "DEMO-BOH", section: "BOH" })).toBeTruthy(); // can ask again
    resetDemo();
  });

  it("the person asking can withdraw; the rota sheet moving the shift closes an open request", async () => {
    const shift = await setUp();
    const now = londonToUtc("2026-11-05", "12:00");
    const id = (await demoStore.addCoverRequest({ shiftId: shift.id, siteId: "EAS", personId: "DEMO-BOH", section: "BOH" }))!;
    expect(await demoStore.decideCover(id, { status: "withdrawn", personId: "DEMO-BOH" })).toBe(true);
    expect(coverState((await demoStore.coverRequest(id))!, now)).toBe("withdrawn");
    const id2 = (await demoStore.addCoverRequest({ shiftId: shift.id, siteId: "EAS", personId: "DEMO-BOH", section: "BOH" }))!;
    await demoStore.applyShiftSync("EAS", { added: [], changed: [], cancelled: [{ ...sh("DEMO-BOH", "BOH", "11:00", "22:15"), cancelled: false }] }, new Map());
    expect(coverState((await demoStore.coverRequest(id2))!, now)).toBe("rota_changed");
    expect(await couldCover((await demoStore.person("DEMO-MGR"))!, now, demoStore)).toEqual([]);
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
