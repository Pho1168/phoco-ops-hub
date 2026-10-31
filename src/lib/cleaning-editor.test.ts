import { beforeEach, describe, expect, it } from "vitest";
import { demoStore as db, resetDemo } from "@/lib/data/demo-store";
import { cleanJob, jobId } from "@/lib/domain/cleaning";

// Runs against the in-memory demo store only, never a real database.
beforeEach(() => { resetDemo(); });

describe("the owner's cleaning jobs editor", () => {
  it("checks a job as it's typed", () => {
    expect(cleanJob({ name: "  Grease   traps ", area: "BOH", per: "week", times: 2 }, ["FOH", "BOH"])).toEqual({ ok: true, value: { name: "Grease traps", area: "BOH", per: "week", times: 2 } });
    expect(cleanJob({ name: "", area: "BOH", per: "week", times: 1 }, ["BOH"]).ok).toBe(false);
    expect(cleanJob({ name: "Mixer", area: "PROD", per: "week", times: 1 }, ["FOH", "BOH"]).ok).toBe(false);
    expect(cleanJob({ name: "Mixer", area: "BOH", per: "week", times: 8 }, ["BOH"]).ok).toBe(false);
    expect(cleanJob({ name: "Air con", area: "FOH", per: "every", everyMonths: 6 }, ["FOH"]).ok).toBe(false); // needs a first due date
    expect(cleanJob({ name: "Air con", area: "FOH", per: "every", everyMonths: 6, firstDue: "2027-04-22", times: 3 }, ["FOH"]))
      .toEqual({ ok: true, value: { name: "Air con", area: "FOH", per: "every", times: 1, everyMonths: 6, firstDue: "2027-04-22" } });
  });
  it("gives a new job an id that's never reused", () => {
    expect(jobId("CLV", "BOH", "Grease traps!", [])).toBe("CLV-BOH-GREASETRAPS");
    expect(jobId("CLV", "BOH", "Grease traps", ["CLV-BOH-GREASETRAPS"])).toBe("CLV-BOH-GREASETRAPS-2");
  });
  it("adds, changes, takes off and puts back; nothing is deleted", async () => {
    const before = (await db.cleaningJobs(["EAS"])).length;
    expect(await db.saveCleaningJob("EAS-BOH-WALLS", "EAS", { name: "Walls", area: "BOH", per: "month", times: 1 })).toBe(true);
    expect(await db.saveCleaningJob("EAS-BOH-WALLS", "EAS", { name: "Walls", area: "BOH", per: "month", times: 1 })).toBe(false); // id taken
    expect(await db.saveCleaningJob("EAS-BOH-WALLS", undefined, { name: "Walls and tiles", area: "BOH", per: "week", times: 2 })).toBe(true);
    const j = (await db.cleaningJobs(["EAS"])).find((x) => x.id === "EAS-BOH-WALLS")!;
    expect([j.name, j.per, j.times, j.position > 0]).toEqual(["Walls and tiles", "week", 2, true]);
    expect(await db.setCleaningJobActive(j.id, false)).toBe(true);
    expect(await db.setCleaningJobActive(j.id, false)).toBe(false);
    expect((await db.cleaningJobs(["EAS"])).length).toBe(before + 1);
  });
});
