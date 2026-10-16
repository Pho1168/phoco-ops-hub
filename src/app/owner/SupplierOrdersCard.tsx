import Link from "next/link";
import { DOW, dowOf, startQty } from "@/lib/domain/supplier-orders";
import { londonDate, londonHM, shortDay } from "@/lib/domain/time";
import type { SupplierView } from "@/lib/supplier-order-service";
import { RoundChip } from "../stock/orders/parts";

const BOX = { gap: 6, textDecoration: "none", color: "inherit", background: "var(--bg)", borderRadius: 14, padding: "12px 14px" } as const;
/** A link to the order for whoever can open it; otherwise just the box. */
const Box = ({ href, children }: { href?: string; children: React.ReactNode }) =>
  href ? <Link href={href} className="stack" style={BOX}>{children}</Link> : <div className="stack" style={BOX}>{children}</div>;
const when = (iso: string, at: number) => `${DOW[dowOf(iso)].slice(0, 3)} ${londonHM(at)}`;

/**
 * The owner's glance at suppliers on order days (Surelygrow): the next deadline, the kitchen's count, how much the
 * order suggests, who orders, and the last delivery. Reads only; the order page does the work.
 */
export function SupplierOrdersCard({ views, names, opens, now }: { views: SupplierView[]; names: Map<string, string>; opens: Set<string>; now: number }) {
  if (!views.length) return null;
  const today = londonDate(now);
  return (
    <section className="card stack" aria-label="Supplier orders" style={{ gap: 12 }}>
      <h2 className="h-sec">Supplier orders</h2>
      {views.map((v) => {
        const r = v.next;
        const toOrder = v.rows.filter((x) => (startQty(x) ?? 0) > 0).length;
        const who = v.cfg.orderers.map((id) => names.get(id)?.split(" ")[0]).filter(Boolean).join(", ") || "Owners only";
        const lastDone = v.history.find((h) => h.state === "delivered" || h.state === "short");
        const ms = r ? r.round.cutoffAt - now : 0;
        return (
          <Box key={v.supplier.id} href={opens.has(v.supplier.id) ? `/stock/orders/${v.supplier.id}` : undefined}>
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="strong grow">{v.supplier.name} → {v.site.name}</span>
              {r && <RoundChip state={r.state} />}
            </div>
            {r ? (
              <>
                <span>Order by <b>{when(r.round.cutDate, r.round.cutoffAt)}</b> for the {when(r.round.delDate, r.round.deliveryAt)} delivery{ms < 6 * 3_600_000 ? ` · ${Math.max(0, Math.round(ms / 60_000))} min left` : ""}</span>
                <span className="muted" style={{ fontSize: 14 }}>
                  {r.count ? `Counted ${r.count.date === today ? "today" : shortDay(r.count.date)} ${londonHM(r.count.createdAt)}${r.count.countedByName ? ` by ${r.count.countedByName.split(" ")[0]}` : ""} · ${toOrder} to order` : "Not counted yet"}
                  {` · ordered by ${who}`}
                </span>
              </>
            ) : <span className="muted">No order days coming up.</span>}
            {v.last && v.last.state === "missed" && now < v.last.round.deliveryAt && <span className="err-text" style={{ fontSize: 14 }}>The {when(v.last.round.cutDate, v.last.round.cutoffAt)} deadline passed with nothing ordered.</span>}
            {lastDone && <span className="muted" style={{ fontSize: 14 }}>Last delivery {shortDay(lastDone.task.requiredBy ?? londonDate(lastDone.task.roundAt!))}: {lastDone.state === "short" ? "something was short" : "all arrived"}</span>}
          </Box>
        );
      })}
    </section>
  );
}
