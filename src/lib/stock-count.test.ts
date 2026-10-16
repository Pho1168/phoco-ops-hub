import { beforeEach, describe, expect, it } from "vitest";
import { demoStore as db, resetDemo } from "@/lib/data/demo-store";
import type { Product } from "@/lib/domain/stock";
import { belowTarget, canCount, changedTargets, cleanCount, cleanTargets, countAge, countIsOld, countProducts, plansProduction, productionPlan } from "@/lib/domain/stock-count";
import { shiftItems, type ShiftInput } from "@/lib/domain/shift-mode";
import { kitchenPlan, sendProductionCount, sendStockReport } from "@/lib/stock-service";

// Runs against the in-memory demo store only, never a real database.
const NOW = Date.UTC(2026, 9, 16, 20, 0);
const prod = (id: string, extra: Partial<Product> = {}): Product => ({ id, name: id, active: true, supplierId: "K", ...extra });
const access = (siteId: string, role: "owner" | "ops" | "manager" | "staff", sections: string[] = []) => ({ siteId, role, sections });
const who = (...a: ReturnType<typeof access>[]) => ({ status: "active" as const, access: a as never });

beforeEach(() => resetDemo());

describe("production count: who and what", () => {
  it("counts every active product whose supplier is that kitchen", () => {
    const suppliers = [{ id: "K", method: "production" as const, siteId: "WEM" }, { id: "M", method: "delivery" as const }];
    const list = countProducts([prod("soup"), prod("old", { active: false }), prod("lime", { supplierId: "M" }), prod("none", { supplierId: undefined })], suppliers, "WEM");
    expect(list.map((p) => p.id)).toEqual(["soup"]);
    expect(countProducts([prod("soup")], suppliers, "EAS")).toEqual([]);
  });

  it("the production team counts at an open kitchen; owners, its managers and ops plan", () => {
    const wem = { id: "WEM", kind: "production" as const, status: "open" as const };
    expect(canCount(who(access("WEM", "staff", ["PROD"])), wem)).toBe(true);
    expect(canCount(who(access("WEM", "staff", ["FOH"])), wem)).toBe(false);
    expect(canCount(who(access("WEM", "staff", ["PROD"])), { ...wem, status: "closed" })).toBe(false);
    expect(canCount(who(access("EAS", "staff", ["BOH"])), { id: "EAS", kind: "restaurant", status: "open" })).toBe(false);
    expect(plansProduction(who(access("EAS", "owner")), "WEM")).toBe(true);
    expect(plansProduction(who(access("WEM", "ops")), "WEM")).toBe(true);
    expect(plansProduction(who(access("WEM", "manager")), "WEM")).toBe(true);
    expect(plansProduction(who(access("EAS", "manager")), "WEM")).toBe(false);
    expect(plansProduction(who(access("WEM", "staff", ["PROD"])), "WEM")).toBe(false);
    expect(plansProduction({ status: "frozen" as never, access: [access("WEM", "manager")] as never }, "WEM")).toBe(false);
  });
});

describe("production count: checking what's sent", () => {
  const allowed = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("a 0 is counted, a blank isn't, numbers are rounded, each product once", () => {
    const r = cleanCount([{ productId: "a", qty: 0 }, { productId: "b", qty: null }, { productId: "c", qty: 2.345 }, { productId: "a", qty: 5 }], allowed, "  freezer 2   was  iced ");
    expect(r).toEqual({ ok: true, value: { lines: [{ productId: "a", qty: 0 }, { productId: "c", qty: 2.35 }], note: "freezer 2 was iced" } });
  });
  it("refuses nothing counted, negatives, and products the kitchen doesn't count", () => {
    expect(cleanCount([{ productId: "a", qty: null }], allowed).ok).toBe(false);
    expect(cleanCount([{ productId: "a", qty: -1 }], allowed).ok).toBe(false);
    expect(cleanCount([{ productId: "a", qty: Number.NaN }], allowed).ok).toBe(false);
    expect(cleanCount([{ productId: "z", qty: 1 }], allowed).ok).toBe(false);
  });
  it("targets: a number from 0 or none; only the changed ones are added", () => {
    const r = cleanTargets([{ productId: "a", qty: 4 }, { productId: "b", qty: null }, { productId: "c", qty: 0 }], allowed);
    expect(r).toEqual({ ok: true, value: [{ productId: "a", qty: 4 }, { productId: "b" }, { productId: "c", qty: 0 }] });
    expect(cleanTargets([{ productId: "a", qty: -2 }], allowed).ok).toBe(false);
    expect(changedTargets([{ productId: "a", qty: 4 }, { productId: "b" }, { productId: "c", qty: 0 }], [{ productId: "a", qty: 4 }, { productId: "b", qty: 2 }]))
      .toEqual([{ productId: "b" }, { productId: "c", qty: 0 }]);
    expect(changedTargets([{ productId: "b" }], [])).toEqual([]);
  });
});

describe("production count: the plan", () => {
  const products = [prod("soup"), prod("brisket"), prod("rolls"), prod("paste"), prod("coins")];
  const targets = [{ productId: "soup", qty: 4 }, { productId: "brisket", qty: 10 }, { productId: "rolls", qty: 8 }, { productId: "paste", qty: 3 }];
  const count = { lines: [{ productId: "soup", qty: 1 }, { productId: "brisket", qty: 12 }, { productId: "paste", qty: 3 }, { productId: "coins", qty: 0 }] };
  const orders = [{ product: products[1], outstanding: 5 }, { product: products[4], outstanding: 2 }];

  it("to make = target + still to send − on the shelf, never below 0", () => {
    const rows = productionPlan(products, targets, count, orders);
    const by = Object.fromEntries(rows.map((r) => [r.product.id, r]));
    expect(by.soup).toMatchObject({ onHand: 1, target: 4, toSend: 0, make: 3, state: "make" });
    expect(by.brisket).toMatchObject({ onHand: 12, target: 10, toSend: 5, make: 3, state: "make" });
    expect(by.paste).toMatchObject({ onHand: 3, target: 3, make: 0, state: "ok" });
    expect(by.rolls).toMatchObject({ target: 8, state: "not_counted" });
    expect(by.rolls.make).toBeUndefined();
    // No target: enough to cover what's still to send.
    expect(by.coins).toMatchObject({ onHand: 0, toSend: 2, make: 2, state: "make" });
    expect(rows.map((r) => r.state)).toEqual(["make", "make", "make", "not_counted", "ok"]);
    expect(belowTarget(rows).map((r) => r.product.id)).toEqual(["soup"]);
  });
  it("no count yet: everything is not counted", () => {
    expect(productionPlan(products, targets, undefined, []).every((r) => r.state === "not_counted")).toBe(true);
  });
  it("counted without a target and nothing to send: no target", () => {
    expect(productionPlan([prod("x")], [], { lines: [{ productId: "x", qty: 2 }] }, [])[0]).toMatchObject({ state: "no_target", make: 0 });
  });
  it("says how old the count is, and warns before yesterday", () => {
    expect(countAge("2026-10-16", "2026-10-16")).toBe("today");
    expect(countAge("2026-10-15", "2026-10-16")).toBe("yesterday");
    expect(countAge("2026-10-12", "2026-10-16")).toBe("4 days ago");
    expect(countIsOld("2026-10-15", "2026-10-16")).toBe(false);
    expect(countIsOld("2026-10-14", "2026-10-16")).toBe(true);
    expect(countIsOld(undefined, "2026-10-16")).toBe(true);
  });
});

describe("production count: on the closers' shift screen", () => {
  const at = (hm: string) => Date.parse(`2026-10-16T${hm}:00+01:00`);
  const base = (x: Partial<ShiftInput>): ShiftInput => ({ now: at("18:00"), date: "2026-10-16", window: { lane: "PROD", startsAt: at("10:00"), endsAt: at("21:00"), date: "2026-10-16" },
    personId: "P", onTablet: true, lists: [], prep: [], notes: [], allergens: [], sops: [], training: { overdue: 0, again: 0 }, kitDown: [], tasks: [], ...x });
  it("shows for closers, now from an hour before close, done once anyone has counted", () => {
    const productionCount = { closeAt: at("21:00"), closer: true };
    const item = (x: Partial<ShiftInput>) => shiftItems(base(x)).find((i) => i.id === "count");
    expect(item({ productionCount })).toMatchObject({ state: "later", href: "/stock/count", title: "Count production stock" });
    expect(item({ productionCount, now: at("20:15") })?.state).toBe("now");
    expect(item({ productionCount: { ...productionCount, sentAt: at("20:40"), sentBy: "Wembley cook (demo)" } })).toMatchObject({ state: "done", detail: expect.stringContaining("Counted by Wembley cook") });
    expect(item({ productionCount: { ...productionCount, closer: false } })).toBeUndefined();
  });
});

describe("production count: sending one (demo store)", () => {
  it("records the count, plans from it with Eastcote's orders, and tells the planners but not the counter", async () => {
    const { products } = await db.stockCatalog();
    const soup = products.find((p) => p.name === "Soup")!;
    const brisket = products.find((p) => p.name === "Beef Brisket")!;
    // Eastcote asks for 6 soup: it goes onto Wembley's production order, still to send.
    await db.saveStockDraft("EAS", "DEMO-BOH", "2026-10-16", [{ productId: soup.id, level: "low", qty: 6 }], false);
    expect((await sendStockReport(db, { id: "DEMO-BOH" }, { id: "EAS" }, NOW)).ok).toBe(true);

    const sent = await sendProductionCount(db, { id: "DEMO-PRD", name: "Wembley cook (demo)" }, { id: "WEM", name: "Wembley" },
      { lines: [{ productId: soup.id, qty: 2 }, { productId: brisket.id, qty: 12 }], note: "rolls not counted" }, NOW);
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect(sent.value).toMatchObject({ counted: 2, of: 4, below: 1 });

    const plan = await kitchenPlan(db, "WEM", NOW + 1000);
    expect(plan.latest?.id).toBe(sent.value.count.id);
    const soupRow = plan.rows.find((r) => r.product.id === soup.id)!;
    // Target 4 (demo), 6 still to send to Eastcote, 2 on the shelf: make 8.
    expect(soupRow).toMatchObject({ onHand: 2, target: 4, toSend: 6, make: 8, state: "make" });
    expect(plan.rows.find((r) => r.product.id === brisket.id)).toMatchObject({ onHand: 12, target: 10, make: 0, state: "ok" });
    expect(plan.rows.filter((r) => r.state === "not_counted")).toHaveLength(2);

    const ownerNotes = await db.notices("DEMO-OWN", 10);
    expect(ownerNotes.find((n) => n.title === "Production count · Wembley")).toMatchObject({ kind: "stock", url: "/stock/plan?site=WEM", body: expect.stringContaining("1 item to make, 1 below target") });
    expect((await db.notices("DEMO-OPS", 10)).some((n) => n.title === "Production count · Wembley")).toBe(true);
    expect((await db.notices("DEMO-PRD", 10)).some((n) => n.title === "Production count · Wembley")).toBe(false);
    expect((await db.notices("DEMO-MGR", 10)).some((n) => n.title === "Production count · Wembley")).toBe(false);
  });

  it("refuses an empty count and a restaurant with nothing to count", async () => {
    expect((await sendProductionCount(db, { id: "DEMO-PRD", name: "W" }, { id: "WEM", name: "Wembley" }, { lines: [] }, NOW)).ok).toBe(false);
    expect((await sendProductionCount(db, { id: "DEMO-BOH", name: "B" }, { id: "EAS", name: "Eastcote" }, { lines: [] }, NOW)).ok).toBe(false);
  });

  it("targets are added, never changed: the latest counts, and taking one off leaves none", async () => {
    const before = await db.stockTargets("WEM");
    const soup = before.find((t) => t.qty === 4)!;
    expect(await db.setStockTargets("WEM", [{ productId: soup.productId, qty: 6 }], "DEMO-OPS")).toBe(1);
    expect((await db.stockTargets("WEM")).find((t) => t.productId === soup.productId)).toMatchObject({ qty: 6, setBy: "DEMO-OPS", setByName: "Ops manager (demo)" });
    await db.setStockTargets("WEM", [{ productId: soup.productId }], "DEMO-OPS");
    expect((await db.stockTargets("WEM")).find((t) => t.productId === soup.productId)?.qty).toBeUndefined();
  });
});
