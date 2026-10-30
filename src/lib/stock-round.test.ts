import { beforeEach, describe, expect, it } from "vitest";
import { demoStore as db, resetDemo } from "@/lib/data/demo-store";
import { deliveryDaysText, nextDelivery, orderableAt, ordersByRound } from "@/lib/domain/stock";
import { londonToUtc } from "@/lib/domain/time";
import { clearNeeded, neededView, sendStockReport } from "@/lib/stock-service";

// Runs against the in-memory demo store only, never a real database.
const at = (date: string, hm = "12:00") => londonToUtc(date, hm);
const NOW = Date.UTC(2026, 9, 16, 21, 0);

beforeEach(() => { resetDemo(); });

describe("a supplier ordered as a round (Surelygrow: Monday and Friday)", () => {
  it("orders close at the end of the day before; on a delivery day the order is for the next one", () => {
    const monFri = [1, 5];
    expect(nextDelivery(monFri, at("2026-10-31"))).toEqual({ date: "2026-11-02", orderBy: "2026-11-01" }); // Sat → Mon, by Sun
    expect(nextDelivery(monFri, at("2026-11-01", "23:30"))).toEqual({ date: "2026-11-02", orderBy: "2026-11-01" }); // Sun night, still Monday's
    expect(nextDelivery(monFri, at("2026-11-02", "08:00"))).toEqual({ date: "2026-11-06", orderBy: "2026-11-05" }); // Monday: Friday's
    expect(nextDelivery(monFri, at("2026-11-05", "20:00"))).toEqual({ date: "2026-11-06", orderBy: "2026-11-05" }); // Thursday: closes today
    expect(nextDelivery([], at("2026-11-05"))).toBeUndefined();
    expect(deliveryDaysText([5, 1])).toBe("Monday and Friday");
    expect(ordersByRound({ active: true, deliveryDays: [1, 5] })).toBe(true);
    expect(ordersByRound({ active: true })).toBe(false);
  });

  it("kitchen-only items can be asked for at a production kitchen, never at a restaurant", async () => {
    expect(orderableAt({ active: true, forRestaurants: false }, { kind: "restaurant" })).toBe(false);
    expect(orderableAt({ active: true, forRestaurants: false }, { kind: "production" })).toBe(true);
    expect(orderableAt({ active: true }, { kind: "restaurant" })).toBe(true);
    const { products } = await db.stockCatalog();
    const lime = products.find((p) => p.name === "Lime")!;
    await db.saveProduct(lime.id, { name: lime.name, size: lime.size, category: lime.category, supplierId: lime.supplierId, link: lime.link, forRestaurants: false }, true);
    await db.saveStockDraft("EAS", "DEMO-BOH", "2026-10-16", [{ productId: lime.id, level: "low", qty: 2 }], false);
    expect((await sendStockReport(db, { id: "DEMO-BOH" }, { id: "EAS" }, NOW)).ok).toBe(false);
    await db.saveStockDraft("WEM", "DEMO-PRD", "2026-10-16", [{ productId: lime.id, level: "low", qty: 3 }], false);
    expect((await sendStockReport(db, { id: "DEMO-PRD" }, { id: "WEM" }, NOW)).ok).toBe(true);
  });

  it("clearing Stock needed leaves the round order alone", async () => {
    const { products } = await db.stockCatalog();
    const lime = products.find((p) => p.name === "Lime")!;
    await db.saveStockDraft("WEM", "DEMO-PRD", "2026-10-16", [{ productId: lime.id, level: "low", qty: 3 }], false);
    expect((await sendStockReport(db, { id: "DEMO-PRD" }, { id: "WEM" }, NOW)).ok).toBe(true);
    const ownerP = (await db.person("DEMO-OWN"))!;
    expect((await clearNeeded(db, ownerP, NOW + 1000)).ok).toBe(true);
    const g = (await neededView(db, ownerP, NOW + 2000)).groups.find((x) => x.supplier?.name === "Surelygrow (demo)");
    expect(g?.rows.find((r) => r.product.id === lime.id)?.qty).toBe(3);
  });
});
