import { describe, expect, it } from "vitest";
import { demoStore, resetDemo } from "@/lib/data/demo-store";
import { queueCertReminders, queueServiceReminders, queueWeeklyReport } from "@/lib/rota-service";
import { addDays, londonDate, londonToUtc } from "@/lib/domain/time";
import { weekStartOf } from "@/lib/domain/rota";

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
  it("reminds managers about a service due soon, once", async () => {
    resetDemo();
    const now = londonToUtc(londonDate(Date.now()), "09:05");
    expect(await queueServiceReminders(now, demoStore)).toBe(2); // Fryer 2 at Eastcote: the Eastcote manager and the owner
    expect(await queueServiceReminders(now, demoStore)).toBe(0);
    const mgr = (await demoStore.notices("DEMO-MGR", 20)).filter((n) => n.kind === "service");
    expect(mgr[0]?.title).toMatch(/^Service due in \d+ days: Fryer 2 \(Eastcote\)$/);
    resetDemo();
  });
  it("sends owners and managers last week's report on Monday morning, once", async () => {
    resetDemo();
    const monday = weekStartOf(londonDate(Date.now()));
    expect(await queueWeeklyReport(londonToUtc(addDays(monday, 1), "09:05"), demoStore)).toBe(0); // not on a Tuesday
    const at = londonToUtc(monday, "09:05");
    expect(await queueWeeklyReport(at, demoStore)).toBe(2); // the owner (Eastcote and Wembley) and the Eastcote manager
    expect(await queueWeeklyReport(at + 600_000, demoStore)).toBe(0);
    const [own] = (await demoStore.notices("DEMO-OWN", 20)).filter((n) => n.kind === "report");
    expect(own.title).toMatch(/^Weekly report: Mon \d+ \w+ to Sun \d+ \w+$/);
    expect(own.body).toContain("Eastcote:");
    expect(own.body).toContain("Wembley:");
    const [mgr] = (await demoStore.notices("DEMO-MGR", 20)).filter((n) => n.kind === "report");
    expect(mgr.body).not.toContain("Wembley");
    resetDemo();
  });
  it("hands each due message to one sender only, and can send just the people an action messaged", async () => {
    resetDemo();
    const now = Date.now();
    await demoStore.queueNotice({ personId: "DEMO-FOH", kind: "notice", title: "a", body: "a", sendAfter: now - 1000 });
    await demoStore.queueNotice({ personId: "DEMO-BOH", kind: "notice", title: "b", body: "b", sendAfter: now - 1000 });
    expect((await demoStore.dueNotices(now, 50, ["DEMO-FOH"])).map((n) => n.title)).toEqual(["a"]);
    expect((await demoStore.dueNotices(now, 50)).map((n) => n.title)).toEqual(["b"]); // "a" was already taken
    expect(await demoStore.dueNotices(now, 50)).toEqual([]);
    resetDemo();
  });
});
