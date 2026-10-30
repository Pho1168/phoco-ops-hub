import { buyFrom, methodOf, shopsLine, type NeededGroup, type NeededRow, type RemovedRow, type Supplier } from "@/lib/domain/stock";
import { londonHM } from "@/lib/domain/time";
import type { BoardGroup } from "./NeededBoard";

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));
/** "Changed to 6 (was 4) by Amrit · 16:40": the latest change of amount today. */
const changedLine = (c: NeededRow["changed"]) =>
  c && `Changed to ${fmt(c.qty)}${c.was !== undefined ? ` (was ${fmt(c.was)})` : ""}${c.by ? ` by ${c.by}` : ""} · ${londonHM(c.at)}`;
const removedLine = (x: RemovedRow, site?: string) =>
  `Removed${x.by ? ` by ${x.by}` : ""} ${londonHM(x.at)}: ${x.qty !== undefined ? `${fmt(x.qty)} × ` : ""}${x.product.name}${site ? ` (${site})` : ""}`;

/** Stock needed's cards for the board (also the round supplier's own order page). */
export function boardGroups(groups: NeededGroup[], opts: { siteName: Map<string, string>; items: { request: { id: string; siteId: string } }[]; suppliers: Supplier[] }): BoardGroup[] {
  const { siteName, items } = opts;
  const catalog = { suppliers: opts.suppliers };
  return groups.map((g) => ({
    key: g.key, name: g.supplier?.name ?? "No supplier yet", method: g.supplier?.method ?? "shop", methodLabel: g.supplier ? methodOf(g.supplier.method)?.label ?? "" : "Set one in the catalogue",
    production: g.production, pdf: g.supplier?.method === "delivery",
    rows: g.rows.map((r) => ({
      productId: r.product.id, name: r.product.name, pack: r.product.size, qty: r.qty, urgent: r.urgent, notes: r.notes, photoIds: r.photoIds,
      sites: r.sites.filter((s) => s.qty > 0).map((s) => ({ name: siteName.get(s.siteId) ?? s.siteId, qty: s.qty })),
      unknown: r.unknownIds.map((id) => {
        const siteId = items.find((x) => x.request.id === id)?.request.siteId;
        return { requestId: id, site: siteId ? siteName.get(siteId) ?? siteId : undefined };
      }),
      // Other shops that sell it, to move it to before a run (not for a production kitchen's items).
      buyFrom: g.production ? [] : buyFrom(r.product, catalog.suppliers).filter((s) => s.id !== g.supplier?.id).map((s) => ({ id: s.id, name: s.name })),
      changed: changedLine(r.changed),
      shops: g.production ? undefined : shopsLine(g.supplier, r.product, catalog.suppliers),
    })),
    removed: g.removed.map((x) => removedLine(x, siteName.get(x.siteId) ?? x.siteId)),
    drivers: g.drivers.map((d) => ({ taskId: d.task.id, name: d.task.assigneeName ?? "Someone", items: d.items, open: d.open, done: d.done })),
    ticked: g.ticked.map((t) => ({
      productId: t.product.id, name: t.product.name, pack: t.product.size, qty: t.qty,
      sites: t.sites.map((s) => ({ name: siteName.get(s.siteId) ?? s.siteId, qty: s.qty })),
      who: `${t.by.length ? `${t.by.join(", ")} · ` : ""}${londonHM(t.at)}`,
    })),
  }));
}
