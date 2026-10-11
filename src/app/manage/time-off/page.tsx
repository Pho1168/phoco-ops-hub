import { store } from "@/lib/data";
import { clashes, daysOf, kindLabel, offOn, overlaps, rangeLabel, type TimeOff } from "@/lib/domain/timeoff";
import { addDays, londonDate, shortDay } from "@/lib/domain/time";
import { BottomNav, TopBar } from "@/components/Chrome";
import { requireManager } from "@/lib/session";
import { Decide } from "./Decide";

export const dynamic = "force-dynamic";

const when = (t: number) => new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const STATUS = { pending: ["Waiting", "warn"], approved: ["Approved", "done"], declined: ["Declined", "bad"], cancelled: ["Withdrawn", ""] } as const;

/** Time-off requests for the sites a manager runs: decide the waiting ones, see what's coming up. */
export default async function TimeOffPage() {
  const ctx = await requireManager();
  const db = store();
  const today = londonDate(Date.now());
  const [all, sites] = await Promise.all([db.timeOff({ siteIds: ctx.managed, from: addDays(today, -30) }), db.sites()]);
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  const pending = all.filter((t) => t.status === "pending").sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const approved = all.filter((t) => t.status === "approved" && t.endsOn >= today).sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const recent = all.filter((t) => !pending.includes(t) && !approved.includes(t)).slice(0, 20);
  const details = await Promise.all(pending.map(async (t) => ({
    t,
    shifts: clashes(t, (await db.shiftsForPerson(t.personId, t.startsOn, t.endsOn)).filter((s) => !s.cancelled)),
    alsoOff: approved.filter((o) => o.personId !== t.personId && o.siteId === t.siteId && overlaps(o, t)),
  })));
  const multiSite = ctx.managed.length > 1;
  const days = (t: TimeOff) => daysOf(t).length;

  return (
    <>
      <TopBar ctx={ctx} />
      <main>
        <div><div className="eyebrow">Manager tools</div><h1 className="h-display">Time off</h1></div>

        <section className="stack">
          <h2 className="h-sec">To decide ({pending.length})</h2>
          {pending.length === 0 && <div className="card muted">Nothing waiting. Staff ask from My shifts on their phone, and you&apos;re told straight away.</div>}
          {details.map(({ t, shifts, alsoOff }) => (
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
              <Decide id={t.id} name={t.personName} />
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
      <BottomNav ctx={ctx} current={ctx.isOwner ? "owner" : "manage"} />
    </>
  );
}
