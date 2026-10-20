/**
 * A small PDF writer for plain printed sheets (an order to a supplier): A4 pages of text and rules in the two standard
 * fonts every PDF reader has (Helvetica and Helvetica-Bold), so no font files are needed. Text is Windows-1252 (WinAnsi),
 * which covers English and £; anything else is replaced with "?". No dependencies, so it runs anywhere the server does.
 */

export const A4 = { w: 595.28, h: 841.89 };

export type PdfOp =
  | { t: "text"; x: number; y: number; size: number; bold?: boolean; text: string; grey?: number }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; width?: number; grey?: number }
  | { t: "rect"; x: number; y: number; w: number; h: number; width?: number; grey?: number; fill?: number | [number, number, number] };

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
export function buildPdf(pages: PdfOp[][], title: string, size: { w: number; h: number }[] = []): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  // 1 catalog, 2 pages, 3 regular font, 4 bold font, 5 info; then a content stream and a page for each page.
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("PAGES");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  add(`<< /Title ${pdfString(title)} /Producer (PHO & CO Ops Hub) >>`);
  const kids: number[] = [];
  for (const [at, ops] of (pages.length ? pages : [[]]).entries()) {
    const box = size[at] ?? A4;
    const parts: string[] = [];
    for (const op of ops) {
      if (op.t === "text") parts.push(`${n(op.grey ?? 0)} g BT /${op.bold ? "F2" : "F1"} ${n(op.size)} Tf ${n(op.x)} ${n(op.y)} Td ${pdfString(op.text)} Tj ET 0 g`);
      else if (op.t === "rect") parts.push(op.fill !== undefined
        ? `${Array.isArray(op.fill) ? `${op.fill.map(n).join(" ")} rg` : `${n(op.fill)} g`} ${n(op.x)} ${n(op.y)} ${n(op.w)} ${n(op.h)} re f 0 g`
        : `${n(op.grey ?? 0)} G ${n(op.width ?? 0.8)} w ${n(op.x)} ${n(op.y)} ${n(op.w)} ${n(op.h)} re S`);
      else parts.push(`${n(op.grey ?? 0)} G ${n(op.width ?? 0.5)} w ${n(op.x1)} ${n(op.y1)} m ${n(op.x2)} ${n(op.y2)} l S`);
    }
    const stream = parts.join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(box.w)} ${n(box.h)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${content} 0 R >>`));
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

/** `shops`: every shop that sells it ("Loon Fung/Lidl/Aldi/Asda"), on a line of its own in dark text; then `info` (or `detail`) small and grey. */
export interface SheetRow { qty: string; item: string; detail?: string; flag?: string; shops?: string; info?: string }
export interface SheetGroup { heading: string; sub?: string; rows: SheetRow[]; notes?: string[] }

/**
 * A tick-off sheet: a heading, then groups (a supplier each) of rows with a box to tick, the quantity and the item, a
 * small grey line under it when there is one, in two columns so a normal day fits on one A4 page; it runs on to more
 * pages when it has to. Page numbers at the foot.
 */
export function checklistPdf(o: { title: string; lines: string[]; groups: SheetGroup[]; foot: string }): Uint8Array {
  const M = 32, gap = 18, colW = (A4.w - 2 * M - gap) / 2, bottom = 44, top = A4.h - 40;
  const pages: PdfOp[][] = [];
  let ops: PdfOp[] = [];
  let col = 0, y = 0, colTop = 0;
  const x0 = () => M + col * (colW + gap);
  const newPage = (first: boolean) => {
    if (!first) pages.push(ops);
    ops = []; col = 0;
    y = top;
    if (first) {
      // The brand's deep teal (#2C6E63) behind the title.
      ops.push({ t: "rect", x: M, y: y - 34, w: A4.w - 2 * M, h: 42, fill: [0.173, 0.431, 0.388] });
      ops.push({ t: "text", x: M + 12, y: y - 13, size: 16, bold: true, text: o.title, grey: 1 });
      ops.push({ t: "text", x: M + 12, y: y - 27, size: 9, text: o.lines.join("   \u00b7   "), grey: 1 });
      y -= 52;
    } else {
      ops.push({ t: "text", x: M, y, size: 10, bold: true, text: `${o.title} (continued)` });
      y -= 18;
    }
    colTop = y;
  };
  const room = (h: number) => {
    if (y - h >= bottom) return;
    if (col === 0) { col = 1; y = colTop; return; }
    newPage(false);
  };
  newPage(true);
  for (const g of o.groups) {
    room(22 + 16);
    const x = x0();
    ops.push({ t: "text", x, y: y - 11, size: 11, bold: true, text: fitText(g.heading.toUpperCase(), 11, colW - 70, true) });
    if (g.sub) ops.push({ t: "text", x: x + colW - textWidth(g.sub, 8), y: y - 11, size: 8, text: g.sub, grey: 0.35 });
    ops.push({ t: "line", x1: x, y1: y - 15, x2: x + colW, y2: y - 15, width: 1 });
    y -= 22;
    for (const r of g.rows) {
      const small = r.shops ? r.info : r.detail;
      const h = 14 + (r.shops ? 11 : 0) + (small ? 8.5 : 0);
      room(h);
      const cx = x0();
      ops.push({ t: "rect", x: cx, y: y - 9, w: 8.5, h: 8.5, width: 0.8 });
      ops.push({ t: "text", x: cx + 14, y: y - 8, size: 9.5, bold: true, text: r.qty });
      const flagW = r.flag ? textWidth(r.flag, 7.5, true) + 4 : 0;
      ops.push({ t: "text", x: cx + 40, y: y - 8, size: 9.5, text: fitText(r.item, 9.5, colW - 42 - flagW) });
      if (r.flag) ops.push({ t: "text", x: cx + colW - flagW + 4, y: y - 8, size: 7.5, bold: true, text: r.flag });
      let ly = y - 8;
      if (r.shops) { ly -= 11; ops.push({ t: "text", x: cx + 40, y: ly, size: 9, bold: true, text: fitText(r.shops, 9, colW - 42, true) }); }
      if (small) { ly -= r.shops ? 9 : 9.5; ops.push({ t: "text", x: cx + 40, y: ly, size: 7.5, text: fitText(small, 7.5, colW - 42), grey: 0.4 }); }
      y -= h;
    }
    for (const nt of g.notes ?? []) {
      room(11);
      ops.push({ t: "text", x: x0(), y: y - 7, size: 7.5, text: fitText(nt, 7.5, colW), grey: 0.4 });
      y -= 11;
    }
    y -= 8;
  }
  if (!o.groups.length) ops.push({ t: "text", x: M, y: y - 12, size: 11, text: "Nothing needed right now." });
  pages.push(ops);
  pages.forEach((p, i) => {
    p.push({ t: "text", x: M, y: 24, size: 7.5, text: o.foot, grey: 0.45 });
    p.push({ t: "text", x: A4.w - M - 52, y: 24, size: 7.5, text: `Page ${i + 1} of ${pages.length}`, grey: 0.45 });
  });
  return buildPdf(pages, o.title);
}

/** An 80 mm receipt roll: 226.77 pt wide (72 mm printable). */
export const RECEIPT_W = 226.77;
/**
 * Each page is as long as an A4 sheet (297 mm). Receipt printer drivers on Windows usually offer "80 x 297 mm" as their
 * roll paper size and cut a longer page off there, so a long list runs on to more pages of that length instead.
 */
export const RECEIPT_H = 841.89;

/** A line to tick: the text (big), and a small grey line under it when there is one. */
export type ReceiptRow = string | { text: string; detail?: string | string[]; plain?: boolean };
export interface ReceiptGroup { heading: string; sub?: string; rows: ReceiptRow[] }

/**
 * A handover list for a receipt printer: 80 mm pages, each as long as A4 at most (the last one only as long as it needs).
 * A heading, then each group (a station) with a box to tick beside every item, in big plain text; long names and long
 * group headings wrap onto more lines. A group that runs on to the next page has its heading again ("continued").
 */
export function receiptPdf(o: { title: string; lines: string[]; groups: ReceiptGroup[]; foot: string }): Uint8Array {
  const M = 10, W = RECEIPT_W - 2 * M, size = 11, lead = 14.5, box = 9, top = 12, bottom = 24, headSize = 11, headLead = 13.5;
  const wrap = (text: string, max: number, sz: number, bold = false): string[] => {
    const out: string[] = [];
    let line = "";
    for (const w of text.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${w}` : w;
      if (textWidth(next, sz, bold) <= max || !line) line = next; else { out.push(line); line = w; }
    }
    if (line) out.push(line);
    return out.map((l) => fitText(l, sz, max, bold));
  };
  type Block = { h: number; draw: (y: number, ops: PdfOp[]) => void };
  const headBlock = (text: string, sub?: string): Block => {
    const lines = wrap(text.toUpperCase(), W, headSize, true);
    const h = 6 + lines.length * headLead + (sub ? 10 : 0) + 5;
    return { h, draw: (y, ops) => {
      lines.forEach((l, i) => ops.push({ t: "text", x: M, y: y - 6 - headSize + 1 - i * headLead, size: headSize, bold: true, text: l }));
      if (sub) ops.push({ t: "text", x: M, y: y - 6 - lines.length * headLead - 6, size: 8, text: fitText(sub, 8, W), grey: 0.3 });
      ops.push({ t: "line", x1: M, y1: y - h + 2, x2: M + W, y2: y - h + 2, width: 1 });
    } };
  };
  const small = 8.5, smallLead = 10.5;
  const rowBlock = (row: ReceiptRow): Block => {
    const { text, detail, plain } = typeof row === "string" ? { text: row, detail: undefined, plain: false } : row;
    const lines = wrap(text, W - 18, size);
    const more = (Array.isArray(detail) ? detail : detail ? [detail] : []).flatMap((d) => wrap(d, W - 18, small));
    return { h: lines.length * lead + more.length * smallLead + 4, draw: (y, ops) => {
      if (!plain) ops.push({ t: "rect", x: M, y: y - lead + 3, w: box, h: box, width: 1 });
      lines.forEach((l, i) => ops.push({ t: "text", x: M + 18, y: y - lead + 4.5 - i * lead, size, text: l, grey: plain ? 0.3 : 0 }));
      const y2 = y - lines.length * lead;
      more.forEach((l, i) => ops.push({ t: "text", x: M + 18, y: y2 - 6 - i * smallLead, size: small, text: l, grey: 0.3 }));
    } };
  };
  const pages: { ops: PdfOp[]; used: number }[] = [];
  let ops: PdfOp[] = [], y = 0;
  const open = () => { ops = []; y = RECEIPT_H - top; pages.push({ ops, used: 0 }); };
  const fits = (h: number) => y - h >= bottom;
  const put = (b: Block) => { b.draw(y, ops); y -= b.h; pages[pages.length - 1].used = RECEIPT_H - y; };
  open();
  // The heading block: title, small lines, a rule.
  put({ h: 22, draw: (yy, p) => p.push({ t: "text", x: M, y: yy - 15, size: 15, bold: true, text: fitText(o.title, 15, W, true) }) });
  for (const l of o.lines) put({ h: 12, draw: (yy, p) => p.push({ t: "text", x: M, y: yy - 9, size: 8.5, text: fitText(l, 8.5, W), grey: 0.25 }) });
  put({ h: 8, draw: (yy, p) => p.push({ t: "line", x1: M, y1: yy - 4, x2: M + W, y2: yy - 4, width: 0.8 }) });
  for (const g of o.groups) {
    const head = headBlock(g.heading, g.sub);
    const rows = g.rows.map(rowBlock);
    // A heading never sits alone at the foot of a page: it moves over with its first item.
    if (!fits(head.h + (rows[0]?.h ?? 0))) open();
    put(head);
    for (const r of rows) {
      if (!fits(r.h)) { open(); put(headBlock(`${g.heading} (continued)`, g.sub)); }
      put(r);
    }
  }
  if (!o.groups.length) put({ h: 14, draw: (yy, p) => p.push({ t: "text", x: M, y: yy - 11, size, text: "Nothing on the list." }) });
  const footLines = wrap(o.foot, W, 8.5);
  const footH = 12 + footLines.length * 10.5;
  if (!fits(footH)) open();
  put({ h: footH, draw: (yy, p) => {
    p.push({ t: "line", x1: M, y1: yy - 6, x2: M + W, y2: yy - 6, width: 0.8 });
    footLines.forEach((l, i) => p.push({ t: "text", x: M, y: yy - 17 - i * 10.5, size: 8.5, text: l, grey: 0.25 }));
  } });
  // Page numbers; the last page is only as long as it needs to be (shifted down so nothing moves off it).
  const sizes = pages.map((pg, i) => {
    const last = i === pages.length - 1;
    const h = last ? Math.min(RECEIPT_H, Math.ceil(pg.used + bottom)) : RECEIPT_H;
    const shift = RECEIPT_H - h;
    if (shift) for (const op of pg.ops) { if (op.t === "line") { op.y1 -= shift; op.y2 -= shift; } else op.y -= shift; }
    if (pages.length > 1) pg.ops.push({ t: "text", x: M + W - 46, y: 8, size: 8, text: `Part ${i + 1} of ${pages.length}`, grey: 0.35 });
    return { w: RECEIPT_W, h };
  });
  return buildPdf(pages.map((pg) => pg.ops), o.title, sizes);
}
