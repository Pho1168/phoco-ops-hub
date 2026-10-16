import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { canPurchase, canReportAt, onProductionTeam, runsPurchasing } from "@/lib/domain/stock";
import { canCount, plansProduction } from "@/lib/domain/stock-count";
import { canOrder, isScheduled } from "@/lib/domain/supplier-orders";
import { current, type Ctx } from "@/lib/session";

/**
 * Signed in on the tablet or their own phone (drivers use their phones), with their own PIN. What they can do in
 * Stock & Purchasing: report at this site, run purchasing (owner), the production kitchens they're on the team of,
 * whether they can be given purchasing work, count production stock here, and the kitchens whose day they plan.
 */
export async function stockCtx(): Promise<{ ctx: Ctx; onPhone: boolean; can: { report: boolean; purchasing: boolean; productionSites: string[]; purchaser: boolean; count: boolean; planSites: string[];
  /** Scheduled suppliers this person orders from, and the ones delivering to this kitchen (counted and received here). */
  orders: { id: string; name: string }[]; kitchenSuppliers: { id: string; name: string }[] } }> {
  const ctx = await current();
  if (!ctx) redirect("/login");
  if (ctx.person.pinMustChange) redirect("/pin");
  const db = store();
  const [sites, purchasers, cfgs, { suppliers }] = await Promise.all([db.sites(), db.purchaserIds(), db.supplierOrders(), db.stockCatalog()]);
  const named = (id: string) => ({ id, name: suppliers.find((x) => x.id === id)?.name ?? "Supplier" });
  const live = cfgs.filter(isScheduled).filter((c) => suppliers.some((x) => x.id === c.supplierId && x.active));
  const orders = live.filter((c) => canOrder(ctx.person, c)).map((c) => named(c.supplierId));
  const kitchenSuppliers = canCount(ctx.person, ctx.site) ? live.filter((c) => c.deliversTo === ctx.site.id).map((c) => named(c.supplierId)) : [];
  const productionSites = sites.filter((s) => s.kind === "production" && s.status === "open" && onProductionTeam(ctx.person, s.id)).map((s) => s.id);
  const planSites = sites.filter((s) => s.kind === "production" && s.status === "open" && plansProduction(ctx.person, s.id)).map((s) => s.id);
  return {
    ctx, onPhone: ctx.scope === "shifts",
    can: { report: canReportAt(ctx.person, ctx.site), purchasing: runsPurchasing(ctx.person), productionSites, purchaser: canPurchase({ ...ctx.person, purchaser: purchasers.includes(ctx.person.id) }),
      count: canCount(ctx.person, ctx.site), planSites, orders, kitchenSuppliers },
  };
}

/** For the owner's pages: anyone else goes to the Stock home. */
export async function ownerStockCtx() {
  const s = await stockCtx();
  if (!s.can.purchasing) redirect("/stock");
  return s;
}

export const qtyText = (n: number | undefined) => (n === undefined ? "not sure" : Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));
