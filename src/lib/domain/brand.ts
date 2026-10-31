import type { Site } from "./types";

/**
 * The businesses the sites trade under. Each site belongs to one (`sites.brand`); whoever works there sees that
 * business's name, logo and colours. What sits behind it (handover list, library, training, stock) is shared.
 */
export type BrandId = "phoco" | "clv";
export const BRAND_IDS: BrandId[] = ["phoco", "clv"];

export interface BrandLogo { symbol: string; stacked: string; wide: string }
/** Colour tokens that replace the PHO & CO ones in globals.css (only those given). */
export interface BrandColours { brand?: string; teal?: string; tealTint?: string; tealInk?: string }
export interface Brand { id: BrandId; name: string; logo?: BrandLogo; colours?: BrandColours }

export const BRANDS: Record<BrandId, Brand> = {
  phoco: { id: "phoco", name: "PHO & CO", logo: { symbol: "/brand/logo-symbol.png", stacked: "/brand/logo-stacked.png", wide: "/brand/logo-wide.png" } },
  // From the Cafe La Viet brand guideline: the logo in white for the coloured bar; Cherry Red (#9D2235) for the bar,
  // headings and main buttons (white text reads well on it), Desire Red (#F4364C) as the accent with a 10% tint.
  clv: { id: "clv", name: "Cafe La Viet", logo: { symbol: "/brand/clv-symbol.png", stacked: "/brand/clv-stacked.png", wide: "/brand/clv-wide.png" },
    colours: { brand: "#9D2235", teal: "#F4364C", tealTint: "#FDE7EA", tealInk: "#7A1A29" } },
};

/**
 * The owner's own screens (overview, accounts, ordering, catalogue) belong to neither business: "Ops Hub" as a
 * wordmark, no logo, the app's default (teal) colours.
 */
export const NEUTRAL: Brand = { id: "phoco", name: "Ops Hub" };

export const isBrandId = (x: unknown): x is BrandId => typeof x === "string" && (BRAND_IDS as string[]).includes(x);
export const brandOf = (site?: Pick<Site, "brand"> | null): Brand => BRANDS[site?.brand && isBrandId(site.brand) ? site.brand : "phoco"];

/** The businesses a set of sites trade under, in order, each once. */
export function brandsOf(sites: Pick<Site, "brand">[]): Brand[] {
  const ids = new Set(sites.map((s) => brandOf(s).id));
  return BRAND_IDS.filter((id) => ids.has(id)).map((id) => BRANDS[id]);
}
/** "PHO & CO", "Cafe La Viet", or both for a list covering both. */
export const brandLabel = (sites: Pick<Site, "brand">[]) => (brandsOf(sites).map((b) => b.name).join(" · ") || BRANDS.phoco.name);
/** A heading's business prefix: "PHO & CO " or "Cafe La Viet " for one business, nothing for a list covering both. */
export const brandPrefix = (sites: Pick<Site, "brand">[]) => { const b = brandsOf(sites); return b.length === 1 ? `${b[0].name} ` : ""; };
/** For file names: "PHO-CO", "Cafe-La-Viet". */
export const brandSlug = (sites: Pick<Site, "brand">[]) => brandLabel(sites).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** A CSS block replacing the colour tokens for a brand with its own colours (empty for PHO & CO). */
export function brandCss(b: Brand): string {
  const c = b.colours;
  if (!c) return "";
  const hex = (v?: string) => (v && /^#[0-9a-fA-F]{6}$/.test(v) ? v : undefined);
  const pairs: [string, string | undefined][] = [["--brand", hex(c.brand)], ["--teal", hex(c.teal)], ["--teal-tint", hex(c.tealTint)], ["--teal-ink", hex(c.tealInk)]];
  const body = pairs.filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(";");
  return body ? `:root{${body}}` : "";
}

/** Who belongs to a business's staff list: anyone with access at one of its sites (someone at both is on both). */
export function inBrand(p: { access: { siteId: string }[] }, brand: BrandId, sites: Pick<Site, "id" | "brand">[]): boolean {
  const ids = new Set(sites.filter((s) => brandOf(s).id === brand).map((s) => s.id));
  return p.access.some((a) => ids.has(a.siteId));
}
