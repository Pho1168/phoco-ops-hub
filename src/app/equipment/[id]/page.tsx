import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { store } from "@/lib/data";
import { canManageEquipment, canUseEquipment, equipmentKindLabel, faultHint, faultsOf, sinceText, SEVERITY_LABEL, type EquipmentEvent } from "@/lib/domain/equipment";
import { dayMonthYear, londonDate } from "@/lib/domain/time";
import { current } from "@/lib/session";
import { BottomNav, PhoneTopBar, TopBar } from "@/components/Chrome";
import { itemStatus, serviceText } from "../status";
import { FaultActions } from "./FaultActions";
import { ReportFault } from "./ReportFault";
import { ServiceForm } from "./ServiceForm";
import { EquipmentForm } from "@/app/manage/equipment/EquipmentForm";

export const dynamic = "force-dynamic";

const when = (t: number) => new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const LOG = { fault: "Problem reported", update: "Update", fixed: "Fixed", service: "Serviced" } as const;

/**
 * One piece of kit: how it is, how to use it, problems and their fixes, and servicing. The QR label on the
 * equipment opens this page. Anyone at the site can report a problem; updates and fixes need the shop tablet.
 */
export default async function EquipmentItem({ params }: { params: { id: string } }) {
  const ctx = await current();
  if (!ctx) redirect(`/login?next=${encodeURIComponent(`/equipment/${params.id}`)}`);
  if (ctx.person.pinMustChange) redirect("/pin");
  const db = store();
  const eq = await db.equipmentItem(params.id);
  if (!eq || !canUseEquipment(ctx.person, eq.siteId)) notFound();
  const [events, site] = await Promise.all([db.equipmentEvents({ equipmentId: eq.id }), db.site(eq.siteId)]);
  const now = Date.now();
  const today = londonDate(now);
  const st = itemStatus(events, now);
  const faults = faultsOf(events);
  const open = faults.filter((f) => !f.fixed);
  const full = ctx.scope === "full";
  const isManager = full && canManageEquipment(ctx.person, eq.siteId);
  const svc = serviceText(eq, events, today);
  const history = [...events].sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
  const faultOf = (e: EquipmentEvent) => events.find((x) => x.id === e.faultId);

  return (
    <>
      {full ? <TopBar ctx={ctx} /> : <PhoneTopBar ctx={ctx} />}
      <main>
        <div>
          <div className="eyebrow"><Link href={`/equipment?site=${eq.siteId}`} style={{ color: "inherit" }}>Equipment</Link> · {site?.name}{eq.location ? ` · ${eq.location}` : ""}</div>
          <h1 className="h-display">{eq.name}</h1>
          <div className="muted">{[equipmentKindLabel(eq.kind), eq.makeModel, eq.serial && `Serial ${eq.serial}`].filter(Boolean).join(" · ")}</div>
        </div>

        {eq.retiredAt
          ? <div className="card muted">Taken off the equipment register on {dayMonthYear(londonDate(eq.retiredAt))}. Its history is kept below.</div>
          : <div className={`alert ${st.level === "down" ? "bad" : st.level === "ok" ? "good" : ""}`} role="status"><div className="strong">{st.text}</div></div>}

        {open.length > 0 && (
          <section className="stack" aria-label="Open problems">
            <h2 className="h-sec">Open problems</h2>
            {open.map((f) => (
              <div key={f.fault.id} className="card stack" style={{ gap: 8 }}>
                <div className="row wrap" style={{ gap: 8 }}>
                  <span className={`chip ${f.fault.severity === "down" ? "bad" : "warn"}`}>{SEVERITY_LABEL[f.fault.severity!]}</span>
                  <span className="muted grow">{f.fault.createdByName} · {when(f.fault.createdAt)} · {sinceText(f.fault.createdAt, now)} ago</span>
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{f.fault.body}</div>
                {f.updates.map((u) => <div key={u.id} className="muted" style={{ fontSize: 14 }}>↳ {u.body} <span style={{ fontSize: 12 }}>({u.createdByName}, {when(u.createdAt)})</span></div>)}
                {full && <FaultActions equipmentId={eq.id} faultId={f.fault.id} />}
              </div>
            ))}
            {!full && <div className="muted" style={{ fontSize: 13 }}>Updates and fixes are added on the shop tablet.</div>}
          </section>
        )}

        {!eq.retiredAt && <ReportFault equipmentId={eq.id} name={eq.name} hint={faultHint(eq.kind)} />}

        {eq.instructions && (
          <section className="card stack" aria-label="How to use it" style={{ gap: 6 }}>
            <h2 className="h-sec">How to use it</h2>
            <div style={{ whiteSpace: "pre-wrap" }}>{eq.instructions}</div>
          </section>
        )}

        {isManager && !eq.retiredAt && (
          <section className="card stack" aria-label="Servicing" style={{ gap: 8 }}>
            <div className="row wrap" style={{ gap: 8 }}>
              <h2 className="h-sec grow">Servicing</h2>
              <span className={`chip ${svc.chip}`}>{svc.text}</span>
            </div>
            <div className="muted">{eq.serviceEveryMonths ? `Every ${eq.serviceEveryMonths} month${eq.serviceEveryMonths > 1 ? "s" : ""}` : "No regular service set"}{eq.serviceContact ? ` · ${eq.serviceContact}` : ""}</div>
            <ServiceForm equipmentId={eq.id} today={today} />
          </section>
        )}

        {history.length > 0 && (
          <section className="stack" aria-label="History">
            <h2 className="h-sec">History</h2>
            <div className="card log">
              {history.map((e) => (
                <div key={e.id} style={{ flexDirection: "column", gap: 2 }}>
                  <span><span className="strong">{LOG[e.kind]}</span>{e.kind === "fault" ? ` (${SEVERITY_LABEL[e.severity!].toLowerCase()})` : ""}{e.kind === "service" && e.doneOn ? ` on ${dayMonthYear(e.doneOn)}` : ""}: {e.body}</span>
                  <span className="muted">{e.createdByName} · {when(e.createdAt)}{(e.kind === "fixed") && faultOf(e) ? ` · out ${sinceText(faultOf(e)!.createdAt, e.createdAt)}` : ""}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {isManager && !eq.retiredAt && (
          <details className="card">
            <summary className="strong" style={{ cursor: "pointer" }}>Edit details</summary>
            <div style={{ marginTop: 10 }}>
              <EquipmentForm siteId={eq.siteId} item={{ id: eq.id, name: eq.name, kind: eq.kind, location: eq.location ?? "", makeModel: eq.makeModel ?? "", serial: eq.serial ?? "",
                serviceEveryMonths: eq.serviceEveryMonths ?? null, serviceContact: eq.serviceContact ?? "", instructions: eq.instructions ?? "" }} />
            </div>
          </details>
        )}
      </main>
      {full && <BottomNav ctx={ctx} current="handover" />}
    </>
  );
}
