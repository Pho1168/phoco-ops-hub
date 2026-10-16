/**
 * A small PDF writer for plain printed sheets (an order to a supplier): A4 pages of text and rules in the two standard
 * fonts every PDF reader has (Helvetica and Helvetica-Bold), so no font files are needed. Text is Windows-1252 (WinAnsi),
 * which covers English and £; anything else is replaced with "?". No dependencies, so it runs anywhere the server does.
 */

export const A4 = { w: 595.28, h: 841.89 };

export type PdfOp =
  | { t: "text"; x: number; y: number; size: number; bold?: boolean; text: string }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; width?: number; grey?: number };

/** Characters WinAnsi has outside Latin-1 (the rest of 0x20–0xFF map to themselves). */
const CP1252: Record<string, number> = { "€": 0x80, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "…": 0x85 };

/** A PDF string literal for the text, in WinAnsi, with (, ) and \ escaped. */
export function pdfString(text: string): string {
  let out = "(";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const code = CP1252[ch] ?? (cp >= 0x20 && cp <= 0x7e ? cp : cp >= 0xa0 && cp <= 0xff ? cp : 0x3f);
    if (code === 0x28 || code === 0x29 || code === 0x5c) out += "\\" + String.fromCharCode(code);
    else if (code < 0x20 || code > 0x7e) out += "\\" + code.toString(8).padStart(3, "0");
    else out += String.fromCharCode(code);
  }
  return out + ")";
}

/** Helvetica widths (per 1000 em) for printable ASCII, to measure and fit text; others count as 556. */
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
/** The width of the text in points at this size (bold is about 6% wider). */
export function textWidth(text: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of text) { const c = ch.charCodeAt(0); w += c >= 32 && c <= 126 ? HELV[c - 32] : 556; }
  return (w * size / 1000) * (bold ? 1.06 : 1);
}
/** The text cut to fit a width, with "..." when it had to be. */
export function fitText(text: string, size: number, maxW: number, bold = false): string {
  if (textWidth(text, size, bold) <= maxW) return text;
  let t = text;
  while (t.length > 1 && textWidth(t + "...", size, bold) > maxW) t = t.slice(0, -1);
  return t.trimEnd() + "...";
}

const n = (v: number) => (Math.round(v * 100) / 100).toString();

/** The PDF file for these pages (each a list of drawing operations, in points from the bottom-left). */
export function buildPdf(pages: PdfOp[][], title: string): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  // 1 catalog, 2 pages, 3 regular font, 4 bold font, 5 info; then a content stream and a page for each page.
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("PAGES");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  add(`<< /Title ${pdfString(title)} /Producer (PHO & CO Ops Hub) >>`);
  const kids: number[] = [];
  for (const ops of pages.length ? pages : [[]]) {
    const parts: string[] = [];
    for (const op of ops) {
      if (op.t === "text") parts.push(`BT /${op.bold ? "F2" : "F1"} ${n(op.size)} Tf ${n(op.x)} ${n(op.y)} Td ${pdfString(op.text)} Tj ET`);
      else parts.push(`${n(op.grey ?? 0)} G ${n(op.width ?? 0.5)} w ${n(op.x1)} ${n(op.y1)} m ${n(op.x2)} ${n(op.y2)} l S`);
    }
    const stream = parts.join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(A4.w)} ${n(A4.h)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

/**
 * An order sheet: a heading block, then a table of quantity, item and pack, over as many A4 pages as it takes, each
 * page numbered, with a short line at the foot of the last page.
 */
export function orderSheetPdf(o: { title: string; lines: string[]; rows: { qty: string; item: string; pack?: string }[]; foot: string }): Uint8Array {
  const M = 48, top = A4.h - 56, rowH = 20;
  const colQty = M, colItem = M + 70, colPack = A4.w - M - 150, right = A4.w - M;
  const pages: PdfOp[][] = [];
  let ops: PdfOp[] = [];
  let y = top;
  const header = (first: boolean) => {
    if (first) {
      ops.push({ t: "text", x: M, y, size: 20, bold: true, text: o.title });
      y -= 26;
      for (const l of o.lines) { ops.push({ t: "text", x: M, y, size: 11, text: l }); y -= 16; }
      y -= 10;
    } else {
      ops.push({ t: "text", x: M, y, size: 11, bold: true, text: `${o.title} (continued)` });
      y -= 24;
    }
    ops.push({ t: "text", x: colQty, y, size: 10, bold: true, text: "Qty" });
    ops.push({ t: "text", x: colItem, y, size: 10, bold: true, text: "Item" });
    ops.push({ t: "text", x: colPack, y, size: 10, bold: true, text: "Pack" });
    y -= 8;
    ops.push({ t: "line", x1: M, y1: y, x2: right, y2: y, width: 1 });
    y -= rowH - 4;
  };
  header(true);
  for (const r of o.rows) {
    if (y < 72) { pages.push(ops); ops = []; y = top; header(false); }
    ops.push({ t: "text", x: colQty, y, size: 12, bold: true, text: r.qty });
    ops.push({ t: "text", x: colItem, y, size: 12, text: fitText(r.item, 12, colPack - colItem - 10) });
    if (r.pack) ops.push({ t: "text", x: colPack, y, size: 11, text: fitText(r.pack, 11, right - colPack) });
    ops.push({ t: "line", x1: M, y1: y - 7, x2: right, y2: y - 7, width: 0.4, grey: 0.75 });
    y -= rowH;
  }
  if (y < 80) { pages.push(ops); ops = []; y = top; }
  ops.push({ t: "text", x: M, y: y - 10, size: 10, text: o.foot });
  pages.push(ops);
  pages.forEach((p, i) => p.push({ t: "text", x: right - 60, y: 30, size: 9, text: `Page ${i + 1} of ${pages.length}` }));
  return buildPdf(pages, o.title);
}
