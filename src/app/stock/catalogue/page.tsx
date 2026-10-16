import { store } from "@/lib/data";
import { isOwner } from "@/lib/domain/access";
import { latestPrice, pounds, priceAge } from "@/lib/domain/stock";
import { londonDate } from "@/lib/domain/time";
import { StockBar, StockNav } from "../Bar";
import { ownerStockCtx } from "../load";
import { CatalogueEditor } from "./CatalogueEditor";

export const dynamic = "force-dynamic";

/** The owner's catalogue: suppliers, products (each with its preferred supplier), reference prices, purchasers. */
export default async function Catalogue() {
  const { ctx, onPhone } = await ownerStockCtx();
  const db = store();
  const today = londonDate(Date.now());
  const [{ suppliers, products, prices }, sites, people, purchasers] = await Promise.all([db.stockCatalog(), db.sites(), db.people(), db.purchaserIds()]);
  return (
    <>
      <StockBar ctx={ctx} onPhone={onPhone} title="Catalogue" back="/stock" eyebrow="Stock & Purchasing · every site" />
      <CatalogueEditor
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
