import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoStore as db, resetDemo } from "@/lib/data/demo-store";
import { buyFrom, canUntick, editsSiteNeeded, qtyPlan, siteWaitingRows, tickDayStart, untickedLines, cleanAlsoFrom, cleanNewItems, lookAlikes, neededSheet, sentTodayLine, neededCount, orderSheetLines, orderingSites, runsOrdering } from "@/lib/domain/stock";
import { buildPdf, checklistPdf, fitText, orderSheetPdf, pdfString } from "@/lib/pdf";
import { addNewItem, clearNeeded, deliversTo, moveNeeded, driverTick, driverUntick, giveToDriver, neededView, editSiteNeeded, sendStockReport, siteNeededView, stockView, tickNeeded, untickNeeded } from "@/lib/stock-service";

const NOW = Date.UTC(2026, 9, 16, 21, 0);

async function report(siteId: string, personId: string, lines: { name: string; qty: number; level?: "low" | "out" }[]) {
  const { products } = await db.stockCatalog();
  const ls = lines.map((l) => ({ productId: products.find((p) => p.name === l.name)!.id, level: l.level ?? "low" as const, qty: l.qty }));
  await db.saveStockDraft(siteId, personId, "2026-10-16", ls, false);
  const r = await sendStockReport(db, { id: personId }, { id: siteId }, NOW);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}
const owner = async () => (await db.person("DEMO-OWN"))!;
const groups = async (who = "DEMO-OWN") => (await neededView(db, (await db.person(who))!, NOW + 60_000)).groups;
const group = async (name: string, who?: string) => (await groups(who)).find((g) => g.supplier?.name === name);
const state = async (requestId: string) => (await stockView(db, NOW + 60_000)).items.find((x) => x.request.id === requestId)!.progress.state;

beforeEach(() => { resetDemo(); });

describe("stock needed: one checklist by supplier", () => {
  it("adds up the same product across restaurants, under its supplier, for owners and operations managers", async () => {
    await report("EAS", "DEMO-BOH", [{ name: "Lime", qty: 2 }, { name: "Coconut Milk", qty: 4, level: "out" }]);
    await report("WEM", "DEMO-PRD", [{ name: "Lime", qty: 3 }]);
    const g = (await group("Surelygrow (demo)"))!;
    const lime = g.rows.find((r) => r.product.name === "Lime")!;
    expect(lime.qty).toBe(5);
    expect(lime.sites.map((s) => [s.siteId, s.qty])).toEqual([["EAS", 2], ["WEM", 3]]);
    expect((await group("Wing Yip (demo)"))!.rows[0]).toMatchObject({ qty: 4, urgent: true });
    expect(orderSheetLines(g)).toEqual([{ qty: 5, name: "Lime", pack: "Case" }]);
    expect(neededCount(await groups())).toBe(2);
    // Operations managers see their sites; staff and managers don't order.
    const ops = (await db.person("DEMO-OPS"))!;
    expect(runsOrdering(ops)).toBe(true);
    expect(orderingSites(ops, ["EAS", "WEM", "SYD"])).toEqual(["EAS", "WEM"]);
    expect(runsOrdering((await db.person("DEMO-MGR"))!)).toBe(false);
    expect(runsOrdering((await db.person("DEMO-BOH"))!)).toBe(false);
  });

  it("a tick is done: ordered and arrived, gone from the list, and can't be ticked twice", async () => {
    const { created } = await report("EAS", "DEMO-BOH", [{ name: "Lime", qty: 2 }, { name: "Tofu", qty: 1 }]);
    const g = (await group("Surelygrow (demo)"))!;
    const lime = g.rows.find((r) => r.product.name === "Lime")!.product.id;
    const r = await tickNeeded(db, await owner(), g.key, [lime], NOW);
    expect(r).toEqual({ ok: true, value: { ticked: 1 } });
    expect(await state(created.find((x) => x.productId === lime)!.id)).toBe("received");
    expect((await group("Surelygrow (demo)"))!.rows.map((x) => x.product.name)).toEqual(["Tofu"]);
    expect((await tickNeeded(db, await owner(), g.key, [lime], NOW)).ok).toBe(false);
  });

  it("production items are on the kitchen's order as soon as they're asked for, and a tick sends them", async () => {
    const { created } = await report("EAS", "DEMO-BOH", [{ name: "Soup", qty: 6 }]);
    const g = (await groups()).find((x) => x.production)!;
    expect(g.rows[0]).toMatchObject({ qty: 6 });
    expect(g.rows[0].lineIds).toHaveLength(1);
    expect((await tickNeeded(db, await owner(), g.key, [g.rows[0].product.id], NOW)).ok).toBe(true);
    expect(await state(created[0].id)).toBe("received");
    // Off the list; it stays on the card under "Sent today" until 05:00 (see unticking).
    expect((await groups()).find((x) => x.production)?.rows ?? []).toEqual([]);
  });

  it("a shop list given to a driver: theirs to tick; what they couldn't get comes back", async () => {
    const { created } = await report("EAS", "DEMO-BOH", [{ name: "Coconut Milk", qty: 4 }, { name: "Che Lychee", qty: 2 }]);
    const g = (await group("Wing Yip (demo)"))!;
    const made = await giveToDriver(db, await owner(), g.key, "DEMO-FLT", undefined, NOW);
    expect(made.ok).toBe(true);
    const after = (await group("Wing Yip (demo)"))!;
    expect(after.rows).toHaveLength(0);
    expect(after.drivers[0]).toMatchObject({ open: 2, done: 0 });
    const task = (await db.stockTask((made as { value: string }).value))!;
    const lineOf = (name: string) => task.lines.find((l) => l.requestId === created.find((c) => c.productId === g.rows.find((r) => r.product.name === name)!.product.id)!.id)!;
    expect((await driverTick(db, { id: "DEMO-BOH" }, lineOf("Coconut Milk").id, true, NOW)).ok).toBe(false); // not theirs
    expect((await driverTick(db, { id: "DEMO-FLT" }, lineOf("Coconut Milk").id, true, NOW)).ok).toBe(true);
    expect((await driverTick(db, { id: "DEMO-FLT" }, lineOf("Coconut Milk").id, true, NOW)).ok).toBe(false); // once
    expect((await driverTick(db, { id: "DEMO-FLT" }, lineOf("Che Lychee").id, false, NOW)).ok).toBe(true);
    const back = (await group("Wing Yip (demo)"))!;
    expect(back.drivers).toHaveLength(0);
    expect(back.rows.map((r) => [r.product.name, r.qty])).toEqual([["Che Lychee", 2]]);
    expect(await state(created.find((c) => c.productId === g.rows.find((r) => r.product.name === "Coconut Milk")!.product.id)!.id)).toBe("received");
  });

  it("taking a list back from a driver puts what's left back on the list", async () => {
    await report("EAS", "DEMO-BOH", [{ name: "Coconut Milk", qty: 4 }]);
    const g = (await group("Wing Yip (demo)"))!;
    const made = await giveToDriver(db, await owner(), g.key, "DEMO-FLT", undefined, NOW);
    expect(await db.cancelStockTask((made as { value: string }).value, "DEMO-OWN", "taken back")).toBe(true);
    expect((await group("Wing Yip (demo)"))!.rows[0]).toMatchObject({ qty: 4 });
  });

  it("the order sheet names where the supplier delivers", async () => {
    const g = { supplier: (await db.stockCatalog()).suppliers.find((s) => s.name === "Surelygrow (demo)")! };
    expect(await deliversTo(db, g.supplier.id)).toBe("Wembley");
  });
});

describe("order sheet PDF", () => {
  it("escapes text in WinAnsi and fits long names", () => {
    expect(pdfString("a (b) \\ £5 – ok")).toBe("(a \\(b\\) \\\\ \\2435 \\226 ok)");
    expect(pdfString("中")).toBe("(?)");
    expect(fitText("A".repeat(200), 12, 100).endsWith("...")).toBe(true);
    expect(fitText("Lime", 12, 100)).toBe("Lime");
  });

  it("is a valid PDF over several pages, with every line in it", () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ qty: String(i + 1), item: `Item ${i + 1}`, pack: "Case" }));
    const pdf = orderSheetPdf({ title: "PHO & CO stock order: Surelygrow", lines: ["Deliver to: PHO & CO Wembley"], rows, foot: "100 items." });
    const text = Buffer.from(pdf).toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    // The xref offsets point at the objects.
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe("xref");
    const offsets = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((o, i) => expect(text.slice(o).startsWith(`${i + 1} 0 obj`)).toBe(true));
    const pages = Number(/\/Count (\d+)/.exec(text)![1]);
    expect(pages).toBeGreaterThanOrEqual(3);
    expect(buildPdf([], "x").length).toBeGreaterThan(100);
    // Where pdftotext is installed, read it back.
    let out: string | undefined;
    try {
      const dir = mkdtempSync(join(tmpdir(), "pdf-"));
      writeFileSync(join(dir, "o.pdf"), pdf);
      out = execFileSync("pdftotext", ["-layout", join(dir, "o.pdf"), "-"], { encoding: "utf8" });
    } catch { out = undefined; }
    if (out !== undefined) {
      expect(out).toContain("PHO & CO stock order: Surelygrow");
      for (const i of [1, 50, 100]) expect(out).toContain(`Item ${i}`);
      expect(out).toContain(`Page ${pages} of ${pages}`);
    }
  });
});

describe("new items: asked for but not in the catalogue", () => {
  const sendWith = async (extras: { name: string; size?: string; qty?: number; note?: string }[], lines: { name: string; qty: number }[] = []) => {
    const { products } = await db.stockCatalog();
    await db.saveStockDraft("EAS", "DEMO-BOH", "2026-10-16", lines.map((l) => ({ productId: products.find((p) => p.name === l.name)!.id, level: "low" as const, qty: l.qty })), false, extras);
    return sendStockReport(db, { id: "DEMO-BOH" }, { id: "EAS" }, NOW);
  };

  it("are checked: a name, how many to send, once each", () => {
    expect(cleanNewItems([{ name: "  Nitrile   gloves ", size: " Box of 100 ", qty: 2.555 }, { name: "nitrile gloves", size: "box of 100", qty: 1 }]))
      .toEqual({ ok: true, value: [{ name: "Nitrile gloves", size: "Box of 100", qty: 2.56 }] });
    expect(cleanNewItems([{ name: "x", qty: 1 }]).ok).toBe(false);
    expect(cleanNewItems([{ name: "Bleach" }]).ok).toBe(false);
    expect(cleanNewItems([{ name: "Bleach" }], { draft: true }).ok).toBe(true);
    expect(cleanNewItems([{ name: "Bleach", qty: 0 }]).ok).toBe(false);
    expect(cleanNewItems(Array.from({ length: 21 }, (_, i) => ({ name: `Item ${i}`, qty: 1 }))).ok).toBe(false);
    expect(lookAlikes("Coconut cream", [{ id: "a", name: "Coconut Milk", active: true }, { id: "b", name: "Lime", active: true }]).map((p) => p.id)).toEqual(["a"]);
  });

  it("go to the owner with the report (a report of only new items is fine), and the owner is told", async () => {
    const r = await sendWith([{ name: "Nitrile gloves", size: "Box of 100", qty: 2, note: "large" }]);
    expect(r.ok && r.value.newItems).toHaveLength(1);
    expect(r.ok && r.value.noIssues).toBe(false);
    const open = await db.stockNewItems({ open: true });
    expect(open[0]).toMatchObject({ siteId: "EAS", name: "Nitrile gloves", size: "Box of 100", qty: 2, note: "large", requestedBy: "DEMO-BOH" });
    expect((await db.notices("DEMO-OWN", 10)).some((n) => n.title === "New item asked for · Eastcote" && n.url === "/stock/needed")).toBe(true);
    expect((await sendWith([{ name: "Bleach" }])).ok).toBe(false); // no amount
  });

  it("the owner adds one to the catalogue: it's ordered under its supplier and on the list next time", async () => {
    await sendWith([{ name: "Nitrile gloves", size: "Box of 100", qty: 2 }]);
    const [item] = await db.stockNewItems({ open: true });
    const lidl = (await db.stockCatalog()).suppliers.find((x) => x.name === "Lidl/Aldi (demo)")!;
    expect((await addNewItem(db, (await db.person("DEMO-OPS"))!, item.id, { name: "Nitrile Gloves L", size: "Box of 100", supplierId: lidl.id, qty: 3 }, NOW)).ok).toBe(false); // owner only
    const r = await addNewItem(db, await owner(), item.id, { name: "Nitrile Gloves L", size: "Box of 100", category: "Cleaning", supplierId: lidl.id, qty: 3 }, NOW);
    expect(r).toMatchObject({ ok: true, value: { created: true } });
    const product = (await db.stockCatalog()).products.find((p) => p.name === "Nitrile Gloves L")!;
    expect(product).toMatchObject({ size: "Box of 100", category: "Cleaning", supplierId: lidl.id, active: true });
    expect((await group("Lidl/Aldi (demo)"))!.rows.map((x) => [x.product.name, x.qty, x.sites[0].siteId])).toEqual([["Nitrile Gloves L", 3, "EAS"]]);
    expect(await db.stockNewItems({ open: true })).toHaveLength(0);
    expect((await addNewItem(db, await owner(), item.id, { productId: product.id, qty: 1 }, NOW)).ok).toBe(false); // once
  });

  it("one that's already in the catalogue is ordered as that product; production goes to the kitchen; one not needed is kept", async () => {
    await sendWith([{ name: "Coconut cream", qty: 4 }, { name: "Pho soup", qty: 2 }, { name: "Glitter", qty: 1 }]);
    const items = await db.stockNewItems({ open: true });
    const { products } = await db.stockCatalog();
    const coco = products.find((p) => p.name === "Coconut Milk")!, soup = products.find((p) => p.name === "Soup")!;
    const before = products.length;
    expect((await addNewItem(db, await owner(), items[0].id, { productId: coco.id, qty: 4 }, NOW))).toMatchObject({ ok: true, value: { created: false } });
    expect((await addNewItem(db, await owner(), items[1].id, { productId: soup.id, qty: 2 }, NOW)).ok).toBe(true);
    expect((await db.decideNewItem(items[2].id, "DEMO-OWN", { dismiss: "Not something we stock" })).ok).toBe(true);
    expect((await db.decideNewItem(items[2].id, "DEMO-OWN", { dismiss: "again" })).ok).toBe(false);
    expect((await db.stockCatalog()).products).toHaveLength(before);
    expect((await group("Wing Yip (demo)"))!.rows[0]).toMatchObject({ qty: 4 });
    const prod = (await groups()).find((g) => g.production)!;
    expect(prod.rows[0]).toMatchObject({ qty: 2 });
    expect(prod.rows[0].lineIds).toHaveLength(1); // straight onto the kitchen's order
    expect((await db.stockNewItems({})).find((n) => n.id === items[2].id)).toMatchObject({ dismissed: "Not something we stock", decidedBy: "DEMO-OWN" });
  });
});

describe("clearing Stock needed", () => {
  it("cancels everything on it (drivers' lists too), keeps what's partly bought, and leaves the history", async () => {
    const { created } = await report("EAS", "DEMO-BOH", [{ name: "Lime", qty: 2 }, { name: "Soup", qty: 6 }, { name: "Coconut Milk", qty: 4 }, { name: "Che Lychee", qty: 2 }]);
    const wy = (await group("Wing Yip (demo)"))!;
    const made = await giveToDriver(db, await owner(), wy.key, "DEMO-FLT", [wy.rows.find((r) => r.product.name === "Coconut Milk")!.product.id], NOW);
    const task = (await db.stockTask((made as { value: string }).value))!;
    // Che Lychee: half bought on another list, so it can't be cancelled.
    const che = created.find((c) => c.productId === wy.rows.find((r) => r.product.name === "Che Lychee")!.product.id)!;
    const t2 = await db.createStockTask({ supplierId: wy.supplier!.id, method: "shop", assigneeId: "DEMO-FLT", priority: "normal", createdBy: "DEMO-OWN" }, [{ requestId: che.id, qty: 1 }]);
    const l2 = (await db.stockTask((t2 as { value: string }).value))!.lines[0];
    await db.addStockEvent({ by: "DEMO-FLT", kind: "bought", lineId: l2.id, qty: 1 });
    expect((await clearNeeded(db, (await db.person("DEMO-BOH"))!, NOW)).ok).toBe(false); // staff can't
    const r = await clearNeeded(db, (await db.person("DEMO-OPS"))!, NOW);
    expect(r).toMatchObject({ ok: true, value: { cancelled: 3, kept: 1, lists: 1 } });
    expect((await db.stockTask(task.tasks[0].id))!.tasks[0].cancelledAt).toBeDefined();
    const left = await groups();
    expect(left.flatMap((g) => g.rows.map((x) => [x.product.name, x.qty]))).toEqual([["Che Lychee", 1]]);
    expect(await state(created.find((c) => c.productId === (wy.rows.find((x) => x.product.name === "Coconut Milk")!.product.id))!.id)).toBe("cancelled");
  });
});

describe("the Report stock tile", () => {
  it("names each sender once, newest first, with when the last report went", () => {
    const hm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
    const at = (h: number) => Date.UTC(2026, 9, 16, h, 30);
    expect(sentTodayLine([{ personName: "Vishal Test", submittedAt: at(13) }, { personName: "Vishal Test", submittedAt: at(16) }, { personName: "Vishal Test", submittedAt: at(14) }], hm))
      .toBe("Sent today by Vishal · last at 16:30");
    expect(sentTodayLine([{ personName: "Anh B", submittedAt: at(12) }, { personName: "Vishal T", submittedAt: at(15) }, { personName: "Anh B", submittedAt: at(10) }], hm))
      .toBe("Sent today by Vishal, Anh · last at 15:30");
    expect(sentTodayLine([], hm)).toBeUndefined();
  });
});

describe("the tick-off sheet", () => {
  it("lists new items first, then each supplier's items with who they're for, urgent and drivers' lists", async () => {
    await report("EAS", "DEMO-BOH", [{ name: "Lime", qty: 2 }, { name: "Coconut Milk", qty: 4, level: "out" }, { name: "Che Lychee", qty: 1 }]);
    await report("WEM", "DEMO-PRD", [{ name: "Lime", qty: 3 }]);
    const wy = (await group("Wing Yip (demo)"))!;
    await giveToDriver(db, await owner(), wy.key, "DEMO-FLT", [wy.rows.find((r) => r.product.name === "Che Lychee")!.product.id], NOW);
    const names: Record<string, string> = { EAS: "Eastcote", WEM: "Wembley" };
    const sheet = neededSheet(await groups(), [{ name: "Gloves", size: "Box of 100", qty: 2, siteId: "EAS" }], (id) => names[id]);
    expect(sheet[0]).toMatchObject({ heading: "New items", rows: [{ qty: "2", item: "Gloves \u00b7 Box of 100", detail: "For Eastcote", flag: "NEW" }] });
    const sg = sheet.find((g) => g.heading === "Surelygrow (demo)")!;
    expect(sg.rows[0]).toMatchObject({ qty: "5", item: "Lime \u00b7 Case", detail: "Eastcote 2 \u00b7 Wembley 3" });
    const w = sheet.find((g) => g.heading === "Wing Yip (demo)")!;
    expect(w.rows).toEqual([{ qty: "4", item: "Coconut Milk \u00b7 Can", detail: "For Eastcote", flag: "URGENT" }]);
    expect(w.notes).toEqual(["With Floater: 1 Che Lychee \u00b7 Can"]);
  });

  it("is a valid PDF that runs on to more pages when the list is long", () => {
    const groups = Array.from({ length: 8 }, (_, g) => ({ heading: `Supplier ${g}`, sub: "Shop trip", rows: Array.from({ length: 20 }, (_, i) => ({ qty: String(i + 1), item: `Item ${g}-${i}`, detail: i % 2 ? "For Eastcote" : undefined, flag: i === 3 ? "URGENT" : undefined })) }));
    const one = Buffer.from(checklistPdf({ title: "PHO & CO stock needed", lines: ["Friday 16 October"], groups: groups.slice(0, 1), foot: "x" })).toString("latin1");
    const many = Buffer.from(checklistPdf({ title: "PHO & CO stock needed", lines: ["Friday 16 October"], groups, foot: "x" })).toString("latin1");
    expect(/\/Count (\d+)/.exec(one)![1]).toBe("1");
    expect(Number(/\/Count (\d+)/.exec(many)![1])).toBeGreaterThan(1);
    expect(many.trimEnd().endsWith("%%EOF")).toBe(true);
  });
});

describe("items sold at more than one shop", () => {
  it("other suppliers are checked: active shops, not a kitchen, not the usual one, once each", async () => {
    const { suppliers } = await db.stockCatalog();
    const id = (n: string) => suppliers.find((s) => s.name === n)!.id;
    expect(cleanAlsoFrom([id("Lidl/Aldi (demo)"), id("Lidl/Aldi (demo)"), id("Wing Yip (demo)")], id("Wing Yip (demo)"), suppliers)).toEqual({ ok: true, value: [id("Lidl/Aldi (demo)")] });
    expect(cleanAlsoFrom([id("Production (demo)")], undefined, suppliers).ok).toBe(false);
    expect(cleanAlsoFrom(["nope"], undefined, suppliers).ok).toBe(false);
    const coco = (await db.stockCatalog()).products.find((p) => p.name === "Coconut Milk")!;
    expect(buyFrom(coco, suppliers).map((s) => s.name)).toEqual(["Wing Yip (demo)", "Lidl/Aldi (demo)"]);
  });

  it("Stock needed moves an item to another shop that sells it, and only to one that does", async () => {
    await report("EAS", "DEMO-BOH", [{ name: "Coconut Milk", qty: 4 }, { name: "Che Lychee", qty: 2 }]);
    await report("WEM", "DEMO-PRD", [{ name: "Coconut Milk", qty: 1 }]);
    const wy = (await group("Wing Yip (demo)"))!;
    const { suppliers } = await db.stockCatalog();
    const lidl = suppliers.find((s) => s.name === "Lidl/Aldi (demo)")!;
    const coco = wy.rows.find((r) => r.product.name === "Coconut Milk")!.product.id;
    const che = wy.rows.find((r) => r.product.name === "Che Lychee")!.product.id;
    expect((await moveNeeded(db, await owner(), wy.key, che, lidl.id, NOW)).ok).toBe(false); // not sold there
    expect(await moveNeeded(db, await owner(), wy.key, coco, lidl.id, NOW)).toMatchObject({ ok: true, value: { moved: 2, kept: 0, to: "Lidl/Aldi (demo)" } });
    expect((await group("Lidl/Aldi (demo)"))!.rows[0]).toMatchObject({ qty: 5 });
    expect((await group("Wing Yip (demo)"))!.rows.map((r) => r.product.name)).toEqual(["Che Lychee"]);
  });

  it("a driver can tick an item as bought at another shop that sells it, and nowhere else", async () => {
    await report("EAS", "DEMO-BOH", [{ name: "Coconut Milk", qty: 4 }, { name: "Che Lychee", qty: 2 }]);
    const wy = (await group("Wing Yip (demo)"))!;
    const made = await giveToDriver(db, await owner(), wy.key, "DEMO-FLT", undefined, NOW);
    const task = (await db.stockTask((made as { value: string }).value))!;
    const { suppliers, products } = await db.stockCatalog();
    const lidl = suppliers.find((s) => s.name === "Lidl/Aldi (demo)")!;
    const lineFor = (name: string) => task.lines.find((l) => task.requests.find((r) => r.id === l.requestId)!.productId === products.find((p) => p.name === name)!.id)!;
    expect((await driverTick(db, { id: "DEMO-FLT" }, lineFor("Che Lychee").id, true, NOW, lidl.id)).ok).toBe(false);
    expect((await driverTick(db, { id: "DEMO-FLT" }, lineFor("Coconut Milk").id, true, NOW, lidl.id)).ok).toBe(true);
    const after = (await db.stockTask(task.tasks[0].id))!;
    expect(after.events.find((e) => e.lineId === lineFor("Coconut Milk").id && e.kind === "bought")?.text).toBe("Bought at Lidl/Aldi (demo)");
  });
});

describe("unticking a mistaken tick", () => {
  // Records are dated by the clock: run these at NOW (21:00 London time on 16 October).
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });
  const at = (ms: number) => async (who = "DEMO-OWN") => (await neededView(db, (await db.person(who))!, ms)).groups;

  it("the working day runs to 05:00 London", () => {
    expect(new Date(tickDayStart(Date.UTC(2026, 9, 16, 21, 0))).toISOString()).toBe("2026-10-16T04:00:00.000Z");
    expect(new Date(tickDayStart(Date.UTC(2026, 9, 17, 3, 59))).toISOString()).toBe("2026-10-16T04:00:00.000Z");
    expect(new Date(tickDayStart(Date.UTC(2026, 9, 17, 4, 0))).toISOString()).toBe("2026-10-17T04:00:00.000Z");
    expect(new Date(tickDayStart(Date.UTC(2026, 11, 1, 12, 0))).toISOString()).toBe("2026-12-01T05:00:00.000Z"); // GMT
  });

  it("a tick stays on its card, crossed out, and Untick puts it back as a new request (the tick is kept)", async () => {
    const { created } = await report("EAS", "DEMO-BOH", [{ name: "Lime", qty: 2 }, { name: "Tofu", qty: 1 }]);
    const g = (await group("Surelygrow (demo)"))!;
    const lime = g.rows.find((r) => r.product.name === "Lime")!.product.id;
    expect((await tickNeeded(db, await owner(), g.key, [lime], NOW)).ok).toBe(true);
    const ticked = (await group("Surelygrow (demo)"))!;
    expect(ticked.rows.map((r) => r.product.name)).toEqual(["Tofu"]);
    expect(ticked.ticked).toMatchObject([{ product: { name: "Lime" }, qty: 2, sites: [{ siteId: "EAS", qty: 2 }], by: ["Owner"] }]);

    const r = await untickNeeded(db, await owner(), g.key, lime, NOW);
    expect(r).toEqual({ ok: true, value: { unticked: 1, name: "Lime" } });
    const back = (await group("Surelygrow (demo)"))!;
    expect(back.rows.map((x) => [x.product.name, x.qty])).toEqual([["Lime", 2], ["Tofu", 1]]);
    expect(back.ticked).toEqual([]);
    // The tick is kept as it was (done); the new request says what it puts back.
    const v = await stockView(db, NOW);
    const old = created.find((x) => x.productId === lime)!;
    expect(v.items.find((x) => x.request.id === old.id)!.progress.state).toBe("received");
    const again = v.items.find((x) => x.request.reopensLine)!;
    expect(again.request).toMatchObject({ siteId: "EAS", productId: lime, qty: 2, requestedBy: "DEMO-BOH" });
    expect(again.progress.state).toBe("waiting");
    expect(v.data.events.filter((e) => e.kind === "note").map((e) => e.text)).toEqual(expect.arrayContaining([expect.stringMatching(/^Unticked: back on the list as SR-/)]));
    // Once only.
    expect((await untickNeeded(db, await owner(), g.key, lime, NOW)).ok).toBe(false);
    expect((await db.untickLine(again.request.reopensLine!, "DEMO-OWN", "list")).ok).toBe(false);
    // Ticked again: done again.
    expect((await tickNeeded(db, await owner(), g.key, [lime], NOW)).ok).toBe(true);
    expect((await group("Surelygrow (demo)"))!.ticked.map((t) => t.product.name)).toEqual(["Lime"]);
  });

  it("a production item unticked goes back onto the kitchen's order", async () => {
    await report("EAS", "DEMO-BOH", [{ name: "Soup", qty: 6 }]);
    const g = (await groups()).find((x) => x.production)!;
    const soup = g.rows[0].product.id;
    expect((await tickNeeded(db, await owner(), g.key, [soup], NOW)).ok).toBe(true);
    expect((await groups()).find((x) => x.production)!.ticked).toMatchObject([{ qty: 6 }]);
    expect((await untickNeeded(db, await owner(), g.key, soup, NOW)).ok).toBe(true);
    const back = (await groups()).find((x) => x.production)!;
    expect(back.rows).toMatchObject([{ qty: 6 }]);
    expect(back.rows[0].lineIds).toHaveLength(1);
    expect(back.ticked).toEqual([]);
  });

  it("after 05:00 the next morning the tick is just done: off the card and can't be unticked", async () => {
    await report("EAS", "DEMO-BOH", [{ name: "Lime", qty: 2 }]);
    const g = (await group("Surelygrow (demo)"))!;
    const lime = g.rows[0].product.id;
    expect((await tickNeeded(db, await owner(), g.key, [lime], NOW)).ok).toBe(true);
    const late = Date.UTC(2026, 9, 17, 3, 59), next = Date.UTC(2026, 9, 17, 4, 1);
    expect((await at(late)()).find((x) => x.key === g.key)!.ticked).toHaveLength(1);
    expect((await at(next)()).find((x) => x.key === g.key)).toBeUndefined();
    expect((await untickNeeded(db, await owner(), g.key, lime, next)).ok).toBe(false);
  });

  it("only the owner and operations managers untick on Stock needed", async () => {
    await report("EAS", "DEMO-BOH", [{ name: "Lime", qty: 2 }]);
    const g = (await group("Surelygrow (demo)"))!;
    const lime = g.rows[0].product.id;
    await tickNeeded(db, await owner(), g.key, [lime], NOW);
    expect((await untickNeeded(db, (await db.person("DEMO-MGR"))!, g.key, lime, NOW)).ok).toBe(false);
    expect((await untickNeeded(db, (await db.person("DEMO-OPS"))!, g.key, lime, NOW)).ok).toBe(true);
  });

  it("a driver unticks bought or couldn't get: it's back on their list, once, and only theirs", async () => {
    const { created } = await report("EAS", "DEMO-BOH", [{ name: "Coconut Milk", qty: 4 }, { name: "Che Lychee", qty: 2 }]);
    const g = (await group("Wing Yip (demo)"))!;
    const made = await giveToDriver(db, await owner(), g.key, "DEMO-FLT", undefined, NOW);
    const taskId = (made as { value: string }).value;
    const task = (await db.stockTask(taskId))!;
    const idOf = (name: string) => g.rows.find((r) => r.product.name === name)!.product.id;
    const lineOf = (name: string) => task.lines.find((l) => l.requestId === created.find((c) => c.productId === idOf(name))!.id)!;
    const coco = lineOf("Coconut Milk").id, lychee = lineOf("Che Lychee").id;
    await driverTick(db, { id: "DEMO-FLT" }, coco, true, NOW);
    await driverTick(db, { id: "DEMO-FLT" }, lychee, false, NOW);
    expect((await group("Wing Yip (demo)"))!.rows.map((r) => r.product.name)).toEqual(["Che Lychee"]);

    expect((await driverUntick(db, { id: "DEMO-BOH" }, coco, NOW)).ok).toBe(false); // not theirs
    expect((await driverUntick(db, { id: "DEMO-FLT" }, coco, NOW)).ok).toBe(true);
    expect((await driverUntick(db, { id: "DEMO-FLT" }, coco, NOW)).ok).toBe(false); // once
    expect((await driverUntick(db, { id: "DEMO-FLT" }, lychee, NOW)).ok).toBe(true);

    const d = (await db.stockTask(taskId))!;
    const gone = untickedLines(d);
    expect([...gone].sort()).toEqual([coco, lychee].sort());
    const open = d.lines.filter((l) => !gone.has(l.id));
    expect(open).toHaveLength(2);
    expect(open.every((l) => !canUntick(l, d.events, gone, NOW))).toBe(true); // not ticked yet
    // Both are the driver's again; Stock needed shows them with the driver, not as rows.
    const after = (await group("Wing Yip (demo)"))!;
    expect(after.rows).toHaveLength(0);
    expect(after.drivers[0]).toMatchObject({ open: 2, done: 0 });
    // The bought one is kept as bought (and arrived); what puts it back is a new request on the same list.
    expect(await state(created.find((c) => c.productId === idOf("Coconut Milk"))!.id)).toBe("received");
    // Ticking the new line works as before.
    const newCoco = open.find((l) => l.redoes === coco)!;
    expect((await driverTick(db, { id: "DEMO-FLT" }, newCoco.id, true, NOW)).ok).toBe(true);
  });

  it("a couldn't-get that the owner has given out again since stays where it is", async () => {
    await report("EAS", "DEMO-BOH", [{ name: "Che Lychee", qty: 2 }]);
    const g = (await group("Wing Yip (demo)"))!;
    const first = (await giveToDriver(db, await owner(), g.key, "DEMO-FLT", undefined, NOW)) as { value: string };
    const line = (await db.stockTask(first.value))!.lines[0].id;
    await driverTick(db, { id: "DEMO-FLT" }, line, false, NOW);
    expect((await tickNeeded(db, await owner(), g.key, [g.rows[0].product.id], NOW)).ok).toBe(true);
    expect(await driverUntick(db, { id: "DEMO-FLT" }, line, NOW)).toMatchObject({ ok: false });
  });
});

describe("Stock needed on the restaurant's tablet", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });
  const site = async () => siteNeededView(db, "EAS", NOW);
  const idOf = async (name: string) => (await db.stockCatalog()).products.find((p) => p.name === name)!.id;

  it("is for anyone who reports stock there, on the full app (not a phone)", async () => {
    const boh = (await db.person("DEMO-BOH"))!;
    const eas = (await db.sites()).find((x) => x.id === "EAS")!;
    expect(editsSiteNeeded(boh, eas, "full")).toBe(true);
    expect(editsSiteNeeded(boh, eas, "shifts")).toBe(false);
    expect(editsSiteNeeded(boh, (await db.sites()).find((x) => x.id === "WEM")!, "full")).toBe(false);
  });

  it("a new total: the newest request takes the change; one brought to nothing is removed", () => {
    const reqs = [{ id: "a", wanted: 2 }, { id: "b", wanted: 3 }];
    expect(qtyPlan(reqs, 5)).toEqual([]);
    expect(qtyPlan(reqs, 8)).toEqual([{ id: "b", qty: 6 }]);
    expect(qtyPlan(reqs, 4)).toEqual([{ id: "b", qty: 2 }]);
    expect(qtyPlan(reqs, 1)).toEqual([{ id: "b", remove: true }, { id: "a", qty: 1 }]);
    expect(qtyPlan([{ id: "a" }], 3)).toEqual([{ id: "a", qty: 3 }]); // no amount yet
  });

  it("shows only this restaurant's items; the amount changes up and down, and the owner sees who changed it", async () => {
    await report("EAS", "DEMO-BOH", [{ name: "Lime", qty: 2 }, { name: "Tofu", qty: 1 }]);
    await report("WEM", "DEMO-PRD", [{ name: "Lime", qty: 3 }]);
    const lime = await idOf("Lime");
    const sur = (await site()).groups.find((g) => g.supplier?.name === "Surelygrow (demo)")!;
    expect(sur.rows.find((r) => r.product.id === lime)).toMatchObject({ qty: 2, sites: [{ siteId: "EAS", qty: 2 }] });

    expect(await editSiteNeeded(db, { id: "DEMO-FOH" }, "EAS", lime, 5, NOW)).toEqual({ ok: true, value: { name: "Lime", from: 2, to: 5 } });
    expect((await editSiteNeeded(db, { id: "DEMO-FOH" }, "EAS", lime, 1, NOW)).ok).toBe(true);
    const owner = (await group("Surelygrow (demo)"))!.rows.find((r) => r.product.id === lime)!;
    expect(owner.qty).toBe(4); // 1 at Eastcote + 3 at Wembley
    expect(owner.changed).toMatchObject({ qty: 1, was: 5 });
    expect((await editSiteNeeded(db, { id: "DEMO-FOH" }, "EAS", lime, 0, NOW)).ok).toBe(false);
    expect((await editSiteNeeded(db, { id: "DEMO-FOH" }, "EAS", lime, 10_000, NOW)).ok).toBe(false);
  });

  it("removing takes it off (kept in the history) and the owner sees what went", async () => {
    const { created } = await report("EAS", "DEMO-BOH", [{ name: "Lime", qty: 2 }]);
    const lime = await idOf("Lime");
    expect(await editSiteNeeded(db, { id: "DEMO-FOH" }, "EAS", lime, null, NOW)).toEqual({ ok: true, value: { name: "Lime", from: 2, to: null } });
    expect((await site()).groups.flatMap((g) => g.rows)).toEqual([]);
    const g = (await groups()).find((x) => x.supplier?.name === "Surelygrow (demo)")!;
    expect(g.rows).toEqual([]);
    expect(g.removed).toMatchObject([{ product: { name: "Lime" }, qty: 2, siteId: "EAS" }]);
    expect(await state(created[0].id)).toBe("cancelled");
    expect((await editSiteNeeded(db, { id: "DEMO-FOH" }, "EAS", lime, null, NOW)).ok).toBe(false);
  });

  it("what's already being ordered, or on the kitchen's order, can't be changed there", async () => {
    await report("EAS", "DEMO-BOH", [{ name: "Coconut Milk", qty: 4 }, { name: "Soup", qty: 6 }]);
    const wy = (await group("Wing Yip (demo)"))!;
    const coco = await idOf("Coconut Milk");
    // Given to a driver: off the list, so nothing to change.
    await giveToDriver(db, await owner(), wy.key, "DEMO-FLT", undefined, NOW);
    expect((await editSiteNeeded(db, { id: "DEMO-FOH" }, "EAS", coco, 6, NOW)).ok).toBe(false);
    const soup = await idOf("Soup");
    const r = await editSiteNeeded(db, { id: "DEMO-FOH" }, "EAS", soup, 2, NOW);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/kitchen's order/) });
  });
});

describe("Report stock: submitting an item already waiting", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  it("replaces the waiting amount (the latest count wins), noted for the owner", async () => {
    const { created } = await report("EAS", "DEMO-BOH", [{ name: "Lime", qty: 3 }]);
    const again = await report("EAS", "DEMO-FOH", [{ name: "Lime", qty: 2 }]);
    expect(again.created).toEqual([]);
    expect(again.again).toBe(1);
    const row = (await group("Surelygrow (demo)"))!.rows.find((r) => r.product.name === "Lime")!;
    expect(row.qty).toBe(2);
    expect(row.changed).toMatchObject({ qty: 2, was: 3 });
    expect(row.requestIds).toEqual([created[0].id]);
    // The same amount again changes nothing.
    await report("EAS", "DEMO-FOH", [{ name: "Lime", qty: 2 }]);
    expect((await group("Surelygrow (demo)"))!.rows.find((r) => r.product.name === "Lime")!.qty).toBe(2);
  });

  it("once it's being ordered, a new report of it is a new need", async () => {
    await report("EAS", "DEMO-BOH", [{ name: "Coconut Milk", qty: 4 }]);
    const g = (await group("Wing Yip (demo)"))!;
    await giveToDriver(db, await owner(), g.key, "DEMO-FLT", undefined, NOW);
    const again = await report("EAS", "DEMO-FOH", [{ name: "Coconut Milk", qty: 2 }]);
    expect(again.created).toHaveLength(1);
    expect((await group("Wing Yip (demo)"))!.rows[0]).toMatchObject({ qty: 2 });
  });

  it("the restaurant's list says what can still be changed there", async () => {
    await report("EAS", "DEMO-BOH", [{ name: "Lime", qty: 2 }, { name: "Coconut Milk", qty: 4 }, { name: "Soup", qty: 6 }]);
    const wy = (await group("Wing Yip (demo)"))!;
    await giveToDriver(db, await owner(), wy.key, "DEMO-FLT", undefined, NOW);
    await report("EAS", "DEMO-BOH", [{ name: "Che Lychee", qty: 1 }]);
    const v = await siteNeededView(db, "EAS", NOW);
    const rows = siteWaitingRows(v.groups, v.items).map((w) => [w.row.product.name, w.editable, w.status ?? ""]).sort();
    expect(rows).toEqual([["Che Lychee", true, ""], ["Lime", true, ""], ["Soup", false, "kitchen"]]);
  });
});
