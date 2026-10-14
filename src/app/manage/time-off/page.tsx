import { store } from "@/lib/data";
import { canDecide, clashes, daysOf, kindLabel, offOn, overlaps, rangeLabel, seesRequest, type TimeOff } from "@/lib/domain/timeoff";
import { addDays, londonDate, shortDay } from "@/lib/domain/time";
import { BottomNav, TopBar } from "@/components/Chrome";
import { requireManager } from "@/lib/session";
import { Decide } from "./Decide";

export const dynamic = "force-dynamic";

const when = (t: number) => new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const STATUS = { pending: ["Waiting", "warn"], approved: ["Approved", "done"], declined: ["Declined", "bad"], cancelled: ["Withdrawn", ""] } as const;

/**
 * Time-off requests for the sites a manager runs: decide the waiting ones, see what's coming up. An operations
 * manager's own requests and decisions are for the owners (and them) only; their approved time off still shows below.
 */
export default async function TimeOffPage() {
  const ctx = await requireManager();
  const db = store();
  const today = londonDate(Date.now());
  const [listed, sites, people] = await Promise.all([db.timeOff({ siteIds: ctx.managed, from: addDays(today, -30) }), db.sites(), db.people()]);
  const byId = new Map(people.map((p) => [p.id, p]));
  const requester = (t: TimeOff) => byId.get(t.personId) ?? { access: [] };
  const all = listed.filter((t) => t.status === "approved" || seesRequest(ctx.person, t, requester(t)));
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  const pending = all.filter((t) => t.status === "pending").sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const approved = all.filter((t) => t.status === "approved" && t.endsOn >= today).sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const recent = all.filter((t) => !pending.includes(t) && !approved.includes(t) && seesRequest(ctx.person, t, requester(t))).slice(0, 20);
  // Ones this person can decide first; their own (and anything else waiting for someone else) after, with who decides.
  const details = (await Promise.all(pending.map(async (t) => ({
    t, can: canDecide(ctx.person, t, requester(t)),
    shifts: clashes(t, (await db.shiftsForPerson(t.personId, t.startsOn, t.endsOn)).filter((s) => !s.cancelled)),
    alsoOff: approved.filter((o) => o.personId !== t.personId && o.siteId === t.siteId && overlaps(o, t)),
  })))).sort((a, b) => Number(b.can.ok) - Number(a.can.ok));
  const toDecide = details.filter((d) => d.can.ok).length;
  const multiSite = ctx.managed.length > 1;
  const days = (t: TimeOff) => daysOf(t).length;

  return (
    <>
      <TopBar ctx={ctx} title="Time off" eyebrow="Manager tools" back="/manage" />
      <main>

        <section className="stack">
          <h2 className="h-sec">To decide ({toDecide})</h2>
          {pending.length === 0 && <div className="card muted">Nothing waiting. Staff ask from My shifts on their phone, and you&apos;re told straight away.</div>}
          {details.map(({ t, can, shifts, alsoOff }) => (
            <div key={t.id} className="card stack" style={{ gap: 10 }}>
              <div className="row wrap" style={{ gap: 8 }}>
                <span className="strong grow" style={{ fontSize: 17 }}>{t.personName}</span>
                <span className="chip">{kindLabel(t.kind)}</span>
                {multiSite && <span className="chip">{siteName.get(t.siteId)}</span>}
              </div>
              <div className="stat" style={{ fontSize: 26 }}>{rangeLabel(t)}</div>
              {t.note && <div style={{ whiteSpace: "pre-wrap" }}>&ldquo;{t.note}&rdquo;</div>}
              <div className="muted">Asked {when(t.createdAt)}</div>
              {shifts.length > 0
                ? <div className="alert"><div className="grow"><div className="strong" style={{ fontSize: 14 }}>On the rota for {shifts.length} of these {days(t)} day{days(t) > 1 ? "s" : ""}</div>
                    <div style={{ fontSize: 13 }}>{shifts.map((s) => `${shortDay(s.date)} ${s.start}–${s.end} ${s.section}${s.published ? "" : " (draft)"}`).join(" · ")}. If you approve, change the rota sheet too.</div></div></div>
                : <div className="muted">Not on the rota on these days.</div>}
              {alsoOff.length > 0 && <div className="muted">Also off then: {alsoOff.map((o) => `${o.personName} (${rangeLabel(o)})`).join(", ")}</div>}
              {can.ok ? <Decide id={t.id} name={t.personName} /> : <div className="muted">{can.error}</div>}
            </div>
          ))}
        </section>

        <section className="stack">
          <h2 className="h-sec">Coming up</h2>
          {approved.length === 0 && <div className="card muted">No approved time off coming up.</div>}
          {approved.length > 0 && (
            <div className="card log">
              {approved.map((t) => (
                <div key={t.id}><span className="grow"><span className="strong" style={{ fontSize: 14 }}>{t.personName}</span> · {rangeLabel(t)} <span className="muted">· {kindLabel(t.kind)}{offOn([t], today).length ? " · off today" : ""}</span></span></div>
              ))}
            </div>
          )}
        </section>

        {recent.length > 0 && (
          <details className="card">
            <summary className="strong" style={{ cursor: "pointer" }}>Recent decisions ({recent.length})</summary>
            <div className="log" style={{ marginTop: 8 }}>
              {recent.map((t) => (
                <div key={t.id} style={{ alignItems: "center" }}>
                  <span className="grow">{t.personName} · {rangeLabel(t)} <span className="muted">{t.decidedByName ? `· ${t.decidedByName}` : ""}{t.decisionNote ? ` · "${t.decisionNote}"` : ""}</span></span>
                  <span className={`chip ${STATUS[t.status][1]}`}>{STATUS[t.status][0]}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </main>
      <BottomNav ctx={ctx} current={ctx.isLead ? "owner" : "manage"} />
    </>
  );
}
