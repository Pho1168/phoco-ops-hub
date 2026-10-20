import { describe, expect, it } from "vitest";
import { receiptSheet, type PrepItem } from "@/lib/domain/prep";
import { RECEIPT_W, receiptPdf } from "@/lib/pdf";

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
  it("is one page, 80 mm wide, as tall as the list", () => {
    const sheet = (n: number) => receiptSheet(Array.from({ length: n }, (_, i) => item(`i${i}`, `Item number ${i}`, "todo", "Kitchen", i)));
    const make = (n: number) => Buffer.from(receiptPdf({ title: "Handover list", lines: ["Eastcote"], groups: sheet(n), foot: "PHO & CO" })).toString("latin1");
    const box = (pdf: string) => pdf.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/)!.slice(1).map(Number);
    const short = make(5), long = make(60);
    expect(short.match(/\/Type \/Page /g)).toHaveLength(1);
    expect(box(short)[0]).toBeCloseTo(RECEIPT_W, 1);
    expect(box(long)[0]).toBeCloseTo(RECEIPT_W, 1);
    expect(box(long)[1]).toBeGreaterThan(box(short)[1] + 500);
  });
  it("wraps a long name onto a second line instead of cutting it", () => {
    const name = "Pick the coriander leaves and wash, spin dry and store in the tall tub";
    const pdf = Buffer.from(receiptPdf({ title: "Handover list", lines: [], groups: [{ heading: "To prep · Veg", rows: [name] }], foot: "x" })).toString("latin1");
    expect(pdf).not.toContain("...");
    expect(pdf).toContain("coriander");
    expect(pdf).toContain("tub");
  });
});
