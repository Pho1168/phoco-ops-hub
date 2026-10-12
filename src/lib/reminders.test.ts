import { describe, expect, it } from "vitest";
import { demoStore, resetDemo } from "@/lib/data/demo-store";
import { queueCertReminders, queueServiceReminders, queueShiftReminders, queueWeeklyReport } from "@/lib/rota-service";
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

  it("reminds each person 2 hours before their shift, with what's waiting, once; the owner's button can send them early", async () => {
    resetDemo();
    const day = "2026-11-04";
    const week = weekStartOf(day);
    const sh = (code: string, section: string, start: string, end: string) =>
      ({ sourceKey: `EAS|${week}|${code}|${section}|2`, staffCode: code, section, week, date: day, start, end, endsNextDay: false });
    await demoStore.applyShiftSync("EAS", { added: [sh("DEMO-FOH", "FOH", "11:00", "15:00"), sh("DEMO-BOH", "BOH", "17:00", "22:15")], changed: [], cancelled: [] },
      new Map([["DEMO-FOH", "DEMO-FOH"], ["DEMO-BOH", "DEMO-BOH"]]));
    await demoStore.setWeekStatuses("EAS", new Map([[week, "published"]]));
    await demoStore.addHandover({ siteId: "EAS", category: "Equipment", body: "Fridge 2 door seal loose", needsAction: true, createdBy: "DEMO-MGR" });
    await demoStore.addHandover({ siteId: "EAS", category: "Staff note", body: "Private: talk to Sam", needsAction: true, createdBy: "DEMO-MGR" });
    const at = (t: string) => londonToUtc(day, t);

    expect(await queueShiftReminders(at("08:55"), demoStore)).toEqual([]);
    expect(await queueShiftReminders(at("09:00"), demoStore)).toEqual(["DEMO-FOH"]);
    expect(await queueShiftReminders(at("09:10"), demoStore)).toEqual([]); // already sent
    const [m] = (await demoStore.notices("DEMO-FOH", 10)).filter((n) => n.kind === "shift");
    expect(m).toMatchObject({ title: "Shift at 11:00 today · Eastcote", url: "/me", sendAfter: at("09:00") });
    expect(m.body).toContain("Fridge 2 door seal loose");
    expect(m.body).not.toContain("Sam");

    // The button at 09:20 sends the 17:00 shift's reminder now; the scheduler doesn't send it again at 15:00.
    expect(await queueShiftReminders(at("09:20"), demoStore, "now")).toEqual(["DEMO-BOH"]);
    expect(await queueShiftReminders(at("09:21"), demoStore, "now")).toEqual([]);
    expect(await queueShiftReminders(at("15:00"), demoStore)).toEqual([]);
    expect((await demoStore.notices("DEMO-BOH", 10)).filter((n) => n.kind === "shift")).toHaveLength(1);

    // The 17:00 shift moves to 18:00 in the sheet: it gets a reminder for the new time, 2 hours before.
    const moved = { ...sh("DEMO-BOH", "BOH", "18:00", "22:15") };
    await demoStore.applyShiftSync("EAS", { added: [], changed: [{ before: { ...sh("DEMO-BOH", "BOH", "17:00", "22:15"), cancelled: false }, after: moved }], cancelled: [] },
      new Map([["DEMO-BOH", "DEMO-BOH"]]));
    expect(await queueShiftReminders(at("15:50"), demoStore)).toEqual([]);
    expect(await queueShiftReminders(at("16:00"), demoStore)).toEqual(["DEMO-BOH"]);
    expect((await demoStore.notices("DEMO-BOH", 10)).filter((n) => n.kind === "shift").map((n) => n.title)).toContain("Shift at 18:00 today · Eastcote");

    // Cancelled shifts, and shifts in weeks that aren't published, get nothing.
    await demoStore.applyShiftSync("EAS", { added: [], changed: [], cancelled: [{ ...moved, cancelled: false }] }, new Map());
    const next = addDays(day, 7);
    await demoStore.applyShiftSync("EAS", { added: [{ ...sh("DEMO-FOH", "FOH", "11:00", "15:00"), sourceKey: "draft-week", week: weekStartOf(next), date: next }], changed: [], cancelled: [] },
      new Map([["DEMO-FOH", "DEMO-FOH"]]));
    expect(await queueShiftReminders(londonToUtc(next, "09:30"), demoStore)).toEqual([]);
    resetDemo();
  });

  it("a reply repeated or sent twice at once is stored once", async () => {
    resetDemo();
    const r = { shiftId: "s1", personId: "DEMO-FOH", siteId: "EAS" as const, kind: "late" as const, lateMinutes: 15 as const };
    const same = (latest: { kind: string; lateMinutes?: number }) => latest.kind === r.kind && latest.lateMinutes === r.lateMinutes;
    const [a, b] = await Promise.all([demoStore.addShiftReply(r, same), demoStore.addShiftReply(r, same)]);
    expect([a.added, b.added].sort()).toEqual([false, true]);
    expect(a.reply.id).toBe(b.reply.id);
    expect(await demoStore.shiftReplies(["s1"])).toHaveLength(1);
    const c = await demoStore.addShiftReply({ ...r, kind: "on_my_way", lateMinutes: undefined }, () => false);
    expect(c).toMatchObject({ added: true, previous: { id: a.reply.id } });
    resetDemo();
  });
});
