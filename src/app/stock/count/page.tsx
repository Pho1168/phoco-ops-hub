import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { countAge } from "@/lib/domain/stock-count";
import { londonDate, londonHM, shortDay } from "@/lib/domain/time";
import { kitchenPlan } from "@/lib/stock-service";
import { canOrder } from "@/lib/domain/supplier-orders";
import { StockBar } from "../Bar";
import { stockCtx } from "../load";
import { CountForm } from "./CountForm";

export const dynamic = "force-dynamic";

/** Count production stock: the production team counts what's on the shelf at the kitchen, at close. Its own send bar, so no tabs. */
export default async function CountPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { ctx, onPhone, can } = await stockCtx();
  if (!can.count) redirect("/stock");
  const db = store();
  const now = Date.now();
  const today = londonDate(now);
  const asked = (await searchParams).for;
  // ?for=<supplier>: that supplier's products, on its order days (a supplier delivering to this kitchen).
  const sup = typeof asked === "string" ? can.kitchenSuppliers.find((x) => x.id === asked) : undefined;
  if (asked && !sup) redirect("/stock");
  if (sup) {
    const [{ products: all }, counts, cfgs] = await Promise.all([db.stockCatalog(), db.stockCounts(ctx.site.id, now - 21 * 86_400_000, sup.id), db.supplierOrders()]);
    const products = all.filter((p) => p.active && p.supplierId === sup.id);
    const latest = counts[0];
    const last = latest ? `Last count ${countAge(latest.date, today)} at ${londonHM(latest.createdAt)}${latest.countedByName ? ` by ${latest.countedByName.split(" ")[0]}` : ""}: ${latest.lines.length} of ${products.length} items` : undefined;
    return (
      <>
        <StockBar ctx={ctx} onPhone={onPhone} title={`Count ${sup.name} stock`} back="/stock" eyebrow={`${ctx.site.name} · ${shortDay(today)}`} />
        <CountForm key={`${ctx.person.id}:${ctx.site.id}:${sup.id}`} storeKey={`phoco-count:${ctx.person.id}:${ctx.site.id}:${sup.id}:${today}`} siteName={ctx.site.name}
          products={products.map((p) => ({ id: p.id, name: p.name, size: p.size, category: p.category }))} last={last} canPlan={false}
          supplier={{ id: sup.id, name: sup.name, canOrder: canOrder(ctx.person, cfgs.find((c) => c.supplierId === sup.id)) }} />
      </>
    );
  }
  const { products, latest } = await kitchenPlan(db, ctx.site.id, now);
  const last = latest ? `Last count ${countAge(latest.date, today)} at ${londonHM(latest.createdAt)}${latest.countedByName ? ` by ${latest.countedByName.split(" ")[0]}` : ""}: ${latest.lines.length} of ${products.length} items` : undefined;

  return (
    <>
      <StockBar ctx={ctx} onPhone={onPhone} title="Count production stock" back="/stock" eyebrow={`${ctx.site.name} · ${shortDay(today)}`} />
      <CountForm key={`${ctx.person.id}:${ctx.site.id}`} storeKey={`phoco-count:${ctx.person.id}:${ctx.site.id}:${today}`} siteName={ctx.site.name}
        products={products.map((p) => ({ id: p.id, name: p.name, size: p.size, category: p.category }))} last={last} canPlan={can.planSites.includes(ctx.site.id)} />
    </>
  );
}
