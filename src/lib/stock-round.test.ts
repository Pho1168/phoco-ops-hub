import { beforeEach, describe, expect, it } from "vitest";
import { demoStore as db, resetDemo } from "@/lib/data/demo-store";
import { cleanCatalogueLines, deliveryDaysText, nextDelivery, restaurantDemand, orderableAt, ordersByRound, roundReminderMessage, roundRemindersDue } from "@/lib/domain/stock";
import { londonToUtc } from "@/lib/domain/time";
import { addFromCatalogue, clearNeeded, neededView, queueRoundReminders, sendStockReport } from "@/lib/stock-service";

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

  it("on cut-off day, reminds the owners and the kitchen's operations managers at 15:00, and at 20:00 if it's still waiting", async () => {
    const next = { orderBy: "2026-11-05" };
    expect(roundRemindersDue(next, "2026-11-05", "14:59", 3)).toEqual([]);
    expect(roundRemindersDue(next, "2026-11-05", "15:00", 0)).toEqual(["first"]);
    expect(roundRemindersDue(next, "2026-11-05", "20:10", 0)).toEqual([]);
    expect(roundRemindersDue(next, "2026-11-05", "20:10", 2)).toEqual(["last"]);
    expect(roundRemindersDue(next, "2026-11-04", "15:30", 2)).toEqual([]);
    // Delivering most days (Cafe La Viet's Surelygrow, Monday to Saturday): no daily nag while nothing is on the order.
    expect(roundRemindersDue(next, "2026-11-05", "15:00", 0, [1, 2, 3, 4, 5, 6])).toEqual([]);
    expect(roundRemindersDue(next, "2026-11-05", "15:00", 1, [1, 2, 3, 4, 5, 6])).toEqual(["first"]);
    expect(roundRemindersDue(next, "2026-11-05", "15:00", 0, [1, 5])).toEqual(["first"]);
    expect(roundReminderMessage("Surelygrow", { date: "2026-11-06" }, 0, "first", () => "Fri 6 Nov", { siteName: "Cafe La Viet (Colindale)", kitchen: false }))
      .toEqual({ title: "Surelygrow order for Cafe La Viet (Colindale) closes tonight", body: "For Fri 6 Nov. Nothing on it yet. Check the stock, then send the order and tick it off." });
    expect(roundReminderMessage("Surelygrow", { date: "2026-11-06" }, 2, "last", () => "Fri 6 Nov", { siteName: "Wembley", kitchen: true }).title).toBe("Last call: Surelygrow order for Wembley");
    const thu = at("2026-11-05", "15:30");
    const first = await queueRoundReminders(thu, db);
    expect(first).toBeGreaterThan(0);
    expect(await queueRoundReminders(thu + 60_000, db)).toBe(0);
    const own = await db.notices("DEMO-OWN", 20);
    expect(own.find((n) => n.title.includes("closes tonight"))).toBeDefined();
    expect((await db.notices("DEMO-OPS", 20)).some((n) => n.title.includes("closes tonight"))).toBe(true);
    expect((await db.notices("DEMO-BOH", 20)).some((n) => n.title.includes("closes tonight"))).toBe(false);
    expect(await queueRoundReminders(at("2026-11-05", "20:30"), db)).toBe(0); // nothing waiting: no last call
  });

  it("checks what's picked from the catalogue: that supplier's products, an amount each, the same one added up", () => {
    const ps = [{ id: "a", active: true, supplierId: "S" }, { id: "b", active: true, supplierId: "X" }, { id: "c", active: false, supplierId: "S" }];
    expect(cleanCatalogueLines([], ps, "S").ok).toBe(false);
    expect(cleanCatalogueLines([{ productId: "b", qty: 1 }], ps, "S").ok).toBe(false);
    expect(cleanCatalogueLines([{ productId: "c", qty: 1 }], ps, "S").ok).toBe(false);
    expect(cleanCatalogueLines([{ productId: "a", qty: 0 }], ps, "S").ok).toBe(false);
    expect(cleanCatalogueLines([{ productId: "a", qty: 2 }, { productId: "a", qty: 1.5 }], ps, "S")).toEqual({ ok: true, value: [{ productId: "a", qty: 3.5 }] });
  });

  it("the catalogue adds to the Surelygrow order for Wembley, on top of what's already on it", async () => {
    const { products, suppliers } = await db.stockCatalog();
    const sg = suppliers.find((s) => s.name.startsWith("Surelygrow"))!;
    const lime = products.find((p) => p.name === "Lime")!;
    const tofu = products.find((p) => p.name === "Tofu")!;
    const owner = (await db.people()).find((p) => p.id === "DEMO-OWN")!;
    await db.saveStockDraft("WEM", "DEMO-PRD", "2026-10-16", [{ productId: lime.id, level: "low", qty: 3 }], false);
    expect((await sendStockReport(db, { id: "DEMO-PRD" }, { id: "WEM" }, NOW)).ok).toBe(true);
    const r = await addFromCatalogue(db, owner, sg.id, [{ productId: lime.id, qty: 5 }, { productId: tofu.id, qty: 2 }]);
    expect(r.ok && r.value.site).toBe("Wembley");
    const g = (await neededView(db, owner, NOW)).groups.find((x) => x.supplier?.id === sg.id)!;
    const qty = (id: string) => g.rows.find((x) => x.product.id === id)?.qty;
    expect(qty(lime.id)).toBe(8);
    expect(qty(tofu.id)).toBe(2);
    // Not this supplier's product, or someone who doesn't order: refused.
    const wings = products.find((p) => p.name === "Wings")!;
    expect((await addFromCatalogue(db, owner, sg.id, [{ productId: wings.id, qty: 1 }])).ok).toBe(false);
    const staff = (await db.people()).find((p) => p.id === "DEMO-PRD")!;
    expect((await addFromCatalogue(db, staff, sg.id, [{ productId: lime.id, qty: 1 }])).ok).toBe(false);
  });
});

describe("what the restaurants want of a round supplier's product", () => {
  it("adds up what's still to send of the kitchen's copies, by the product they were copied from", () => {
    const row = (id: string, size: string, sites: [string, number][]) => ({ product: { id, name: id, size, active: true }, qty: 0, sites: sites.map(([siteId, qty]) => ({ siteId, qty, unknown: 0 })),
      requestIds: [], lineIds: [], unknownIds: [], notes: [], photoIds: [], urgent: false });
    const groups = [
      { production: true, rows: [row("copyA", "900g", [["EAS", 4], ["SYD", 2], ["WEM", 9]]), row("copyA2", "Case", [["EAS", 1]]), row("other", "1kg", [["EAS", 3]])] },
      { production: false, rows: [row("A", "Case of 6", [["WEM", 5]])] },
    ];
    const products = [{ id: "copyA", copyOf: "A" }, { id: "copyA2", copyOf: "A" }, { id: "other" }, { id: "A" }];
    const d = restaurantDemand(groups, products, "WEM");
    expect(d.get("A")).toEqual({ qty: 7, sizes: ["900g", "Case"], sites: [{ siteId: "EAS", qty: 5 }, { siteId: "SYD", qty: 2 }] });
    expect(d.size).toBe(1);
  });
});

describe("Stock needed beside a round supplier's order", () => {
  it("mirrors Stock needed: every supplier's items per branch and in total, round suppliers left out, what it sells marked", async () => {
    const { neededMirror } = await import("@/lib/domain/stock");
    const row = (id: string, sites: [string, number, number?][], urgent = false) => ({ product: { id, name: id, active: true }, qty: 0, sites: sites.map(([siteId, qty, unknown = 0]) => ({ siteId, qty, unknown })),
      requestIds: [], lineIds: [], unknownIds: [], notes: [], photoIds: [], urgent, changed: undefined });
    const sup = (id: string, name: string, deliveryDays?: number[]) => ({ id, name, method: "delivery" as const, active: true, ...(deliveryDays ? { deliveryDays } : {}) });
    const groups = [
      { key: "P", supplier: sup("P", "Production"), production: true, rows: [row("Lime", [["EAS", 3], ["WEM", 9]]), row("Soup", [["EAS", 2]])] },
      { key: "SG", supplier: sup("SG", "Surelygrow", [1, 5]), production: false, rows: [row("sgLime", [["WEM", 4]])] },
      { key: "LF", supplier: sup("LF", "Loon Fung"), production: false, rows: [row("Coriander", [["EAS", 1, 1]], true), row("Empty", [["EAS", 0]])] },
    ];
    const products = [{ id: "Lime", name: "Lime", copyOf: "sgLime", active: true }, { id: "sgLime", name: "Lime", supplierId: "SG", active: true },
      { id: "sgCor", name: "coriander", supplierId: "SG", active: true }, { id: "Soup", name: "Soup", active: true }, { id: "Coriander", name: "Coriander", supplierId: "LF", active: true }];
    const m = neededMirror(groups, products, "SG");
    expect(m.map((g) => [g.name, g.rows.map((r) => [r.product.id, r.total, r.unknown, r.sold])])).toEqual([
      ["Production (production)", [["Lime", 12, 0, true], ["Soup", 2, 0, false]]],
      ["Loon Fung", [["Coriander", 1, 1, true]]],
    ]);
    expect(m[0].rows[0].sites).toEqual([{ siteId: "EAS", qty: 3, unknown: 0 }, { siteId: "WEM", qty: 9, unknown: 0 }]);
    expect(m[1].rows[0].urgent).toBe(true);
  });

  it("keeps a restaurant's items off the kitchen's order and in the mirror, so nothing shows twice", async () => {
    const { neededMirror, kitchenOnly } = await import("@/lib/domain/stock");
    const sup = { id: "SG", name: "Surelygrow", method: "delivery" as const, active: true, deliveryDays: [1, 5] };
    const prawn = { id: "Prawn", name: "Prawn", active: true, supplierId: "SG" };
    const g = { key: "SG", supplier: sup, production: false, drivers: [],
      rows: [{ product: prawn, qty: 8, sites: [{ siteId: "EAS", qty: 5, unknown: 0 }, { siteId: "WEM", qty: 3, unknown: 0 }],
        requestIds: ["r1", "r2"], lineIds: [], unknownIds: [], notes: [], photoIds: [], urgent: false }],
      ticked: [{ product: prawn, qty: 6, sites: [{ siteId: "EAS", qty: 6 }], lineIds: ["l1"], by: [], at: 0 }],
      removed: [] };
    const k = kitchenOnly(g as never, "WEM", (id) => (id === "r1" ? "EAS" : "WEM"));
    expect(k.rows.map((r) => [r.qty, r.requestIds, r.sites.map((x) => x.siteId)])).toEqual([[3, ["r2"], ["WEM"]]]);
    expect(k.ticked).toEqual([]);
    const m = neededMirror([g as never], [prawn], "SG", "WEM");
    expect(m.map((x) => [x.name, x.rows.map((r) => [r.product.id, r.total, r.sites.map((s) => s.siteId)])])).toEqual([["Surelygrow", [["Prawn", 5, ["EAS"]]]]]);
    // Cafe La Viet's Surelygrow delivers to the restaurant itself: all of it is on the order, none in the mirror.
    expect(neededMirror([g as never], [prawn], "SG", "EAS").map((x) => x.rows.map((r) => r.sites.map((s) => s.siteId)))).toEqual([[["WEM"]]]);
  });
});
