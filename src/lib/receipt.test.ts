import { describe, expect, it } from "vitest";
import { receiptSheet, type PrepItem } from "@/lib/domain/prep";
import { RECEIPT_H, RECEIPT_W, receiptPdf } from "@/lib/pdf";

const item = (id: string, name: string, kind: "todo" | "prep", group: string, position: number, active = true): PrepItem => ({ id, name, kind, group, position, active });

describe("the handover list as a receipt", () => {
  const items = [
    item("a", "Cut lemons", "prep", "Bar", 5), item("b", "Wipe down fridge", "todo", "Kitchen", 1), item("c", "Count the till", "todo", "Front", 0),
    item("d", "Slice limes", "prep", "Bar", 6), item("e", "Old thing", "todo", "Kitchen", 2, false), item("f", "Restock cups", "todo", "Kitchen", 3),
  ];
  it("lists what's in use, to do first, a group at a time, in position order", () => {
    expect(receiptSheet(items)).toEqual([
      { heading: "To do · Front", rows: ["Count the till"] },
      { heading: "To do · Kitchen", rows: ["Wipe down fridge", "Restock cups"] },
      { heading: "To prep · Bar", rows: ["Cut lemons", "Slice limes"] },
    ]);
  });
  it("drops a group once all of its items are taken off", () => {
    expect(receiptSheet(items.map((i) => (i.group === "Front" ? { ...i, active: false } : i))).map((g) => g.heading)).not.toContain("To do · Front");
    expect(receiptSheet([])).toEqual([]);
  });
  it("is 80 mm wide, in pages no longer than A4, as many as the list needs", () => {
    const sheet = (n: number) => receiptSheet(Array.from({ length: n }, (_, i) => item(`i${i}`, `Item number ${i}`, "todo", "Kitchen", i)));
    const make = (n: number) => Buffer.from(receiptPdf({ title: "Handover list", lines: ["Eastcote"], groups: sheet(n), foot: "PHO & CO" })).toString("latin1");
    const boxes = (pdf: string) => [...pdf.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const short = boxes(make(5)), long = boxes(make(80));
    expect(short).toHaveLength(1);
    expect(short[0][0]).toBeCloseTo(RECEIPT_W, 1);
    expect(short[0][1]).toBeLessThan(RECEIPT_H);
    expect(long.length).toBeGreaterThan(1);
    for (const [w, h] of long) { expect(w).toBeCloseTo(RECEIPT_W, 1); expect(h).toBeLessThanOrEqual(RECEIPT_H + 0.01); }
    const text = make(80);
    for (const i of [0, 40, 79]) expect(text).toContain(`(Item number ${i})`);
    expect(text).toContain("KITCHEN \\(CONTINUED\\))");
    expect(text).toContain(`(Part ${long.length} of ${long.length})`);
  });
  it("wraps a long group heading instead of cutting it", () => {
    const pdf = Buffer.from(receiptPdf({ title: "Handover list", lines: [], groups: [{ heading: "To prep \u00b7 Fried & marinated chicken", rows: ["Fry wings"] }], foot: "x" })).toString("latin1");
    expect(pdf).not.toContain("...");
    expect(pdf).toContain("CHICKEN");
  });
  it("wraps a long name onto a second line instead of cutting it", () => {
    const name = "Pick the coriander leaves and wash, spin dry and store in the tall tub";
    const pdf = Buffer.from(receiptPdf({ title: "Handover list", lines: [], groups: [{ heading: "To prep · Veg", rows: [name] }], foot: "x" })).toString("latin1");
    expect(pdf).not.toContain("...");
    expect(pdf).toContain("coriander");
    expect(pdf).toContain("tub");
  });
});

describe("Stock needed on the receipt printer", () => {
  it("puts the amount before the item and who it's for underneath, URGENT or NEW first", async () => {
    const { neededReceipt } = await import("@/lib/domain/stock");
    const out = neededReceipt([
      { heading: "New items", sub: "Not in the catalogue yet", rows: [{ qty: "2", item: "Gloves · Box of 100", detail: "For Eastcote", flag: "NEW" }] },
      { heading: "Lidl/Aldi", sub: "Shop trip", rows: [{ qty: "3", item: "Beansprout", detail: "For Eastcote", flag: "URGENT" }, { qty: "?", item: "Mint" }], notes: ["With Sam: 2 Eggs"] },
    ]);
    expect(out[0]).toEqual({ heading: "New items", sub: "Not in the catalogue yet", rows: [{ text: "2 × Gloves · Box of 100", detail: "NEW · For Eastcote" }] });
    expect(out[1].rows).toEqual([{ text: "3 × Beansprout", detail: "URGENT · For Eastcote" }, { text: "? × Mint", detail: undefined }, { text: "With Sam: 2 Eggs", plain: true }]);
    const pdf = Buffer.from(receiptPdf({ title: "PHO & CO stock needed", lines: [], groups: out, foot: "x" })).toString("latin1");
    expect(pdf).toContain("Beansprout");
    expect(pdf).toContain("URGENT");
    expect(pdf).toContain("Shop trip");
  });
});
