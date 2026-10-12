import Link from "next/link";
import { notFound } from "next/navigation";
import { store } from "@/lib/data";
import { canEditCerts, canSeeRightToWork, certStatus, expectedKinds, statusText, visibleTypes, type Certificate, type CertType } from "@/lib/domain/certificates";
import { dayMonthYear, londonDate } from "@/lib/domain/time";
import { BottomNav, TopBar } from "@/components/Chrome";
import { requireManager } from "@/lib/session";
import { CHIP } from "../cells";
import { CertForm } from "./CertForm";
import { RemoveCert } from "./RemoveCert";

export const dynamic = "force-dynamic";

const day = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });

/** One person's certificates: what counts now, earlier records, and a form to add a new one. */
export default async function PersonCertificates(props: { params: Promise<{ personId: string }> }) {
  const params = await props.params;
  const ctx = await requireManager();
  const db = store();
  const person = await db.person(params.personId);
  if (!person || !canEditCerts(ctx.person, person).ok) notFound();
  const today = londonDate(Date.now());
  const [certs, sites] = await Promise.all([db.certificates({ personIds: [person.id] }), db.sites()]);
  const expected = new Set(expectedKinds(person));
  const types = visibleTypes(canSeeRightToWork(ctx.person));
  const siteNames = person.access.map((a) => `${sites.find((s) => s.id === a.siteId)?.name ?? a.siteId} (${a.role})`).join(" · ");
  const firstMissing = types.find((t) => expected.has(t.id) && certStatus(certs, t.id, true, today).status === "missing")?.id;

  const block = (t: CertType) => {
    const s = certStatus(certs, t.id, expected.has(t.id), today);
    const records = certs.filter((c) => c.kind === t.id).sort((a, b) => b.createdAt - a.createdAt);
    return (
      <div key={t.id} className="stack" style={{ gap: 6, paddingBottom: 6 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="strong grow" style={{ fontSize: 15 }}>{t.label}</span>
          <span className={`chip ${CHIP[s.status]}`}>{statusText(t.id, s, today)}</span>
        </div>
        {records.map((c) => <RecordRow key={c.id} c={c} t={t} current={c.id === s.cert?.id} />)}
      </div>
    );
  };
  const RecordRow = ({ c, t, current }: { c: Certificate; t: CertType; current: boolean }) => (
    <div className={`cert-rec ${current ? "" : "old"}`}>
      <div className="grow" style={{ fontSize: 14 }}>
        <div>{t.dates ? "Checked" : "Issued"} {c.issuedOn ? dayMonthYear(c.issuedOn) : "(date not given)"}{c.expiresOn ? ` · ${t.dates ? "follow-up due" : "runs out"} ${dayMonthYear(c.expiresOn)}` : t.renewYears ? " · no expiry entered" : ""}{!current ? " · replaced" : ""}</div>
        {(c.provider || c.reference) && <div className="muted">{[c.provider, c.reference && `No. ${c.reference}`].filter(Boolean).join(" · ")}</div>}
        {c.note && <div className="muted" style={{ whiteSpace: "pre-wrap" }}>&ldquo;{c.note}&rdquo;</div>}
        <div className="muted" style={{ fontSize: 12 }}>Added by {c.createdByName || "someone"}, {day(c.createdAt)}</div>
      </div>
      <RemoveCert id={c.id} label={t.label} />
    </div>
  );

  const mustHave = types.filter((t) => expected.has(t.id));
  const others = types.filter((t) => !expected.has(t.id));
  const held = others.filter((t) => certs.some((c) => c.kind === t.id));
  const notHeld = others.filter((t) => !certs.some((c) => c.kind === t.id));

  return (
    <>
      <TopBar ctx={ctx} />
      <main>
        <div>
          <div className="eyebrow"><Link href="/manage/certificates" style={{ color: "inherit" }}>Certificates</Link> · {siteNames || "no site"}{person.status !== "active" ? ` · ${person.status}` : ""}</div>
          <h1 className="h-display">{person.name}</h1>
        </div>

        {mustHave.length > 0 && (
          <section className="card stack">
            <h2 className="h-sec">Expected for their role</h2>
            {mustHave.map(block)}
          </section>
        )}
        <section className="card stack">
          <h2 className="h-sec">{mustHave.length ? "Other training" : "Training and checks"}</h2>
          {held.map(block)}
          {notHeld.length > 0 && <div className="muted">Not held: {notHeld.map((t) => t.short).join(", ")}.</div>}
        </section>

        {person.status !== "left" && (
          <CertForm personId={person.id} personName={person.name} today={today} defaultKind={firstMissing ?? types[0].id}
            kinds={types.map((t) => ({ id: t.id, label: t.label, renewYears: t.renewYears, dates: t.dates, noReference: t.noReference, expected: expected.has(t.id) }))} />
        )}
        <Link className="btn ghost" href="/manage/certificates">Back to all certificates</Link>
      </main>
      <BottomNav ctx={ctx} current={ctx.isLead ? "owner" : "manage"} />
    </>
  );
}
