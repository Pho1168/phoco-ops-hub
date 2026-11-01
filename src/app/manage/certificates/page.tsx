import Link from "next/link";
import { brandOf } from "@/lib/domain/brand";
import { store } from "@/lib/data";
import { canSeeRightToWork, certStatus, certType, expectedKinds, issueCount, peopleInCare, siteCover, statusText, visibleTypes, type CertKind } from "@/lib/domain/certificates";
import { londonDate } from "@/lib/domain/time";
import type { Role } from "@/lib/domain/types";
import { BottomNav, TopBar } from "@/components/Chrome";
import { requireManager } from "@/lib/session";
import { pickSite } from "../load";
import { CHIP, cellText } from "./cells";

export const dynamic = "force-dynamic";

const ROLE_ORDER: Record<Role, number> = { ops: 0, manager: 1, staff: 2, owner: 3 };
const ROLE: Record<Role, string> = { ops: "Ops manager", manager: "Manager", staff: "Staff", owner: "Owner" };

/**
 * Who holds which certificate at a site, what's running out, and whether the site has a first aider, a Level 3
 * supervisor and a fire marshal. Owners and managers; right to work shows for owners only.
 */
export default async function Certificates(props: { searchParams: Promise<{ site?: string }> }) {
  const searchParams = await props.searchParams;
  const ctx = await requireManager();
  const { sites, site } = await pickSite(ctx.managed, searchParams.site, ctx.site.id);
  const db = store();
  const today = londonDate(Date.now());
  const [people, certs] = await Promise.all([db.people(), db.certificates()]);
  const here = peopleInCare(ctx.person, people)
    .filter((p) => p.access.some((a) => a.siteId === site.id))
    .map((p) => ({ ...p, role: p.access.find((a) => a.siteId === site.id)!.role }))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name));
  const seesRtw = canSeeRightToWork(ctx.person);
  const types = visibleTypes(seesRtw);
  const mine = (id: string) => certs.filter((c) => c.personId === id);
  const cover = site.status === "open" ? siteCover(site.id, here, certs, today) : [];
  const issues = issueCount(here, certs, today, seesRtw, site.status === "open" ? [site.id] : []);

  const soon: { person: string; personId: string; kind: CertKind; text: string; level: "critical" | "warn" }[] = [];
  let missing = 0;
  for (const p of here) {
    const expected = new Set(expectedKinds(p));
    for (const t of types) {
      const s = certStatus(mine(p.id), t.id, expected.has(t.id), today);
      if (s.status === "expired" || s.status === "expiring") soon.push({ person: p.name, personId: p.id, kind: t.id, text: statusText(t.id, s, today), level: s.status === "expired" ? "critical" : "warn" });
      if (s.status === "missing") missing++;
    }
  }
  soon.sort((a, b) => (a.level === b.level ? 0 : a.level === "critical" ? -1 : 1));

  return (
    <>
      <TopBar ctx={ctx} title="Certificates" eyebrow={`Manager tools · ${site.name}`} back="/manage" />
      <main className="wide">

        {sites.length > 1 && (
          <nav className="row wrap" style={{ gap: 6 }} aria-label="Site">
            {sites.map((s) => <Link key={s.id} className={`chip ${s.id === site.id ? "done" : ""}`} aria-current={s.id === site.id ? "page" : undefined} href={`/manage/certificates?site=${s.id}`}>{s.name}</Link>)}
          </nav>
        )}

        <div className="stats">
          <div className="card"><div className="stat">{here.filter((p) => p.status === "active").length}</div><div className="muted">people at {site.name}</div></div>
          <div className="card"><div className="stat" style={{ color: issues ? "var(--accent)" : undefined }}>{issues}</div><div className="muted">need attention</div></div>
          <div className="card"><div className="stat" style={{ color: soon.some((s) => s.level === "critical") ? "var(--bad)" : undefined }}>{soon.length}</div><div className="muted">run out or running out</div></div>
        </div>

        {cover.length > 0 && (
          <section className="card stack" aria-label="Site cover">
            <h2 className="h-sec">Cover at {site.name}</h2>
            {cover.map((c) => (
              <div key={c.kind} className="row wrap" style={{ gap: 8 }}>
                <span className="strong grow" style={{ fontSize: 15 }}>{certType(c.kind).label}</span>
                {c.holders.length ? <span className="chip done">{c.holders.join(", ")}</span> : <span className="chip bad">Nobody yet</span>}
              </div>
            ))}
            <div className="muted">At least one trained person per site is recommended. Check the rota so one of them is on each shift.</div>
          </section>
        )}

        {(soon.length > 0 || missing > 0) && (
          <section className="stack">
            <h2 className="h-sec">To sort</h2>
            <ul className="attention">
              {soon.map((s) => <li key={`${s.personId}-${s.kind}`} className={s.level}><Link href={`/manage/certificates/${s.personId}`} className="grow" style={{ color: "inherit" }}>{s.person}: {certType(s.kind).label}</Link><span>{s.text}</span></li>)}
              {missing > 0 && <li className="info">{missing} expected certificate{missing === 1 ? " hasn't" : "s haven't"} been recorded yet. Tap a name below to add them.</li>}
            </ul>
          </section>
        )}

        <section className="stack">
          <h2 className="h-sec">Who holds what</h2>
          {here.length === 0 ? <div className="card muted">Nobody is set up at {site.name} yet.</div> : (
            <div className="table-wrap">
              <table className="rec matrix">
                <thead><tr><th>Name</th>{types.map((t) => <th key={t.id}>{t.short}</th>)}</tr></thead>
                <tbody>
                  {here.map((p) => {
                    const expected = new Set(expectedKinds(p));
                    return (
                      <tr key={p.id}>
                        <th scope="row"><Link href={`/manage/certificates/${p.id}`}>{p.name}</Link><div className="muted" style={{ fontWeight: 400 }}>{ROLE[p.role]}{p.status === "frozen" ? " · frozen" : ""}</div></th>
                        {types.map((t) => {
                          const s = certStatus(mine(p.id), t.id, expected.has(t.id), today);
                          return <td key={t.id} title={`${t.label}: ${statusText(t.id, s, today)}`}><span className={`chip ${CHIP[s.status]}`}>{cellText(t.id, s, today)}</span></td>;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="row wrap muted" style={{ gap: 8, fontSize: 13 }}>
            <span><span className="chip done">✓</span> valid (to)</span>
            <span><span className="chip warn">12 days</span> runs out soon</span>
            <span><span className="chip bad">Expired</span></span>
            <span><span className="chip late">Missing</span> expected for their role</span>
            <span><span className="chip">–</span> not held</span>
          </div>
        </section>

        <details className="card">
          <summary className="strong" style={{ cursor: "pointer" }}>What each one is, and who needs it</summary>
          <div className="log" style={{ marginTop: 8 }}>
            {types.map((t) => (
              <div key={t.id} style={{ flexDirection: "column", gap: 2 }}>
                <span className="strong" style={{ fontSize: 14 }}>{t.label}{t.renewYears ? ` · refresh every ${t.renewYears} years` : ""}</span>
                <span>{t.why}.</span>
                <span className="muted">{t.expectedFor === "everyone" ? "Expected for everyone (not owners)." : t.expectedFor === "managers" ? "Expected for managers." : t.sitecover ? "At least one person per site." : "Optional."}{t.restricted ? " Private: only you can see or change this." : ""}</span>
              </div>
            ))}
            <div className="muted">These are {brandOf(ctx.site).name}&apos;s working standard, not legal advice. Reminders go to the person and their managers 30 days and 7 days before a date, and when it passes.</div>
          </div>
        </details>
      </main>
      <BottomNav ctx={ctx} current={ctx.isLead ? "owner" : "manage"} />
    </>
  );
}
