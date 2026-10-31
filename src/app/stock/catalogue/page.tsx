import { store } from "@/lib/data";
import { isOwner } from "@/lib/domain/access";
import { catalogFor, latestPrice, pounds, priceAge } from "@/lib/domain/stock";
import { BRANDS, brandOf, brandsOf } from "@/lib/domain/brand";
import { pickBrand } from "@/lib/stock-service";
import { BusinessTabs } from "../BusinessTabs";
import { londonDate } from "@/lib/domain/time";
import { StockBar, StockNav } from "../Bar";
import { ownerStockCtx } from "../load";
import { CatalogueEditor } from "./CatalogueEditor";

export const dynamic = "force-dynamic";

/** The owner's catalogue: suppliers, products (each with its preferred supplier), reference prices, purchasers. */
export default async function Catalogue(props: { searchParams: Promise<{ b?: string }> }) {
  const { b } = await props.searchParams;
  const { ctx, onPhone } = await ownerStockCtx();
  const db = store();
  const today = londonDate(Date.now());
  const [cat, allSites, people, purchasers] = await Promise.all([db.stockCatalog(), db.sites(), db.people(), db.purchaserIds()]);
  // PHO & CO and Cafe La Viet each keep their own catalogue: one at a time.
  const brands = brandsOf(allSites).map((x) => x.id);
  const brand = pickBrand(brands, b, ctx.site);
  const { suppliers, products, prices } = catalogFor(cat, brand);
  const sites = allSites.filter((s) => brandOf(s).id === brand);
  return (
    <>
      <StockBar ctx={ctx} onPhone={onPhone} title="Catalogue" back="/stock" eyebrow={`Stock & Purchasing · ${BRANDS[brand].name}`} />
      <CatalogueEditor brand={brand} tabs={<BusinessTabs brands={brands} current={brand} path="/stock/catalogue" />}
        suppliers={suppliers}
        products={products.map((p) => { const pr = latestPrice(prices, p.id); return { ...p, price: pr ? `${pounds(pr.pence)} · ${priceAge(pr.on, today)}${pr.note ? ` · ${pr.note}` : ""}` : undefined }; })}
        productionSites={sites.filter((s) => s.kind === "production").map((s) => ({ id: s.id, name: s.name }))}
        sites={sites.filter((s) => s.status === "open").map((s) => ({ id: s.id, name: s.name, reminder: s.stockReminder !== false }))}
        people={people.filter((p) => p.status === "active").map((p) => ({ id: p.id, name: p.name, owner: isOwner(p), on: purchasers.includes(p.id) }))}
        today={today} />
      <StockNav ctx={ctx} onPhone={onPhone} />
    </>
  );
}
