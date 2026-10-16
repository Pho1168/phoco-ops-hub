import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { countAge } from "@/lib/domain/stock-count";
import { londonDate, londonHM, shortDay } from "@/lib/domain/time";
import { kitchenPlan } from "@/lib/stock-service";
import { StockBar } from "../Bar";
import { stockCtx } from "../load";
import { CountForm } from "./CountForm";

export const dynamic = "force-dynamic";

/** Count production stock: the production team counts what's on the shelf at the kitchen, at close. Its own send bar, so no tabs. */
export default async function CountPage() {
  const { ctx, onPhone, can } = await stockCtx();
  if (!can.count) redirect("/stock");
  const db = store();
  const now = Date.now();
  const today = londonDate(now);
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
