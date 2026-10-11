import Link from "next/link";
import { store } from "@/lib/data";
import { equipmentKindLabel, faultsOf, sinceText, SEVERITY_LABEL } from "@/lib/domain/equipment";
import { londonDate } from "@/lib/domain/time";
import { BottomNav, TopBar } from "@/components/Chrome";
import { requireManager } from "@/lib/session";
import { pickSite } from "../load";
import { itemStatus, RANK, serviceText } from "@/app/equipment/status";
import { EquipmentForm } from "./EquipmentForm";

export const dynamic = "force-dynamic";

/** The equipment register for a site: open problems first, then every piece of kit with its service date. */
export default async function ManageEquipment({ searchParams }: { searchParams: { site?: string } }) {
  const ctx = await requireManager();
  const { sites, site } = await pickSite(ctx.managed, searchParams.site, ctx.site.id);
  const db = store();
  const now = Date.now();
  const today = londonDate(now);
  const [items, events] = await Promise.all([db.equipment(site.id), db.equipmentEvents({ siteId: site.id })]);
  const of = (id: string) => events.filter((e) => e.equipmentId === id);
  const rows = items.map((eq) => ({ eq, st: itemStatus(of(eq.id), now), svc: serviceText(eq, of(eq.id), today) }))
    .sort((a, b) => RANK[a.st.level] - RANK[b.st.level] || a.eq.name.localeCompare(b.eq.name));
  const name = new Map(items.map((e) => [e.id, e.name]));
  const open = faultsOf(events).filter((f) => !f.fixed && name.has(f.fault.equipmentId))
    .sort((a, b) => (a.fault.severity === b.fault.severity ? a.fault.createdAt - b.fault.createdAt : a.fault.severity === "down" ? -1 : 1));
  const down = rows.filter((r) => r.st.level === "down").length;
  const due = rows.filter((r) => r.svc.chip === "bad" || r.svc.chip === "warn").length;

  return (
    <>
      <TopBar ctx={ctx} />
      <main className="wide">
        <div className="row wrap" style={{ alignItems: "flex-end" }}>
          <div className="grow"><div className="eyebrow">Manager tools · maintenance</div><h1 className="h-display">Equipment</h1></div>
          {items.length > 0 && <Link className="btn ghost small" href={`/manage/equipment/labels?site=${site.id}`}>Print QR labels</Link>}
        </div>
        {sites.length > 1 && (
          <nav className="row wrap" style={{ gap: 6 }} aria-label="Site">
            {sites.map((s) => <Link key={s.id} className={`chip ${s.id === site.id ? "done" : ""}`} aria-current={s.id === site.id ? "page" : undefined} href={`/manage/equipment?site=${s.id}`}>{s.name}</Link>)}
          </nav>
        )}

        <div className="stats">
          <div className="card"><div className="stat">{items.length}</div><div className="muted">on the register at {site.name}</div></div>
          <div className="card"><div className="stat" style={{ color: down ? "var(--bad)" : undefined }}>{down}</div><div className="muted">not working</div></div>
          <div className="card"><div className="stat" style={{ color: open.length ? "var(--accent)" : undefined }}>{open.length}</div><div className="muted">open problems</div></div>
          <div className="card"><div className="stat" style={{ color: due ? "var(--accent)" : undefined }}>{due}</div><div className="muted">services due or overdue</div></div>
        </div>

        <section className="stack">
          <h2 className="h-sec">Open problems</h2>
          {open.length === 0 && <div className="card muted">Nothing reported. Staff report problems from the equipment list on the tablet, their phone, or the QR label.</div>}
          {open.map((f) => (
            <Link key={f.fault.id} href={`/equipment/${f.fault.equipmentId}`} className="list-btn">
              <span className="grow">
                <span className="strong" style={{ display: "block" }}>{name.get(f.fault.equipmentId)}: {f.fault.body}</span>
                <span className="muted">{f.fault.createdByName} · {sinceText(f.fault.createdAt, now)} ago{f.updates.length ? ` · latest: ${f.updates[f.updates.length - 1].body}` : ""}</span>
              </span>
              <span className={`chip ${f.fault.severity === "down" ? "bad" : "warn"}`}>{SEVERITY_LABEL[f.fault.severity!]}</span>
            </Link>
          ))}
        </section>

        <section className="stack">
          <h2 className="h-sec">Register</h2>
          {rows.length === 0 ? <div className="card muted">No equipment added for {site.name} yet. Start with the fridges, freezers and probe thermometers.</div> : (
            <div className="table-wrap">
              <table className="rec">
                <thead><tr><th>Equipment</th><th>Where</th><th>Status</th><th>Service</th></tr></thead>
                <tbody>
                  {rows.map(({ eq, st, svc }) => (
                    <tr key={eq.id} className={st.level === "down" ? "bad" : ""}>
                      <td><Link href={`/equipment/${eq.id}`} className="strong">{eq.name}</Link><div className="muted">{equipmentKindLabel(eq.kind)}</div></td>
                      <td>{eq.location ?? ""}</td>
                      <td><span className={`chip ${st.chip}`}>{st.text}</span></td>
                      <td><span className={`chip ${svc.chip}`}>{svc.text}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card stack" aria-label="Add equipment">
          <h2 className="h-sec">Add equipment at {site.name}</h2>
          <EquipmentForm siteId={site.id} today={today} />
        </section>
      </main>
      <BottomNav ctx={ctx} current={ctx.isOwner ? "owner" : "manage"} />
    </>
  );
}
