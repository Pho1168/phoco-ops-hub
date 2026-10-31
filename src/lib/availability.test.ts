import { beforeEach, describe, expect, it } from "vitest";
import { demoStore as db, resetDemo } from "@/lib/data/demo-store";
import { askedWeek, asksAvailability, availabilityGrid, availReminderStage, canAnswer, cleanAvailability, dueDay, isLate, latestAvailability, type Availability } from "@/lib/domain/availability";
import { londonToUtc } from "@/lib/domain/time";
import { queueAvailabilityReminders } from "@/lib/availability-service";

// Runs against the in-memory demo store only, never a real database.
const at = (date: string, hm = "12:00") => londonToUtc(date, hm);
beforeEach(() => { resetDemo(); });
const open = [{ id: "EAS", status: "open" as const }, { id: "SYD", status: "closed" as const }];
const person = (role: string, siteId = "EAS", status = "active") => ({ id: `${role}-${siteId}`, name: role, status, access: [{ siteId, role, sections: ["BOH"] }] }) as never;

describe("weekly availability", () => {
  it("asks about next week, due by the end of Thursday before it", () => {
    expect(askedWeek(at("2026-10-31"))).toBe("2026-11-02"); // Sat → the Monday after
    expect(askedWeek(at("2026-11-02", "08:00"))).toBe("2026-11-09"); // Monday: next week
    expect(dueDay("2026-11-09")).toBe("2026-11-05"); // Thursday
    expect(isLate("2026-11-09", at("2026-11-05", "23:59"))).toBe(false);
    expect(isLate("2026-11-09", at("2026-11-06", "00:01"))).toBe(true);
    expect(canAnswer("2026-11-09", at("2026-11-04"))).toBe(true);
    expect(canAnswer("2026-11-16", at("2026-11-04"))).toBe(true); // the week after too
    expect(canAnswer("2026-11-02", at("2026-11-04"))).toBe(false); // already started
  });

  it("asks staff and managers at open sites, never owners, ops or anyone frozen", () => {
    expect(asksAvailability(person("staff"), open)).toBe(true);
    expect(asksAvailability(person("manager"), open)).toBe(true);
    expect(asksAvailability(person("owner"), open)).toBe(false);
    expect(asksAvailability(person("ops"), open)).toBe(false);
    expect(asksAvailability(person("staff", "SYD"), open)).toBe(false);
    expect(asksAvailability(person("staff", "EAS", "frozen"), open)).toBe(false);
  });

  it("needs an answer for all seven days; notes are trimmed", () => {
    const week = (a: string) => Array.from({ length: 7 }, () => ({ a }));
    expect(cleanAvailability(week("am")).ok).toBe(true);
    expect(cleanAvailability(week("maybe")).ok).toBe(false);
    expect(cleanAvailability(week("am").slice(1)).ok).toBe(false);
    const r = cleanAvailability([{ a: "pm", note: "  from   18:00  " }, ...week("off").slice(1)]);
    expect(r.ok && r.value[0]).toEqual({ a: "pm", note: "from 18:00" });
  });

  it("the latest answer counts; the grid lists who works there and who hasn't sent it", () => {
    const a = (personId: string, createdAt: number, x = "all"): Availability => ({ id: `${personId}${createdAt}`, personId, week: "2026-11-09", createdAt, days: Array.from({ length: 7 }, () => ({ a: x as "all" })) });
    expect(latestAvailability([a("p", 2, "off"), a("p", 1)]).get("p")!.days[0].a).toBe("off");
    const people = [{ ...(person("staff") as object), id: "s1", name: "Bea" }, { ...(person("staff") as object), id: "s2", name: "Al" }, { ...(person("owner") as object), id: "o", name: "Owner" }] as never[];
    const g = availabilityGrid(people, open, "EAS", "2026-11-09", [a("s1", at("2026-11-06"))]);
    expect(g.rows.map((r) => r.name)).toEqual(["Al", "Bea"]);
    expect(g.waiting.map((r) => r.name)).toEqual(["Al"]);
    expect(g.rows[1].late).toBe(true);
  });

  it("reminds whoever hasn't sent it on Wednesday and Thursday from midday, once each", async () => {
    expect(availReminderStage("2026-11-09", at("2026-11-04", "11:59"))).toBeUndefined();
    expect(availReminderStage("2026-11-09", at("2026-11-04", "12:00"))).toBe("wed");
    expect(availReminderStage("2026-11-09", at("2026-11-05", "18:00"))).toBe("thu");
    expect(availReminderStage("2026-11-09", at("2026-11-06", "12:00"))).toBeUndefined();
    const now = at("2026-11-04", "12:30");
    const sites = await db.sites();
    const asked = (await db.people()).filter((p) => asksAvailability(p, sites));
    expect(asked.length).toBeGreaterThan(1);
    await db.addAvailability(asked[0].id, "2026-11-09", Array.from({ length: 7 }, () => ({ a: "all" as const })));
    expect(await queueAvailabilityReminders(now, db)).toBe(asked.length - 1);
    expect(await queueAvailabilityReminders(now + 60_000, db)).toBe(0);
  });
});
