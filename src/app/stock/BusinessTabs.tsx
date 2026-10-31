import Link from "next/link";
import { BRANDS, type BrandId } from "@/lib/domain/brand";

/**
 * PHO & CO / Cafe La Viet: which business's stock this page shows. Each keeps its own catalogue and orders, so the
 * owner switches between them; shown only to someone who orders for both.
 */
export function BusinessTabs({ brands, current, path }: { brands: BrandId[]; current: BrandId; path: string }) {
  if (brands.length < 2) return null;
  return (
    <nav className="seg no-print" aria-label="Business">
      {brands.map((b) => (
        <Link key={b} href={`${path}${path.includes("?") ? "&" : "?"}b=${b}`} aria-current={b === current ? "page" : undefined}
          style={{ textAlign: "center", textDecoration: "none" }}>{BRANDS[b].name}</Link>
      ))}
    </nav>
  );
}
