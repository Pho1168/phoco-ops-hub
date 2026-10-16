import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { canPurchase, canReportAt, onProductionTeam, runsOrdering, runsPurchasing } from "@/lib/domain/stock";
import { canCount, plansProduction } from "@/lib/domain/stock-count";
import { current, type Ctx } from "@/lib/session";

/**
 * Signed in on the tablet or their own phone (drivers use their phones), with their own PIN. What they can do in
 * Stock & Purchasing: report at this site, the catalogue (owner), Stock needed (owner, ops), the production kitchens they're on the team of,
 * whether they can be given purchasing work, count production stock here, and the kitchens whose day they plan.
 */
export async function stockCtx(): Promise<{ ctx: Ctx; onPhone: boolean; can: { report: boolean; purchasing: boolean; ordering: boolean; productionSites: string[]; purchaser: boolean; count: boolean; planSites: string[] } }> {
  const ctx = await current();
  if (!ctx) redirect("/login");
  if (ctx.person.pinMustChange) redirect("/pin");
  const db = store();
  const [sites, purchasers] = await Promise.all([db.sites(), db.purchaserIds()]);
  const productionSites = sites.filter((s) => s.kind === "production" && s.status === "open" && onProductionTeam(ctx.person, s.id)).map((s) => s.id);
  const planSites = sites.filter((s) => s.kind === "production" && s.status === "open" && plansProduction(ctx.person, s.id)).map((s) => s.id);
  return {
    ctx, onPhone: ctx.scope === "shifts",
    can: { report: canReportAt(ctx.person, ctx.site), purchasing: runsPurchasing(ctx.person), ordering: runsOrdering(ctx.person), productionSites, purchaser: canPurchase({ ...ctx.person, purchaser: purchasers.includes(ctx.person.id) }),
      count: canCount(ctx.person, ctx.site), planSites },
  };
}

/** For the owner's pages: anyone else goes to the Stock home. */
export async function ownerStockCtx() {
  const s = await stockCtx();
  if (!s.can.purchasing) redirect("/stock");
  return s;
}

export const qtyText = (n: number | undefined) => (n === undefined ? "no amount" : Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));

/** For Stock needed: owners and operations managers; anyone else goes to the Stock home. */
export async function orderingStockCtx() {
  const s = await stockCtx();
  if (!s.can.ordering) redirect("/stock");
  return s;
}
