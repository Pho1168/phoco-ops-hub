import { beforeEach, describe, expect, it } from "vitest";
import { demoStore as db, resetDemo } from "@/lib/data/demo-store";
import { canSeeTask, checkLineEnd, cleanLines, cleanProduct, cleanSupplier, frequent, latestPrice, onProductionTeam, orderSummary, priceAge, productionQueue, progress,
  runsPurchasing, spendOf, supplierGroups, taskLines, taskState, typicalQty, wantedOf, withProgress, type Product, type StockRequest } from "@/lib/domain/stock";
import { sendStockReport, stockView } from "@/lib/stock-service";

const NOW = Date.UTC(2026, 9, 16, 21, 0);
const person = (id: string) => ({ id });
const site = (id: string) => ({ id });

async function product(name: string) {
  const { products } = await db.stockCatalog();
  return products.find((p) => p.name === name)!;
}
async function report(siteId: string, personId: string, lines: { name: string; level: "low" | "out"; qty?: number; note?: string }[]) {
  const ls = await Promise.all(lines.map(async (l) => ({ productId: (await product(l.name)).id, level: l.level, qty: l.qty, note: l.note })));
  await db.saveStockDraft(siteId, personId, "2026-10-16", ls, false);
  const r = await sendStockReport(db, person(personId), site(siteId), NOW);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}
const view = () => stockView(db, NOW + 60_000);
const prog = async (req: StockRequest) => (await view()).items.find((x) => x.request.id === req.id)!.progress;

beforeEach(async () => {
  resetDemo();
  await db.createSite({ id: "GRE", name: "Greenwich", kind: "restaurant" });
});

describe("stock & purchasing: the brief's scenarios", () => {
  it("1–4. two restaurants ask for the same Wing Yip product; one driver buys part; the rest stays with its restaurant", async () => {
    const [eas] = (await report("EAS", "DEMO-BOH", [{ name: "Coconut Milk", level: "low", qty: 2 }])).created;
    const [gre] = (await report("GRE", "DEMO-FLT", [{ name: "Coconut Milk", level: "out", qty: 3 }])).created;
    const { catalog, items, data } = await view();
    const wy = catalog.suppliers.find((s) => s.name === "Wing Yip (demo)")!;
    const groups = supplierGroups(items, catalog.products, catalog.suppliers, data.events, catalog.prices);
    const g = groups.find((x) => x.supplier?.id === wy.id)!;
    expect(g.rows).toHaveLength(1);
    expect(g.rows[0].toPlan).toBe(5);
    expect(g.rows[0].sites.map((s) => [s.siteId, s.toPlan])).toEqual([["EAS", 2], ["GRE", 3]]);
    expect(g.urgent).toBe(true); // Greenwich is out

    const made = await db.createStockTask({ supplierId: wy.id, method: "shop", assigneeId: "DEMO-FLT", priority: "normal", requiredBy: "2026-10-17", createdBy: "DEMO-OWN" },
      [{ requestId: eas.id, qty: 2 }, { requestId: gre.id, qty: 3 }]);
    expect(made.ok).toBe(true);
    const taskId = (made as { value: string }).value;
    expect(await prog(eas)).toMatchObject({ state: "assigned", planned: 2, toPlan: 0 });

    const t = (await db.stockTask(taskId))!;
    const lineOf = (r: StockRequest) => t.lines.find((l) => l.requestId === r.id)!;
    expect((await db.addStockEvent({ by: "DEMO-FLT", kind: "bought", lineId: lineOf(eas).id, qty: 2 })).ok).toBe(true);
    expect((await db.addStockEvent({ by: "DEMO-FLT", kind: "bought", lineId: lineOf(gre).id, qty: 1 })).ok).toBe(true);
    expect(await prog(eas)).toMatchObject({ state: "on_the_way", obtained: 2, toPlan: 0, toReceive: 2 });
    expect(await prog(gre)).toMatchObject({ state: "part_bought", obtained: 1, toPlan: 2, toReceive: 1 });
    // Bought is not received: the task is done, the requests aren't.
    const after = (await db.stockTask(taskId))!;
    expect(taskState(after.tasks[0], after.lines, after.events)).toBe("done");
    // The 2 still needed are Greenwich's, and show again for the owner.
    const again = await view();
    const row = supplierGroups(again.items, again.catalog.products, again.catalog.suppliers, again.data.events, again.catalog.prices).find((x) => x.supplier?.id === wy.id)!.rows[0];
    expect(row.sites.map((s) => [s.siteId, s.toPlan])).toEqual([["GRE", 2]]);
    // Each restaurant confirms what arrived.
    expect((await db.addStockReceipt(eas.id, 2, "DEMO-BOH")).ok).toBe(true);
    expect(await prog(eas)).toMatchObject({ state: "received", received: 2 });
    expect((await db.addStockReceipt(gre.id, 2, "DEMO-FLT")).ok).toBe(false); // only 1 was bought
  });

  it("5. an Amazon order goes to an online buyer: ordered (with a reference), then received", async () => {
    const [z] = (await report("EAS", "DEMO-FOH", [{ name: "Z-Fold Tissue", level: "low", qty: 3 }])).created;
    const { catalog } = await view();
    const amz = catalog.suppliers.find((s) => s.name === "Amazon (demo)")!;
    const made = await db.createStockTask({ supplierId: amz.id, method: "online", assigneeId: "DEMO-MGR", priority: "normal", createdBy: "DEMO-OWN" }, [{ requestId: z.id, qty: 3 }]);
    const id = (made as { value: string }).value;
    await db.addStockEvent({ by: "DEMO-MGR", kind: "ordered", taskId: id, ref: "205-1234567", on: "2026-10-18" });
    const t = (await db.stockTask(id))!;
    expect(taskState(t.tasks[0], t.lines, t.events)).toBe("ordered");
    expect(await prog(z)).toMatchObject({ state: "assigned", obtained: 0 }); // placing the order on a website isn't buying it yet
    await db.addStockEvent({ by: "DEMO-MGR", kind: "bought", lineId: t.lines[0].id, qty: 3 });
    await db.addStockEvent({ by: "DEMO-MGR", kind: "cost", taskId: id, pence: 1899, text: "Amazon order" });
    expect((await db.addStockReceipt(z.id, 3, "DEMO-FOH")).ok).toBe(true);
    expect(await prog(z)).toMatchObject({ state: "received" });
    const all = await view();
    expect(spendOf(all.data.tasks, all.data.events, all.catalog.suppliers)).toBe(1899);
  });

  it("6. a production product goes to Wembley's order by itself: requested, dispatched and accepted stay separate", async () => {
    const [soup] = (await report("EAS", "DEMO-BOH", [{ name: "Soup", level: "out", qty: 6 }])).created;
    const v = await view();
    const order = v.data.tasks.find((t) => t.method === "production")!;
    expect(order).toMatchObject({ destination: "EAS", requiredBy: "2026-10-16" });
    expect(v.items.find((x) => x.request.id === soup.id)!.progress).toMatchObject({ state: "assigned", planned: 6 });
    const queue = productionQueue(v.data.tasks, v.data.lines, v.data.requests, v.data.events, v.catalog.products);
    expect(queue[0]).toMatchObject({ requested: 6, dispatched: 0, outstanding: 6 });
    const line = v.data.lines.find((l) => l.requestId === soup.id)!;
    await db.addStockEvent({ by: "DEMO-PRD", kind: "picked", lineId: line.id, qty: 6 });
    expect((await db.addStockEvent({ by: "DEMO-PRD", kind: "dispatched", lineId: line.id, qty: 5, ref: "B-1016", text: "3°C" })).ok).toBe(true);
    expect(await prog(soup)).toMatchObject({ obtained: 5, toPlan: 1, toReceive: 5, state: "part_bought" });
    await db.addStockReceipt(soup.id, 4, "DEMO-BOH", "one bucket damaged");
    expect(await prog(soup)).toMatchObject({ wanted: 6, obtained: 5, received: 4, toReceive: 1, state: "part_received" });
    // A second Eastcote production request that day joins the same order until work on it starts: here it has, so a new one.
    await report("EAS", "DEMO-MGR", [{ name: "Beef Brisket", level: "low", qty: 8 }]);
    expect((await view()).data.tasks.filter((t) => t.method === "production")).toHaveLength(2);
  });

  it("7. staff can't run purchasing or see someone else's task; the production team sees production orders", async () => {
    const people = await db.people();
    const p = (id: string) => people.find((x) => x.id === id)!;
    expect(runsPurchasing(p("DEMO-OWN"))).toBe(true);
    expect(runsPurchasing(p("DEMO-FOH"))).toBe(false);
    expect(runsPurchasing(p("DEMO-OPS"))).toBe(false);
    const task = { id: "t", code: 1, method: "shop" as const, assigneeId: "DEMO-FLT", priority: "normal" as const, createdBy: "DEMO-OWN", createdAt: 0 };
    expect(canSeeTask(p("DEMO-FLT"), task)).toBe(true);
    expect(canSeeTask(p("DEMO-FOH"), task)).toBe(false);
    const po = { ...task, method: "production" as const, assigneeId: undefined };
    expect(canSeeTask(p("DEMO-PRD"), po, { siteId: "WEM", method: "production" })).toBe(true);
    expect(canSeeTask(p("DEMO-BOH"), po, { siteId: "WEM", method: "production" })).toBe(false);
    expect(onProductionTeam(p("DEMO-FLT"), "WEM")).toBe(true);
  });

  it("8. a report sent twice makes its requests once; reporting an open product again notes it instead of a duplicate", async () => {
    const lime = await product("Lime");
    await db.saveStockDraft("EAS", "DEMO-BOH", "2026-10-16", [{ productId: lime.id, level: "low", qty: 1 }], false);
    const first = await sendStockReport(db, person("DEMO-BOH"), site("EAS"), NOW);
    const second = await sendStockReport(db, person("DEMO-BOH"), site("EAS"), NOW);
    expect(first.ok && first.value.created).toHaveLength(1);
    expect(second.ok).toBe(false);
    const again = await report("EAS", "DEMO-FOH", [{ name: "Lime", level: "out", qty: 2, note: "none left" }]);
    expect(again.created).toHaveLength(0);
    expect(again.again).toBe(1);
    const v = await view();
    expect(v.data.requests.filter((r) => r.productId === lime.id)).toHaveLength(1);
    expect(v.data.events.filter((e) => e.kind === "reported_again")).toHaveLength(1);
    const g = supplierGroups(v.items, v.catalog.products, v.catalog.suppliers, v.data.events, v.catalog.prices);
    expect(g.flatMap((x) => x.rows).find((r) => r.product.id === lime.id)!.urgent).toBe(true); // reported out the second time
  });

  it("9. the owner changes a request's supplier after it was sent, but not once it's assigned", async () => {
    const [oil] = (await report("EAS", "DEMO-BOH", [{ name: "Pride Rapeseed Oil", level: "low", qty: 2 }])).created;
    const { catalog } = await view();
    const wy = catalog.suppliers.find((s) => s.name === "Wing Yip (demo)")!;
    expect((await db.changeStockRequest(oil.id, { supplierId: wy.id }, "DEMO-OWN")).ok).toBe(true);
    const v = await view();
    expect(v.data.requests.find((r) => r.id === oil.id)!.supplierId).toBe(wy.id);
    expect(v.data.events.find((e) => e.kind === "supplier_changed")).toMatchObject({ text: "Wing Yip (demo)", by: "DEMO-OWN" });
    await db.createStockTask({ supplierId: wy.id, method: "shop", assigneeId: "DEMO-FLT", priority: "normal", createdBy: "DEMO-OWN" }, [{ requestId: oil.id, qty: 2 }]);
    expect((await db.changeStockRequest(oil.id, { supplierId: null }, "DEMO-OWN")).ok).toBe(false);
    // The task's supplier must match the request's.
    const [tofu] = (await report("EAS", "DEMO-BOH", [{ name: "Tofu", level: "low", qty: 2 }])).created;
    expect((await db.createStockTask({ supplierId: wy.id, method: "shop", priority: "normal", createdBy: "DEMO-OWN" }, [{ requestId: tofu.id, qty: 2 }])).ok).toBe(false);
  });

  it("10. an unavailable product: a substitute is suggested and approved by the owner; nothing is swapped by itself", async () => {
    const [hoisin] = (await report("EAS", "DEMO-BOH", [{ name: "Sweet Hoisin Sauce", level: "out", qty: 4 }])).created;
    const { catalog } = await view();
    const wy = catalog.suppliers.find((s) => s.name === "Wing Yip (demo)")!;
    const id = ((await db.createStockTask({ supplierId: wy.id, method: "shop", assigneeId: "DEMO-FLT", priority: "urgent", createdBy: "DEMO-OWN" }, [{ requestId: hoisin.id, qty: 4 }])) as { value: string }).value;
    const t = (await db.stockTask(id))!;
    const line = t.lines[0];
    await db.addStockEvent({ by: "DEMO-FLT", kind: "substitute", lineId: line.id, text: "Lee Kum Kee hoisin 2.27kg" });
    let views = taskLines(t.tasks[0], (await db.stockTask(id))!.lines, t.requests, (await db.stockTask(id))!.events);
    expect(views[0].substitute?.text).toBe("Lee Kum Kee hoisin 2.27kg");
    expect(views[0].substituteAnswer).toBeUndefined();
    expect(views[0].end).toBeUndefined(); // still open: a suggestion changes nothing
    await db.addStockEvent({ by: "DEMO-OWN", kind: "substitute_ok", lineId: line.id, text: "Yes, same allergens" });
    const d = (await db.stockTask(id))!;
    views = taskLines(d.tasks[0], d.lines, d.requests, d.events);
    expect(views[0].substituteAnswer?.kind).toBe("substitute_ok");
    // If it can't be got at all, the quantity goes back to the owner with a note of where it wasn't available.
    const other = await db.createStockTask({ supplierId: wy.id, method: "shop", assigneeId: "DEMO-FLT", priority: "normal", createdBy: "DEMO-OWN" }, [{ requestId: hoisin.id, qty: 1 }]);
    expect(other.ok).toBe(false); // all 4 already on the first task
    await db.addStockEvent({ by: "DEMO-FLT", kind: "unavailable", lineId: line.id, text: "none on the shelf" });
    expect(await prog(hoisin)).toMatchObject({ state: "waiting", toPlan: 4 });
    expect((await prog(hoisin)).unavailable?.text).toBe("none on the shelf");
  });
});

describe("stock & purchasing: guard rails", () => {
  it("a line ends once, never above what it asked for", async () => {
    const [w] = (await report("EAS", "DEMO-BOH", [{ name: "Wings", level: "low", qty: 5 }])).created;
    const { catalog } = await view();
    const lidl = catalog.suppliers.find((s) => s.name === "Lidl/Aldi (demo)")!;
    const id = ((await db.createStockTask({ supplierId: lidl.id, method: "shop", assigneeId: "DEMO-FLT", priority: "normal", createdBy: "DEMO-OWN" }, [{ requestId: w.id, qty: 5 }])) as { value: string }).value;
    const line = (await db.stockTask(id))!.lines[0];
    expect((await db.addStockEvent({ by: "DEMO-FLT", kind: "bought", lineId: line.id, qty: 6 })).ok).toBe(false);
    expect((await db.addStockEvent({ by: "DEMO-FLT", kind: "bought", lineId: line.id, qty: 4 })).ok).toBe(true);
    expect((await db.addStockEvent({ by: "DEMO-FLT", kind: "bought", lineId: line.id, qty: 1 })).ok).toBe(false); // no double purchase
    expect(checkLineEnd("unavailable", undefined, line, [])).toEqual({ ok: true, qty: 0 });
  });

  it("not sure of the quantity: it waits for the owner, who sets one before it's bought", async () => {
    const [t] = (await report("EAS", "DEMO-BOH", [{ name: "Tofu", level: "low" }])).created;
    expect(await prog(t)).toMatchObject({ state: "needs_qty", toPlan: 0 });
    expect(wantedOf(t)).toBeUndefined();
    const { catalog } = await view();
    const main = catalog.suppliers.find((s) => s.name === "Main Supplier (demo)")!;
    expect((await db.createStockTask({ supplierId: main.id, method: "delivery", priority: "normal", createdBy: "DEMO-OWN" }, [{ requestId: t.id, qty: 2 }])).ok).toBe(false);
    expect((await db.changeStockRequest(t.id, { fixedQty: 3 }, "DEMO-OWN")).ok).toBe(true);
    expect(await prog(t)).toMatchObject({ state: "waiting", wanted: 3, toPlan: 3 });
  });

  it("cancelling a task puts its open lines back; a cancelled request can't be bought", async () => {
    const [l] = (await report("EAS", "DEMO-BOH", [{ name: "Lime", level: "low", qty: 2 }])).created;
    const { catalog } = await view();
    const main = catalog.suppliers.find((s) => s.name === "Main Supplier (demo)")!;
    const id = ((await db.createStockTask({ supplierId: main.id, method: "delivery", assigneeId: "DEMO-MGR", priority: "normal", createdBy: "DEMO-OWN" }, [{ requestId: l.id, qty: 2 }])) as { value: string }).value;
    expect(await db.cancelStockTask(id, "DEMO-OWN", "ordered by phone instead")).toBe(true);
    expect(await prog(l)).toMatchObject({ state: "waiting", toPlan: 2 });
    expect((await db.changeStockRequest(l.id, { cancel: "not needed" }, "DEMO-OWN")).ok).toBe(true);
    expect((await prog(l)).state).toBe("cancelled");
    expect((await db.createStockTask({ supplierId: main.id, method: "delivery", priority: "normal", createdBy: "DEMO-OWN" }, [{ requestId: l.id, qty: 1 }])).ok).toBe(false);
  });

  it("no stock issues today is recorded as a report with nothing in it", async () => {
    await db.saveStockDraft("EAS", "DEMO-BOH", "2026-10-16", [], true);
    const r = await sendStockReport(db, person("DEMO-BOH"), site("EAS"), NOW);
    expect(r.ok && r.value.noIssues).toBe(true);
    expect((await db.stockReports(["EAS"], 0))[0]).toMatchObject({ noIssues: true, lines: [] });
    await db.saveStockDraft("EAS", "DEMO-BOH", "2026-10-16", [], false);
    expect((await sendStockReport(db, person("DEMO-BOH"), site("EAS"), NOW)).ok).toBe(false); // empty without saying so
  });
});

describe("stock & purchasing: after the review", () => {
  it("a product already bought (not yet confirmed) and reported again is a new need, not lost", async () => {
    const [lime] = (await report("EAS", "DEMO-BOH", [{ name: "Lime", level: "out", qty: 2 }])).created;
    const { catalog } = await view();
    const main = catalog.suppliers.find((s) => s.name === "Main Supplier (demo)")!;
    const id = ((await db.createStockTask({ supplierId: main.id, method: "delivery", assigneeId: "DEMO-MGR", priority: "normal", createdBy: "DEMO-OWN" }, [{ requestId: lime.id, qty: 2 }])) as { value: string }).value;
    expect((await db.orderPlaced(id, "DEMO-MGR", "ORD-1")).ok).toBe(true);
    expect(await prog(lime)).toMatchObject({ state: "on_the_way", obtained: 2 });
    const next = await report("EAS", "DEMO-FOH", [{ name: "Lime", level: "low", qty: 3 }]);
    expect(next.created).toHaveLength(1);
    expect(await prog(next.created[0])).toMatchObject({ state: "waiting", toPlan: 3 });
  });

  it("a quantity given in a later report fills one that was not sure", async () => {
    const [tofu] = (await report("EAS", "DEMO-BOH", [{ name: "Tofu", level: "low" }])).created;
    const r = await report("EAS", "DEMO-FOH", [{ name: "Tofu", level: "low", qty: 4 }]);
    expect(r.created).toHaveLength(0);
    expect(await prog(tofu)).toMatchObject({ state: "waiting", wanted: 4, toPlan: 4 });
  });

  it("routing to production twice doesn't plan it twice", async () => {
    const [soup] = (await report("EAS", "DEMO-BOH", [{ name: "Soup", level: "out", qty: 6 }])).created;
    const { catalog } = await view();
    const prod = catalog.suppliers.find((s) => s.method === "production")!;
    expect(await db.addToProductionOrder(prod.id, "EAS", "2026-10-16", [soup.id], "DEMO-OWN")).toBeUndefined(); // already all on the order
    expect(await prog(soup)).toMatchObject({ planned: 6, toPlan: 0 });
  });

  it("an order placed records every open line bought, together", async () => {
    const [a] = (await report("EAS", "DEMO-BOH", [{ name: "Z-Fold Tissue", level: "low", qty: 2 }, { name: "Blue Rolls", level: "low", qty: 1 }])).created;
    const v = await view();
    const amz = v.catalog.suppliers.find((s) => s.name === "Amazon (demo)")!;
    const reqs = v.data.requests.filter((r) => r.supplierId === amz.id);
    const id = ((await db.createStockTask({ supplierId: amz.id, method: "online", assigneeId: "DEMO-MGR", priority: "normal", createdBy: "DEMO-OWN" }, reqs.map((r) => ({ requestId: r.id, qty: wantedOf(r)! })))) as { value: string }).value;
    await db.cancelStockTask(id, "DEMO-OWN", "wrong supplier");
    expect((await db.orderPlaced(id, "DEMO-MGR")).ok).toBe(false);
    const t2 = ((await db.createStockTask({ supplierId: amz.id, method: "online", assigneeId: "DEMO-MGR", priority: "normal", createdBy: "DEMO-OWN" }, reqs.map((r) => ({ requestId: r.id, qty: wantedOf(r)! })))) as { value: string }).value;
    expect((await db.orderPlaced(t2, "DEMO-MGR", "205-1")).ok).toBe(true);
    const d = (await db.stockTask(t2))!;
    expect(taskState(d.tasks.find((t) => t.id === t2)!, d.lines, d.events)).toBe("done");
    expect(await prog(a)).toMatchObject({ state: "on_the_way" });
    const first = (await db.stockTask(id))!;
    expect(taskState(first.tasks.find((t) => t.id === id)!, first.lines, first.events)).toBe("cancelled");
  });

  it("an old request still in hand stays on the dashboard", async () => {
    const [w] = (await report("EAS", "DEMO-BOH", [{ name: "Wings", level: "low", qty: 2 }])).created;
    const later = await stockView(db, NOW + 200 * 86_400_000);
    expect(later.items.some((x) => x.request.id === w.id)).toBe(true);
  });
});

describe("stock rules", () => {
  const P = (over: Partial<Product> = {}): Product => ({ id: "p", name: "Fish sauce", active: true, ...over });
  it("cleans report lines: known products, once each, quantity above 0 or not sure", () => {
    const products = [P({ id: "a" }), P({ id: "b", active: false })];
    expect(cleanLines([{ productId: "a", level: "low", qty: 2.555 }, { productId: "a", level: "out" }], products)).toEqual({ ok: true, value: [{ productId: "a", level: "low", qty: 2.56 }] });
    expect(cleanLines([{ productId: "b", level: "low" }], products).ok).toBe(false);
    expect(cleanLines([{ productId: "a", level: "low", qty: 0 }], products).ok).toBe(false);
    expect(cleanLines([{ productId: "a", level: "gone" as "low" }], products).ok).toBe(false);
  });
  it("keeps different sizes and suppliers as different products", () => {
    const existing = [{ id: "x", name: "Basil Seed", size: "Bag Large", supplierId: "wy" }];
    expect(cleanProduct({ name: "basil seed", size: "bag large", supplierId: "wy" }, [{ id: "wy" }], existing).ok).toBe(false);
    expect(cleanProduct({ name: "Basil Seed", size: "Bag Medium", supplierId: "wy" }, [{ id: "wy" }], existing).ok).toBe(true);
    expect(cleanProduct({ name: "Basil Seed", size: "Bag Large", link: "http://x" }, [{ id: "wy" }], existing).ok).toBe(false);
  });
  it("a production supplier names its kitchen; links are https", () => {
    expect(cleanSupplier({ name: "Production", method: "production" }, []).ok).toBe(false);
    expect(cleanSupplier({ name: "Production", method: "production", siteId: "WEM" }, []).ok).toBe(true);
    expect(cleanSupplier({ name: "Amazon", method: "online", link: "amazon.co.uk" }, []).ok).toBe(false);
    expect(cleanSupplier({ name: "wing yip", method: "shop" }, [{ id: "1", name: "Wing Yip" }]).ok).toBe(false);
  });
  it("prices are history: the latest, its age, never £0 for unknown", () => {
    const prices = [{ productId: "a", pence: 100, on: "2025-01-01" }, { productId: "a", pence: 120, on: "2025-09-03" }];
    expect(latestPrice(prices, "a")?.pence).toBe(120);
    expect(latestPrice(prices, "b")).toBeUndefined();
    expect(priceAge("2025-09-03", "2026-10-16")).toBe("13 months old");
    expect(priceAge("2026-10-10", "2026-10-16")).toBe("6 days old");
  });
  it("suggests a typical quantity and the products asked for most", () => {
    const h = [3, 5, 4, 100].map((qty, i) => ({ productId: "a", siteId: "EAS", qty, createdAt: NOW - i * 86_400_000 }));
    expect(typicalQty(h, "a", "EAS")).toBe(4);
    expect(typicalQty(h, "a", "GRE")).toBeUndefined();
    expect(frequent([...h, { productId: "b", siteId: "EAS", createdAt: NOW }], "EAS", NOW)).toEqual(["a", "b"]);
  });
  it("an order summary lists each product once, added up", () => {
    const t = { id: "t", code: 7, method: "delivery" as const, priority: "normal" as const, createdBy: "o", createdAt: 0, requiredBy: "2026-10-17" };
    const r = (id: string, siteId: string): StockRequest => ({ id, code: 1, siteId, productId: "p", level: "low", requestedBy: "x", createdAt: 0 });
    const views = [{ line: { id: "1", taskId: "t", requestId: "a", qty: 2 }, request: r("a", "EAS") }, { line: { id: "2", taskId: "t", requestId: "b", qty: 3 }, request: r("b", "GRE") }];
    expect(orderSummary(t, views, [P({ size: "Case" })], undefined, new Map())).toBe("PHO & CO order PT-0007, needed by 2026-10-17\n- 5 x Fish sauce · Case");
  });
  it("progress counts only lines on live tasks", () => {
    const r: StockRequest = { id: "r", code: 1, siteId: "EAS", productId: "p", level: "low", qty: 4, requestedBy: "x", createdAt: 0 };
    const lines = [{ id: "l1", taskId: "t1", requestId: "r", qty: 4 }];
    expect(progress(r, lines, [], [], [{ id: "t1" }]).state).toBe("assigned");
    expect(progress(r, lines, [], [], [{ id: "t1", cancelledAt: 1 }]).state).toBe("waiting");
    expect(withProgress({ requests: [r], lines, events: [], receipts: [], tasks: [{ id: "t1" }] })[0].progress.planned).toBe(4);
  });
});
