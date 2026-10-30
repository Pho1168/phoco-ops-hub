import { store } from "@/lib/data";
import { redirect } from "next/navigation";
import { canPurchase, deliveryDaysText, editsSiteNeeded, lookAlikes, methodOf, neededCount, nextDelivery, ordersByRound, runsPurchasing, shopsLine, siteWaitingRows, type NeededRow, type RemovedRow } from "@/lib/domain/stock";
import { boardGroups } from "./board";
import Link from "next/link";
import { londonDate, londonHM, shortDay } from "@/lib/domain/time";
import { neededView, siteNeededView } from "@/lib/stock-service";
import type { Ctx } from "@/lib/session";
import { StockBar, StockNav } from "../Bar";
import { stockCtx } from "../load";
import { NeededBoard } from "./NeededBoard";
import { NewItemsCard } from "./NewItemsCard";
import { ClearNeeded } from "./ClearNeeded";
import { PrintStock } from "../PrintStock";
import { SiteNeeded, type SiteGroup } from "./SiteNeeded";

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));
/** "Changed to 6 (was 4) by Amrit · 16:40": the latest change of amount today. */
const changedLine = (c: NeededRow["changed"]) =>
  c && `Changed to ${fmt(c.qty)}${c.was !== undefined ? ` (was ${fmt(c.was)})` : ""}${c.by ? ` by ${c.by}` : ""} · ${londonHM(c.at)}`;
const removedLine = (x: RemovedRow, site?: string) =>
  `Removed${x.by ? ` by ${x.by}` : ""} ${londonHM(x.at)}: ${x.qty !== undefined ? `${fmt(x.qty)} × ` : ""}${x.product.name}${site ? ` (${site})` : ""}`;

export const dynamic = "force-dynamic";

/**
 * Stock needed (owners and operations managers): everything the restaurants asked for, one card per supplier, as a
 * checklist. Tick = ordered or bought (production: sent). Shop runs can go to a driver; a delivery supplier's list
 * downloads as a PDF to email.
 */
export default async function NeededPage() {
  const { ctx, onPhone, can } = await stockCtx();
  if (!can.ordering) {
    // Everyone else, on the restaurant's tablet: its own list, to change or take things off.
    if (onPhone || !editsSiteNeeded(ctx.person, ctx.site, ctx.scope)) redirect("/stock");
    return <SitePage ctx={ctx} />;
  }
  const db = store();
  const now = Date.now();
  const [{ groups, sites, items, siteIds, catalog }, people, purchasers] = await Promise.all([neededView(db, ctx.person, now), db.people(), db.purchaserIds()]);
  const newItems = await db.stockNewItems({ open: true, siteIds });
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  // What clearing would take off: every row and every item with a driver, and new items (the owner's to decide).
  const clearable = groups.filter((g) => !ordersByRound(g.supplier)).reduce((n, g) => n + g.rows.length + g.drivers.reduce((m, d) => m + d.open, 0), 0) + (runsPurchasing(ctx.person) ? newItems.length : 0);
  const drivers = people.filter((p) => canPurchase({ ...p, purchaser: purchasers.includes(p.id) }))
    .map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name));
  // A round supplier's order (Surelygrow, Monday and Friday) has its own page: kept off this list.
  const rounds = catalog.suppliers.filter((s) => ordersByRound(s)).map((s) => {
    const g = groups.find((x) => x.supplier?.id === s.id);
    return { supplier: s, items: g ? neededCount([g]) : 0, next: nextDelivery(s.deliveryDays ?? [], now) };
  });
  const board = boardGroups(groups.filter((g) => !ordersByRound(g.supplier)), { siteName, items, suppliers: catalog.suppliers });
  return (
    <>
      <StockBar ctx={ctx} onPhone={onPhone} title="Stock needed" back="/stock" eyebrow={`Stock · ${shortDay(londonDate(now))}`} />
      <main className="stack">
        <PrintStock label="Everything below, with boxes to tick." />
        {newItems.length > 0 && (
          <NewItemsCard owner={runsPurchasing(ctx.person)}
            items={newItems.map((n) => ({ id: n.id, name: n.name, size: n.size, qty: n.qty, note: n.note, site: siteName.get(n.siteId) ?? n.siteId,
              by: n.requestedByName?.split(" ")[0], at: n.createdAt, like: lookAlikes(n.name, catalog.products).map((p) => ({ id: p.id, label: p.size ? `${p.name} · ${p.size}` : p.name })) }))}
            suppliers={catalog.suppliers.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name })).sort((a, b) => a.name.localeCompare(b.name))}
            categories={[...new Set(catalog.products.map((p) => p.category).filter((c): c is string => !!c))].sort()} />
        )}
        {rounds.map(({ supplier: s, items: n, next }) => (
          <Link key={s.id} className="card row wrap stock-round-link" href={`/stock/order/${s.id}`} style={{ gap: 10, alignItems: "center", textDecoration: "none", color: "inherit" }}>
            <span className="grow stack" style={{ gap: 2 }}>
              <span className="strong">{s.name} order · separate list</span>
              <span className="muted">Delivers {deliveryDaysText(s.deliveryDays ?? [])}{next ? ` · next ${shortDay(next.date)}, order by end of ${shortDay(next.orderBy)}` : ""}</span>
            </span>
            {n > 0 && <span className="chip warn">{n} item{n === 1 ? "" : "s"}</span>}
            <span className="btn small ghost">Open</span>
          </Link>
        ))}
        <NeededBoard groups={board} drivers={drivers} />
        {(clearable > 0) && <ClearNeeded count={clearable} />}
      </main>
      <StockNav ctx={ctx} onPhone={onPhone} />
    </>
  );
}

/** The restaurant's own Stock needed (the tablet): what it asked for, to change or remove while it's still waiting. */
async function SitePage({ ctx }: { ctx: Ctx }) {
  const now = Date.now();
  const { groups, items, catalog } = await siteNeededView(store(), ctx.site.id, now);
  const waiting = siteWaitingRows(groups, items);
  const view: SiteGroup[] = groups.map((g) => ({
    key: g.key, name: g.supplier?.name ?? "No supplier yet", methodLabel: g.production ? "Production" : g.supplier ? methodOf(g.supplier.method)?.label ?? "" : "Supplier to set",
    rows: waiting.filter((w) => w.group === g).map(({ row: r, editable, status }) => ({
      productId: r.product.id, name: r.product.name, pack: r.product.size, qty: r.qty, unknown: r.qty === 0 && r.unknownIds.length > 0, urgent: r.urgent, notes: r.notes,
      editable, status: status === "kitchen" ? "On the kitchen's order" : status === "ordering" ? "Being ordered" : undefined, changed: changedLine(r.changed),
      shops: g.production ? undefined : shopsLine(g.supplier, r.product, catalog.suppliers) })),
    drivers: g.drivers.map((d) => ({ name: d.task.assigneeName?.split(" ")[0] ?? "a driver", items: d.items.map((x) => `${fmt(x.qty)} × ${x.name}`).join(" · ") })),
    ticked: g.ticked.map((t) => ({ name: t.product.name, qty: t.qty, who: londonHM(t.at) })),
    removed: g.removed.map((x) => removedLine(x)),
  }));
  return (
    <>
      <StockBar ctx={ctx} onPhone={false} title="Stock needed" back="/stock" eyebrow={`${ctx.site.name} · ${shortDay(londonDate(now))}`} />
      <main className="stack">
        <PrintStock label={`${ctx.site.name}'s list below, with boxes to tick.`} />
        <SiteNeeded site={ctx.site.name} groups={view} />
      </main>
      <StockNav ctx={ctx} onPhone={false} />
    </>
  );
}
