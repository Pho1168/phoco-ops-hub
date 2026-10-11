import Link from "next/link";
import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { canManageEquipment, canUseEquipment, equipmentKindLabel } from "@/lib/domain/equipment";
import { current } from "@/lib/session";
import { BottomNav, PhoneTopBar, TopBar } from "@/components/Chrome";
import { itemStatus, RANK } from "./status";

export const dynamic = "force-dynamic";

/** The site's equipment and how each piece is. Tap one to see how to use it or report a problem. Tablet or own phone. */
export default async function EquipmentList({ searchParams }: { searchParams: { site?: string } }) {
  const ctx = await current();
  if (!ctx) redirect("/login");
  if (ctx.person.pinMustChange) redirect("/pin");
  const db = store();
  const sites = (await db.sites()).filter((s) => s.status === "open" && canUseEquipment(ctx.person, s.id));
  const site = sites.find((s) => s.id === searchParams.site) ?? sites.find((s) => s.id === ctx.site.id) ?? sites[0];
  if (!site) redirect(ctx.scope === "shifts" ? "/me" : "/today");
  const [items, events] = await Promise.all([db.equipment(site.id), db.equipmentEvents({ siteId: site.id, openFaultsOnly: true })]);
  const now = Date.now();
  const rows = items.map((eq) => ({ eq, st: itemStatus(events.filter((e) => e.equipmentId === eq.id), now) }))
    .sort((a, b) => RANK[a.st.level] - RANK[b.st.level] || a.eq.name.localeCompare(b.eq.name));
  const isManager = ctx.scope === "full" && canManageEquipment(ctx.person, site.id);

  return (
    <>
      {ctx.scope === "full" ? <TopBar ctx={ctx} /> : <PhoneTopBar ctx={ctx} />}
      <main>
        <div className="row wrap" style={{ alignItems: "flex-end" }}>
          <div className="grow"><div className="eyebrow">{site.name} · equipment</div><h1 className="h-display">Equipment</h1></div>
          {isManager && <Link className="btn ghost small" href={`/manage/equipment?site=${site.id}`}>Manage</Link>}
        </div>
        {sites.length > 1 && (
          <nav className="row wrap" style={{ gap: 6 }} aria-label="Site">
            {sites.map((s) => <Link key={s.id} className={`chip ${s.id === site.id ? "done" : ""}`} aria-current={s.id === site.id ? "page" : undefined} href={`/equipment?site=${s.id}`}>{s.name}</Link>)}
          </nav>
        )}
        <div className="muted">Something not working? Tap it below to report it, and the managers are told straight away. You can also scan the label on the equipment.</div>
        {rows.length === 0 && <div className="card muted">No equipment has been added for {site.name} yet.{isManager ? " Add it under Manage." : " A manager adds it."}</div>}
        <section className="stack" aria-label="Equipment list">
          {rows.map(({ eq, st }) => (
            <Link key={eq.id} href={`/equipment/${eq.id}`} className="list-btn">
              <span className="grow">
                <span className="strong" style={{ display: "block" }}>{eq.name}</span>
                <span className="muted">{[eq.location, equipmentKindLabel(eq.kind)].filter(Boolean).join(" · ")}</span>
              </span>
              <span className={`chip ${st.chip}`}>{st.text}</span>
            </Link>
          ))}
        </section>
      </main>
      {ctx.scope === "full" && <BottomNav ctx={ctx} current="handover" />}
    </>
  );
}
