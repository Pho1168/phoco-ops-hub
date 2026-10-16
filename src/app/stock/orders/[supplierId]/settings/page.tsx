import { notFound } from "next/navigation";
import { store } from "@/lib/data";
import { isOwner } from "@/lib/domain/access";
import { StockBar, StockNav } from "../../../Bar";
import { ownerStockCtx } from "../../../load";
import { SettingsForm } from "./SettingsForm";

export const dynamic = "force-dynamic";

/** The owner sets a supplier's order days (UK time), the production kitchen it delivers to, and who orders from it. */
export default async function SupplierOrderSettings(props: { params: Promise<{ supplierId: string }> }) {
  const { supplierId } = await props.params;
  const { ctx, onPhone } = await ownerStockCtx();
  const db = store();
  const [{ suppliers }, cfgs, sites, people, purchasers] = await Promise.all([db.stockCatalog(), db.supplierOrders(), db.sites(), db.people(), db.purchaserIds()]);
  const supplier = suppliers.find((s) => s.id === supplierId);
  if (!supplier || supplier.method === "production") notFound();
  const cfg = cfgs.find((c) => c.supplierId === supplierId);
  const kitchens = sites.filter((s) => s.kind === "production").map((s) => ({ id: s.id, name: s.name, open: s.status === "open" }));
  const staff = people.filter((p) => p.status === "active" && !isOwner(p))
    .map((p) => ({ id: p.id, name: p.name, purchaser: purchasers.includes(p.id), roles: [...new Set(p.access.map((a) => a.role))].join(", ") }))
    .sort((a, b) => Number(b.purchaser) - Number(a.purchaser) || a.name.localeCompare(b.name));

  return (
    <>
      <StockBar ctx={ctx} onPhone={onPhone} title={supplier.name} back="/stock/catalogue" eyebrow="Catalogue and suppliers · order days" />
      <main className="wide stack">
        <SettingsForm supplierId={supplier.id} supplierName={supplier.name} kitchens={kitchens} people={staff}
          start={{ deliversTo: cfg?.deliversTo ?? "", days: cfg?.days ?? [], orderers: cfg?.orderers ?? [] }} />
      </main>
      <StockNav ctx={ctx} onPhone={onPhone} />
    </>
  );
}
