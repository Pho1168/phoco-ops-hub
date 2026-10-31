import { beforeEach, describe, expect, it } from "vitest";
import { demoStore as db, resetDemo } from "@/lib/data/demo-store";
import { catalogFor, orderableAt, type NeededGroup } from "@/lib/domain/stock";
import { clearNeeded, neededView, orderBrands, pickBrand, sendStockReport } from "@/lib/stock-service";

// Runs against the in-memory demo store only, never a real database.
const NOW = Date.UTC(2026, 9, 16, 21, 0);
beforeEach(() => { resetDemo(); });

/** A Cafe La Viet supplier and product of its own (the demo seed is all PHO & CO's). */
async function cafeLime(round = true) {
  const sup = await db.saveSupplier(undefined, { name: "Surelygrow (demo)", method: "delivery", brand: "clv", ...(round ? { deliveryDays: [1, 2, 3, 4, 5, 6] } : {}) }, true);
  const pid = await db.saveProduct(undefined, { brand: "clv", name: "Lime", size: "Box", category: "Fruit", supplierId: sup }, true);
  return { sup, pid: pid as string };
}

describe("each business keeps its own stock catalogue", () => {
  it("a site only orders from its own business's catalogue", () => {
    expect(orderableAt({ active: true }, { kind: "restaurant" })).toBe(true);
    expect(orderableAt({ active: true }, { kind: "restaurant", brand: "clv" })).toBe(false);
    expect(orderableAt({ active: true, brand: "clv" }, { kind: "restaurant", brand: "clv" })).toBe(true);
    expect(orderableAt({ active: true, brand: "clv" }, { kind: "restaurant" })).toBe(false);
    const cat = { suppliers: [{ id: "a", name: "A", method: "shop" as const, active: true }, { id: "b", name: "A", method: "shop" as const, active: true, brand: "clv" as const }],
      products: [{ id: "p", name: "Lime", active: true, supplierId: "a" }, { id: "q", name: "Lime", active: true, supplierId: "b", brand: "clv" as const }],
      prices: [{ productId: "p", pence: 100, on: "2026-10-01" }, { productId: "q", pence: 90, on: "2026-10-01" }] };
    expect(catalogFor(cat, "clv")).toEqual({ suppliers: [cat.suppliers[1]], products: [cat.products[1]], prices: [cat.prices[1]] });
    expect(catalogFor(cat, "phoco").products.map((p) => p.id)).toEqual(["p"]);
  });

  it("Cafe La Viet can't send a PHO & CO product, only its own", async () => {
    const { pid } = await cafeLime();
    const pho = (await db.stockCatalog()).products.find((p) => p.name === "Lime" && !p.brand)!;
    await db.saveStockDraft("CLV", "DEMO-CLV", "2026-10-16", [{ productId: pho.id, level: "low", qty: 2 }], false);
    expect((await sendStockReport(db, { id: "DEMO-CLV" }, { id: "CLV" }, NOW)).ok).toBe(false);
    await db.saveStockDraft("CLV", "DEMO-CLV", "2026-10-16", [{ productId: pid, level: "low", qty: 2 }], false);
    expect((await sendStockReport(db, { id: "DEMO-CLV" }, { id: "CLV" }, NOW)).ok).toBe(true);
  });

  it("Stock needed and clearing it are one business at a time", async () => {
    const { pid, sup } = await cafeLime(false);
    const pho = (await db.stockCatalog()).products.find((p) => p.name === "Spring onion" || (p.name !== "Lime" && !p.brand && p.supplierId && p.active))!;
    await db.saveStockDraft("CLV", "DEMO-CLV", "2026-10-16", [{ productId: pid, level: "low", qty: 2 }], false);
    expect((await sendStockReport(db, { id: "DEMO-CLV" }, { id: "CLV" }, NOW)).ok).toBe(true);
    await db.saveStockDraft("EAS", "DEMO-BOH", "2026-10-16", [{ productId: pho.id, level: "low", qty: 1 }], false);
    expect((await sendStockReport(db, { id: "DEMO-BOH" }, { id: "EAS" }, NOW)).ok).toBe(true);
    const owner = (await db.person("DEMO-OWN"))!;
    expect(await orderBrands(db, owner)).toEqual(["phoco", "clv"]);
    expect(pickBrand(["phoco", "clv"], "clv")).toBe("clv");
    expect(pickBrand(["phoco"], "clv")).toBe("phoco");
    const ids = (g: NeededGroup[]) => g.flatMap((x) => x.rows.map((r) => r.product.id));
    expect(ids((await neededView(db, owner, NOW + 1000, "clv")).groups)).toEqual([pid]);
    expect(ids((await neededView(db, owner, NOW + 1000, "phoco")).groups)).toContain(pho.id);
    expect(ids((await neededView(db, owner, NOW + 1000, "phoco")).groups)).not.toContain(pid);
    // An operations manager at Eastcote and Wembley only orders for PHO & CO.
    expect(await orderBrands(db, (await db.person("DEMO-OPS"))!)).toEqual(["phoco"]);
    expect((await clearNeeded(db, owner, NOW + 2000, "clv")).ok).toBe(true);
    expect(ids((await neededView(db, owner, NOW + 3000, "clv")).groups)).toEqual([]);
    expect(ids((await neededView(db, owner, NOW + 3000, "phoco")).groups)).toContain(pho.id);
    void sup;
  });
});
