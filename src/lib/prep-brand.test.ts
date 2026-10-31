import { beforeEach, describe, expect, it } from "vitest";
import { demoStore as db, resetDemo } from "@/lib/data/demo-store";
import { prepListBrands } from "@/lib/domain/prep";
import type { Person } from "@/lib/domain/types";

// Runs against the in-memory demo store only, never a real database.
beforeEach(() => { resetDemo(); });
const SITES = [{ id: "EAS" }, { id: "WEM", brand: "phoco" as const }, { id: "CLV", brand: "clv" as const }];
const who = (access: Person["access"]) => ({ access });

describe("each business keeps its own handover list", () => {
  it("a manager changes only the list of the business they manage; owners both", () => {
    expect(prepListBrands(who([{ siteId: "CLV", role: "manager", sections: ["FOH", "BOH"] }]), SITES)).toEqual(["clv"]);
    expect(prepListBrands(who([{ siteId: "EAS", role: "manager", sections: ["BOH"] }]), SITES)).toEqual(["phoco"]);
    expect(prepListBrands(who([{ siteId: "EAS", role: "staff", sections: ["BOH"] }]), SITES)).toEqual([]);
    expect(prepListBrands(who(SITES.map((s) => ({ siteId: s.id, role: "owner" as const, sections: [] }))), SITES)).toEqual(["phoco", "clv"]);
  });
  it("items added to one business's list never show on the other's", async () => {
    const before = (await db.prepItems("phoco")).length;
    expect(before).toBeGreaterThan(0);
    expect(await db.prepItems("clv")).toEqual([]);
    const id = await db.addPrepItem({ name: "Banh mi bread", kind: "prep", group: "Bakery", brand: "clv" }, "DEMO-OWN");
    expect((await db.prepItems("clv")).map((i) => i.id)).toEqual([id]);
    expect((await db.prepItems("phoco")).length).toBe(before);
    expect((await db.prepItems()).length).toBe(before + 1);
  });
});
