import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { demoStore as db, resetDemo } from "@/lib/data/demo-store";
import { cleanNewItems, lookAlikes, neededCount, orderSheetLines, orderingSites, runsOrdering } from "@/lib/domain/stock";
import { buildPdf, fitText, orderSheetPdf, pdfString } from "@/lib/pdf";
import { addNewItem, clearNeeded, deliversTo, driverTick, giveToDriver, neededView, sendStockReport, stockView, tickNeeded } from "@/lib/stock-service";

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
    expect((await groups()).find((x) => x.production)).toBeUndefined();
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
