import { describe, expect, it } from "vitest";
import { demoStore, resetDemo } from "@/lib/data/demo-store";
import { queueCertReminders } from "@/lib/rota-service";
import { londonDate, londonToUtc } from "@/lib/domain/time";

// Runs against the in-memory demo store only (passed in), never a real database.
describe("certificate reminders on the scheduler", () => {
  it("queues each due reminder once, to the holder, their managers and (right to work) owners only", async () => {
    resetDemo();
    const now = londonToUtc(londonDate(Date.now()), "09:05");
    expect(await queueCertReminders(now, demoStore)).toBe(7);
    expect(await queueCertReminders(now + 10 * 60_000, demoStore)).toBe(0); // the next run sends nothing new
    const titles = async (id: string) => (await demoStore.notices(id, 20)).filter((n) => n.kind === "cert").map((n) => n.title).sort();
    expect(await titles("DEMO-FOH")).toEqual(["Your Allergen awareness runs out in 15 days"]);
    expect(await titles("DEMO-BOH")).toEqual(["Your Food hygiene Level 2 has run out"]);
    expect(await titles("DEMO-PRD")).toEqual([]); // right to work never goes to the person
    expect(await titles("DEMO-MGR")).toEqual(["BOH staff (demo): Food hygiene Level 2 has run out", "FOH staff (demo): Allergen awareness runs out in 15 days"]);
    expect(await titles("DEMO-OWN")).toHaveLength(3);
    resetDemo();
  });
});
