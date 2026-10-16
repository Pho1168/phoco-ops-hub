import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { demoStore as db, resetDemo } from "@/lib/data/demo-store";
import { neededCount, orderSheetLines, orderingSites, runsOrdering } from "@/lib/domain/stock";
import { buildPdf, fitText, orderSheetPdf, pdfString } from "@/lib/pdf";
import { deliversTo, driverTick, giveToDriver, neededView, sendStockReport, stockView, tickNeeded } from "@/lib/stock-service";

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
