import { beforeEach, describe, expect, it } from "vitest";
import { demoStore as db, resetDemo } from "@/lib/data/demo-store";
import { progress, withProgress, type Product, type StockRequest } from "@/lib/domain/stock";
import { canOrder, checkDelivery, cleanOrderLines, cleanOrderSettings, countFor, groupOf, lastRound, nextRound, orderRows, orderText, planOrderLines, roundsAround,
  roundState, shownAt, startQty, supplierAt, type SupplierOrders } from "@/lib/domain/supplier-orders";
import { shiftItems, type ShiftInput } from "@/lib/domain/shift-mode";
import { londonDate, londonToUtc } from "@/lib/domain/time";
import { sendStockReport, stockView } from "@/lib/stock-service";
import { queueSupplierReminders, sendSupplierCount, supplierView } from "@/lib/supplier-order-service";

// Runs against the in-memory demo store only, never a real database.
const THU_AND_SUN = [{ cutDow: 4, cutHm: "20:00", delDow: 5, delHm: "08:00" }, { cutDow: 0, cutHm: "20:00", delDow: 1, delHm: "08:00" }];
const at = (date: string, hm: string) => londonToUtc(date, hm);
const prod = (id: string, extra: Partial<Product> = {}): Product => ({ id, name: id, active: true, supplierId: "SG", ...extra });

beforeEach(() => resetDemo());

describe("supplier orders: the schedule", () => {
  it("Thursday 20:00 → Friday 08:00 and Sunday 20:00 → Monday 08:00, in UK time across the clock change", () => {
    // Thursday 15 October 2026 (BST).
    const n = nextRound(THU_AND_SUN, at("2026-10-15", "18:46"), "2026-10-15")!;
    expect(n).toMatchObject({ cutDate: "2026-10-15", delDate: "2026-10-16" });
    expect(n.cutoffAt).toBe(Date.UTC(2026, 9, 15, 19, 0));
    // After the cut-off the next one is Sunday's, delivered Monday.
    const after = nextRound(THU_AND_SUN, at("2026-10-15", "20:01"), "2026-10-15")!;
    expect(after).toMatchObject({ cutDate: "2026-10-18", delDate: "2026-10-19" });
    expect(lastRound(THU_AND_SUN, at("2026-10-15", "20:01"), "2026-10-15")!.cutDate).toBe("2026-10-15");
    // Sunday 25 October: clocks go back; 20:00 is then GMT.
    const gmt = roundsAround(THU_AND_SUN, "2026-10-25").find((r) => r.cutDate === "2026-10-25")!;
    expect(gmt.cutoffAt).toBe(Date.UTC(2026, 9, 25, 20, 0));
  });

  it("checks the settings: a production kitchen, one order day per weekday, active people", () => {
    const sites = [{ id: "EAS", kind: "restaurant" as const }, { id: "WEM", kind: "production" as const }];
    const people = [{ id: "V", status: "active" as const }, { id: "X", status: "frozen" as const }];
    expect(cleanOrderSettings({ deliversTo: "WEM", days: [THU_AND_SUN[1], THU_AND_SUN[0]], orderers: ["V", "V"] }, sites, people))
      .toEqual({ ok: true, value: { deliversTo: "WEM", days: [THU_AND_SUN[1], THU_AND_SUN[0]], orderers: ["V"] } });
    expect(cleanOrderSettings({ deliversTo: "EAS", days: [], orderers: [] }, sites, people).ok).toBe(false);
    expect(cleanOrderSettings({ days: [THU_AND_SUN[0], THU_AND_SUN[0]], orderers: [] }, sites, people).ok).toBe(false);
    expect(cleanOrderSettings({ days: [{ cutDow: 4, cutHm: "25:00", delDow: 5, delHm: "08:00" }], orderers: [] }, sites, people).ok).toBe(false);
    expect(cleanOrderSettings({ days: [], orderers: ["X"] }, sites, people).ok).toBe(false);
  });

  it("a round's count is the latest after the round before closed; its state follows the order", () => {
    const r = nextRound(THU_AND_SUN, at("2026-10-15", "10:00"), "2026-10-15")!;
    const before = roundsAround(THU_AND_SUN, "2026-10-15").filter((x) => x.cutoffAt < r.cutoffAt).at(-1)!;
    const counts = [{ id: "old", createdAt: before.cutoffAt - 1000 }, { id: "a", createdAt: at("2026-10-15", "14:00") }, { id: "b", createdAt: at("2026-10-15", "14:20") }];
    expect(countFor(counts, r, before)?.id).toBe("b");
    const t = { id: "T" };
    expect(roundState(r, at("2026-10-15", "15:00"), false, undefined, [])).toBe("counting");
    expect(roundState(r, at("2026-10-15", "15:00"), true, undefined, [])).toBe("review");
    expect(roundState(r, at("2026-10-15", "19:00"), true, t, [])).toBe("generated");
    expect(roundState(r, at("2026-10-15", "19:10"), true, t, [{ kind: "ordered", taskId: "T" }])).toBe("ordered");
    expect(roundState(r, at("2026-10-16", "09:00"), true, t, [{ kind: "ordered", taskId: "T" }, { kind: "delivered", taskId: "T" }])).toBe("delivered");
    expect(roundState(r, at("2026-10-16", "09:00"), true, t, [{ kind: "ordered", taskId: "T" }, { kind: "short", taskId: "T" }, { kind: "delivered", taskId: "T" }])).toBe("short");
    expect(roundState(r, at("2026-10-15", "20:30"), true, undefined, [])).toBe("missed");
  });
});

describe("supplier orders: who sees what", () => {
  const cfgs: SupplierOrders[] = [{ supplierId: "SG", deliversTo: "WEM", days: THU_AND_SUN, orderers: ["V"] }];
  const suppliers = [{ id: "SG", method: "delivery" as const }, { id: "PROD", method: "production" as const, siteId: "WEM" }, { id: "WY", method: "shop" as const }];
  it("restaurants get the supplier's products from the kitchen; the kitchen gets them from the supplier", () => {
    expect(supplierAt({ supplierId: "SG" }, "EAS", cfgs, suppliers)).toBe("PROD");
    expect(supplierAt({ supplierId: "SG" }, "WEM", cfgs, suppliers)).toBe("SG");
    expect(supplierAt({ supplierId: "WY" }, "EAS", cfgs, suppliers)).toBe("WY");
  });
  it("raw ingredients not marked for restaurants only show at the kitchen", () => {
    expect(shownAt({ supplierId: "SG", forRestaurants: false }, "EAS", cfgs)).toBe(false);
    expect(shownAt({ supplierId: "SG", forRestaurants: false }, "WEM", cfgs)).toBe(true);
    expect(shownAt({ supplierId: "SG" }, "EAS", cfgs)).toBe(true);
    expect(shownAt({ supplierId: "WY", forRestaurants: false }, "EAS", cfgs)).toBe(true);
  });
  it("owners and the chosen people order", () => {
    const p = (id: string, role: "owner" | "ops" | "staff") => ({ id, status: "active" as const, access: [{ siteId: "WEM", role, sections: [] }] as never });
    expect(canOrder(p("V", "ops"), cfgs[0])).toBe(true);
    expect(canOrder(p("A", "ops"), cfgs[0])).toBe(false);
    expect(canOrder(p("O", "owner"), cfgs[0])).toBe(true);
  });
});

describe("supplier orders: the order", () => {
  const products = [prod("brisket", { category: "Meat & fish" }), prod("lime", { category: "Fruit, veg & tofu" }), prod("rice", { category: "Dry goods" }), prod("coke", { category: "Che & drinks" }), prod("msg")];
  const req = (id: string, productId: string, qty: number | undefined, at = 1): { request: StockRequest; progress: ReturnType<typeof progress> } => {
    const request: StockRequest = { id, code: 1, siteId: "WEM", productId, level: "low", qty, requestedBy: "J", requestedByName: "Jamie (demo)", createdAt: at, supplierId: "SG" };
    return { request, progress: progress(request, [], [], [], []) };
  };
  it("suggested = par + still to send − on the shelf; not counted has none; groups meat, veg, other", () => {
    const rows = orderRows(products, [{ productId: "brisket", qty: 30 }, { productId: "lime", qty: 3 }, { productId: "rice", qty: 6 }, { productId: "coke", qty: 2 }],
      { lines: [{ productId: "brisket", qty: 8 }, { productId: "rice", qty: 6 }, { productId: "coke", qty: 1 }, { productId: "msg", qty: 1 }] },
      new Map([["coke", 3]]), [req("r1", "lime", 2), req("r2", "lime", undefined)]);
    const by = Object.fromEntries(rows.map((r) => [r.product.id, r]));
    expect(rows.map((r) => r.group)).toEqual(["Meat", "Vegetables", "Other", "Other", "Other"]);
    expect(by.brisket).toMatchObject({ onHand: 8, par: 30, suggested: 22, state: "order" });
    expect(by.lime).toMatchObject({ state: "not_counted", reported: { qty: 2, unsure: 1, names: ["Jamie"] } });
    expect(by.lime.suggested).toBeUndefined();
    expect(startQty(by.lime)).toBe(2);
    expect(by.rice).toMatchObject({ suggested: 0, state: "enough" });
    expect(by.coke).toMatchObject({ toSend: 3, suggested: 4 });
    expect(by.msg).toMatchObject({ state: "no_par", suggested: 0 });
    expect(groupOf("Meat & fish")).toBe("Meat");
  });
  it("uses what was reported first, fills a not-sure one, and makes the rest new", () => {
    const open = [req("r1", "lime", 2, 1), req("r2", "lime", 1, 2), req("r3", "rice", undefined), { ...req("r4", "brisket", 5), request: { ...req("r4", "brisket", 5).request, siteId: "EAS" } }];
    expect(planOrderLines([{ productId: "lime", qty: 5 }, { productId: "rice", qty: 3 }, { productId: "brisket", qty: 22 }], open, "WEM", "SG")).toEqual({
      use: [{ requestId: "r1", qty: 2 }, { requestId: "r2", qty: 1 }, { requestId: "r3", qty: 3, setQty: 3 }],
      create: [{ productId: "lime", qty: 2 }, { productId: "brisket", qty: 22 }],
    });
    expect(planOrderLines([{ productId: "lime", qty: 1 }], open, "WEM", "SG")).toEqual({ use: [{ requestId: "r1", qty: 1 }], create: [] });
  });
  it("order lines: above 0, once each, at least one; the text groups them", () => {
    expect(cleanOrderLines([{ productId: "lime", qty: 2.345 }, { productId: "rice", qty: 0 }, { productId: "msg", qty: null }, { productId: "lime", qty: 9 }], products))
      .toEqual({ ok: true, value: [{ productId: "lime", qty: 2.35 }] });
    expect(cleanOrderLines([{ productId: "x", qty: 1 }], products).ok).toBe(false);
    expect(cleanOrderLines([{ productId: "lime", qty: 0 }], products).ok).toBe(false);
    const text = orderText({ supplier: "Surelygrow", deliverTo: "Wembley", delDate: "2026-10-17", delHm: "08:00", ref: "PT-0031",
      lines: [{ name: "Lime", size: "Case", qty: 2, group: "Vegetables" }, { name: "Beef Brisket", size: "1kg", qty: 22, group: "Meat" }] });
    expect(text).toBe(["PHO & CO order for Surelygrow", "Deliver to: Wembley", "Saturday 17 October by 08:00 · our ref PT-0031", "", "MEAT", "22 × Beef Brisket (1kg)", "", "VEGETABLES", "2 × Lime (Case)", "", "2 products · thank you"].join("\n"));
  });
  it("a delivery: arrived up to what was ordered, the rest short, not delivered or wrong", () => {
    const ordered = new Map([["a", 22], ["b", 8], ["c", 6]]);
    expect(checkDelivery([{ lineId: "a", arrived: 19, outcome: "arrived" }, { lineId: "b", arrived: 0, outcome: "arrived" }, { lineId: "c", arrived: 5, outcome: "wrong" }], ordered)).toEqual({ ok: true, value: [
      { lineId: "a", arrived: 19, missing: 3, outcome: "short" }, { lineId: "b", arrived: 0, missing: 8, outcome: "missing" }, { lineId: "c", arrived: 5, missing: 1, outcome: "wrong" }] });
    expect(checkDelivery([{ lineId: "a", arrived: 23, outcome: "arrived" }, { lineId: "b", arrived: 8, outcome: "arrived" }, { lineId: "c", arrived: 6, outcome: "arrived" }], ordered).ok).toBe(false);
    expect(checkDelivery([{ lineId: "a", arrived: 22, outcome: "arrived" }], ordered).ok).toBe(false);
  });
});

describe("supplier orders: a round from start to finish (demo store)", () => {
  async function setup() {
    const { suppliers, products } = await db.stockCatalog();
    const main = suppliers.find((s) => s.name === "Main Supplier (demo)")!;
    await db.saveSupplierOrders(main.id, { deliversTo: "WEM", days: THU_AND_SUN, orderers: ["DEMO-OPS"] }, "DEMO-OWN");
    const mine = products.filter((p) => p.supplierId === main.id);
    const lime = mine.find((p) => p.name === "Lime")!, tofu = mine.find((p) => p.name === "Tofu")!, oil = mine.find((p) => p.name === "Pride Rapeseed Oil")!;
    return { main, mine, lime, tofu, oil };
  }

  it("Eastcote asks Wembley, Wembley counts, the order uses the midweek report, the delivery is confirmed with a shortfall", async () => {
    const { main, mine, lime, tofu, oil } = await setup();
    // Records are stamped with the real time, so this runs against the real next round.
    const NOW = Date.now();
    const R = nextRound(THU_AND_SUN, NOW + 60_000, londonDate(NOW + 60_000))!;
    // Eastcote reports lime: it goes onto Wembley's production order, not to the supplier.
    await db.saveStockDraft("EAS", "DEMO-BOH", londonDate(NOW), [{ productId: lime.id, level: "low", qty: 2 }], false);
    const sent = await sendStockReport(db, { id: "DEMO-BOH" }, { id: "EAS" }, NOW);
    expect(sent.ok && sent.value.created[0].supplierId).not.toBe(main.id);
    const v0 = await stockView(db, NOW);
    expect(v0.data.tasks.some((t) => t.method === "production" && t.destination === "EAS")).toBe(true);
    // Wembley reported tofu midweek (to the supplier, at the kitchen).
    await db.saveStockDraft("WEM", "DEMO-PRD", londonDate(NOW), [{ productId: tofu.id, level: "out", qty: 4 }], false);
    await sendStockReport(db, { id: "DEMO-PRD" }, { id: "WEM" }, NOW);
    await db.setStockTargets("WEM", [{ productId: lime.id, qty: 3 }, { productId: oil.id, qty: 3 }], "DEMO-OPS");

    // The closer counts: lime 1, oil 3, tofu 0.
    const c = await sendSupplierCount(db, { id: "DEMO-PRD", name: "Wembley cook (demo)" }, { id: "WEM", name: "Wembley" }, main.id,
      { lines: [{ productId: lime.id, qty: 1 }, { productId: oil.id, qty: 3 }, { productId: tofu.id, qty: 0 }] }, NOW);
    expect(c.ok).toBe(true);
    expect((await db.notices("DEMO-OPS", 10)).find((n) => n.title.startsWith("Main Supplier (demo) count in"))).toMatchObject({ url: `/stock/orders/${main.id}` });
    expect((await db.notices("DEMO-PRD", 10)).some((n) => n.title.includes("count in"))).toBe(false);
    // Only the supplier's count is on it: the production count list stays separate.
    expect(await db.stockCounts("WEM", 0)).toHaveLength(0);

    const v = (await supplierView(db, main.id, Date.now() + 1000))!;
    expect(v.next).toMatchObject({ state: "review", round: { cutDate: R.cutDate, delDate: R.delDate } });
    const by = Object.fromEntries(v.rows.map((r) => [r.product.id, r]));
    // Lime: par 3 + 2 still to send to Eastcote − 1 on the shelf = 4.
    expect(by[lime.id]).toMatchObject({ onHand: 1, par: 3, toSend: 2, suggested: 4 });
    expect(by[oil.id]).toMatchObject({ suggested: 0, state: "enough" });
    expect(by[tofu.id]).toMatchObject({ onHand: 0, state: "no_par", reported: { qty: 4 } });
    expect(v.rows.filter((r) => r.state === "not_counted")).toHaveLength(mine.length - 3);

    // Vishal orders 4 lime and 4 tofu: the tofu uses Wembley's own report, nothing is asked twice.
    const g = await db.generateSupplierOrder({ supplierId: main.id, siteId: "WEM", roundAt: v.next!.round.cutoffAt, requiredBy: R.delDate, assigneeId: "DEMO-OPS", by: "DEMO-OPS",
      lines: [{ productId: lime.id, qty: 4, level: "low" }, { productId: tofu.id, qty: 4, level: "out" }] });
    expect(g.ok).toBe(true);
    const again = await db.generateSupplierOrder({ supplierId: main.id, siteId: "WEM", roundAt: v.next!.round.cutoffAt, requiredBy: R.delDate, assigneeId: "DEMO-OPS", by: "DEMO-OPS",
      lines: [{ productId: lime.id, qty: 1, level: "low" }] });
    expect(again).toEqual({ ok: false, error: "This delivery has already been ordered" });
    const taskId = (g as { value: string }).value;
    let d = (await db.stockTask(taskId))!;
    expect(d.tasks[0]).toMatchObject({ method: "delivery", destination: "WEM", assigneeId: "DEMO-OPS", requiredBy: R.delDate });
    expect(d.lines).toHaveLength(2);
    const tofuReq = withProgress(d).find((x) => x.request.productId === tofu.id)!;
    expect(tofuReq.request.requestedBy).toBe("DEMO-PRD");

    // Confirming before it's placed is refused; then placed, then delivered with lime short by 1.
    const lineOf = (pid: string) => d.lines.find((l) => d.requests.find((r) => r.id === l.requestId)?.productId === pid)!;
    expect((await db.confirmSupplierDelivery(taskId, "DEMO-PRD", [{ lineId: lineOf(lime.id).id, arrived: 4, missing: 0, outcome: "arrived" }, { lineId: lineOf(tofu.id).id, arrived: 4, missing: 0, outcome: "arrived" }])).ok).toBe(false);
    expect((await db.orderPlaced(taskId, "DEMO-OPS", "SG-1")).ok).toBe(true);
    expect((await supplierView(db, main.id, Date.now() + 2000))!.next).toMatchObject({ state: "ordered" });
    const ok = await db.confirmSupplierDelivery(taskId, "DEMO-PRD", [{ lineId: lineOf(lime.id).id, arrived: 3, missing: 1, outcome: "short" }, { lineId: lineOf(tofu.id).id, arrived: 4, missing: 0, outcome: "arrived" }], "lime short");
    expect(ok.ok).toBe(true);
    expect((await db.confirmSupplierDelivery(taskId, "DEMO-PRD", [])).ok).toBe(false);
    d = (await db.stockTask(taskId))!;
    const limeReq = withProgress(d).find((x) => x.request.productId === lime.id)!;
    // The missing lime goes back to waiting.
    expect(limeReq.progress).toMatchObject({ received: 3, toReceive: 0, toPlan: 1, state: "part_received" });
    const after = (await supplierView(db, main.id, R.deliveryAt + 3_600_000))!;
    expect(after.last).toMatchObject({ state: "short" });
  });

  it("whoever orders hears the count isn't in, two hours before; the owners hear if nothing was ordered", async () => {
    const { main } = await setup();
    expect(await queueSupplierReminders(at("2026-10-15", "17:00"), db)).toBe(0);
    expect(await queueSupplierReminders(at("2026-10-15", "18:05"), db)).toBe(1);
    expect(await queueSupplierReminders(at("2026-10-15", "18:30"), db)).toBe(0);
    expect((await db.notices("DEMO-OPS", 5))[0]).toMatchObject({ title: "Main Supplier (demo): Wembley hasn't counted yet" });
    expect(await queueSupplierReminders(at("2026-10-15", "20:20"), db)).toBe(1);
    expect((await db.notices("DEMO-OWN", 5))[0]).toMatchObject({ title: "Main Supplier (demo) order not placed", url: `/stock/orders/${main.id}` });
  });
});

describe("supplier orders: on the kitchen's shift screen", () => {
  const t = (hm: string) => at("2026-10-15", hm);
  const base = (x: Partial<ShiftInput>): ShiftInput => ({ now: t("18:00"), date: "2026-10-15", window: { lane: "PROD", startsAt: t("10:00"), endsAt: t("21:00"), date: "2026-10-15" },
    personId: "P", onTablet: true, lists: [], prep: [], notes: [], allergens: [], sops: [], training: { overdue: 0, again: 0 }, kitDown: [], tasks: [], ...x });
  const count = { supplierId: "SG", name: "Surelygrow", dueAt: t("20:00"), closer: true, ordered: false };
  const item = (x: Partial<ShiftInput>, id = "supcount-SG") => shiftItems(base(x)).find((i) => i.id === id);
  it("the closers count by the cut-off: later, now from an hour before, late after; done once counted or ordered", () => {
    expect(item({ supplierCounts: [count] })).toMatchObject({ state: "later", title: "Count Surelygrow stock", href: "/stock/count?for=SG", when: "by 20:00" });
    expect(item({ supplierCounts: [count], now: t("19:10") })?.state).toBe("now");
    expect(item({ supplierCounts: [count], now: t("20:05") })).toMatchObject({ state: "late", urgent: true });
    expect(item({ supplierCounts: [{ ...count, sentAt: t("19:30"), sentBy: "Wembley cook (demo)" }] })).toMatchObject({ state: "done", detail: expect.stringContaining("Counted by Wembley cook") });
    expect(item({ supplierCounts: [{ ...count, ordered: true }] })?.state).toBe("done");
    expect(item({ supplierCounts: [{ ...count, closer: false }] })).toBeUndefined();
    expect(item({ supplierCounts: [{ ...count, closer: false }], personId: undefined })).toBeDefined();
  });
  it("the delivery is for the kitchen lanes on the day, now from half an hour before, done once confirmed", () => {
    const d = { supplierId: "SG", taskId: "T1", name: "Surelygrow", dueAt: t("08:00") };
    expect(item({ supplierDeliveries: [d], now: t("07:00") }, "supdel-T1")).toMatchObject({ state: "later", href: "/stock/orders/SG/T1/delivery" });
    expect(item({ supplierDeliveries: [d], now: t("07:40") }, "supdel-T1")?.state).toBe("now");
    expect(item({ supplierDeliveries: [{ ...d, doneAt: t("08:20"), doneBy: "Wembley cook (demo)" }] }, "supdel-T1")).toMatchObject({ state: "done", href: "/stock/orders/SG/T1" });
    expect(item({ supplierDeliveries: [d], window: { lane: "FOH", startsAt: t("10:00"), endsAt: t("21:00"), date: "2026-10-15" } }, "supdel-T1")).toBeUndefined();
  });
});
