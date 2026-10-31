import { BRANDS, brandCss as brandCssOf, type Brand } from "@/lib/domain/brand";

/**
 * The business's logo: the symbol, the stacked lock-up or the wide one (PNGs under public/brand). A business with no
 * logo yet shows its name as a wordmark in the heading font.
 */
export function Logo({ kind = "symbol", className = "", brand = BRANDS.phoco }: { kind?: "symbol" | "stacked" | "wide"; className?: string; brand?: Brand }) {
  if (!brand.logo) return <span className={`${className} wordmark ${kind}`} role="img" aria-label={brand.name}>{brand.name}</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={`${className} logo-${brand.id}`} src={brand.logo[kind]} alt={brand.name} />;
}

/** A brand's own colours, replacing the PHO & CO tokens (nothing for PHO & CO or a brand with none set yet). */
export function BrandStyle({ brand }: { brand: Brand }) {
  const css = brandCssOf(brand);
  return css ? <style>{css}</style> : null;
}
