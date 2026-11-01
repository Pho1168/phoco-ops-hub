"use client";

import { Icon } from "@/components/Icon";

/**
 * The Stock needed print buttons, at the top of a page: the 80 mm receipt (the Epson on the tablet) and the A4 tick-off
 * sheet. Each press asks for a new sheet (`t`, the time it was pressed), so a tablet never shows or prints a stored copy:
 * what prints is Stock needed as it is at that moment.
 */
export function PrintStock({ label = "Print Stock needed, with boxes to tick." }: { label?: string }) {
  const fresh = (base: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.currentTarget.href = `${base}${base.includes("?") ? "&" : "?"}t=${Date.now()}`;
  };
  return (
    <div className="row wrap no-print" style={{ gap: 8, alignItems: "center" }}>
      <span className="muted lead grow" style={{ fontSize: 14 }}>{label}</span>
      <a className="btn small" href="/stock/needed/sheet?format=receipt" onClick={fresh("/stock/needed/sheet?format=receipt")} target="_blank" rel="noreferrer"><Icon name="print" /> Print (80 mm receipt)</a>
      <a className="btn small ghost" href="/stock/needed/sheet" onClick={fresh("/stock/needed/sheet")} target="_blank" rel="noreferrer"><Icon name="print" /> Tick-off sheet (A4 PDF)</a>
    </div>
  );
}
