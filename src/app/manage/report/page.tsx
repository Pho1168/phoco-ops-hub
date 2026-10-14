import Link from "next/link";
import { store } from "@/lib/data";
import { change, groupTotals, type SiteWeekReport } from "@/lib/domain/report";
import { weekStartOf } from "@/lib/domain/rota";
import { addDays, isIsoDate, londonDate, shortDay } from "@/lib/domain/time";
import { BottomNav, TopBar } from "@/components/Chrome";
import { Icon } from "@/components/Icon";
import { requireManager } from "@/lib/session";
import { loadSiteReport } from "@/lib/report-service";

export const dynamic = "force-dynamic";

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Delta({ now, before, unit = "", goodWhenUp }: { now: number | null; before: number | null; unit?: string; goodWhenUp: boolean }) {
  const d = change(now, before);
  if (d === undefined || (d === 0 && !now)) return null;
  if (d === 0) return <span className="muted">same as last week</span>;
  const good = goodWhenUp ? d > 0 : d < 0;
  return <span className={`delta ${good ? "up" : "down"}`}>{d > 0 ? "▲" : "▼"} {Math.abs(d)}{unit} vs last week</span>;
}

function SiteBlock({ name, id, r, last, week }: { name: string; id: string; r: SiteWeekReport; last: SiteWeekReport; week: string }) {
  const max = Math.max(1, ...r.rota.byDay);
  return (
    <section className="card stack report-site" aria-label={name}>
      <div className="row wrap">
        <h2 className="h-sec grow">{name}</h2>
        <Link className="btn ghost small" href={`/manage/records?site=${id}&from=${week}&to=${addDays(week, 6)}`}>Records for this week</Link>
      </div>
      {r.attention.length > 0 ? (
        <ul className="attention">
          {r.attention.map((a, i) => <li key={i} className={a.level}><Icon name={a.level === "info" ? "check" : "alert"} /><span>{a.text}</span></li>)}
        </ul>
      ) : <div className="alert good"><Icon name="check" /><div className="strong">Nothing needs attention this week.</div></div>}

      {!(!r.started && !r.alerts.raised && !r.handover.notes && !r.prep.sent && !r.rota.shifts && !r.equipment.reported && !r.equipment.open) && <div className="kpis">
        {r.started && <div className="kpi">
          <div className="muted">Checklists signed on time</div>
          <div className="stat">{r.checks.onTimeRate === null ? "–" : `${r.checks.onTimeRate}%`}</div>
          <div className="muted">{r.checks.onTime} of {r.checks.expected} · {r.checks.late} late · {r.checks.notSigned} not signed</div>
          <Delta now={r.checks.onTimeRate} before={last.checks.onTimeRate} unit=" pts" goodWhenUp />
        </div>}
        {r.started && <div className="kpi">
          <div className="muted">Temperatures outside limits</div>
          <div className="stat" style={{ color: r.temps.outOfRange ? "var(--bad)" : undefined }}>{r.temps.outOfRange}</div>
          <div className="muted">of {r.temps.readings} readings · {r.temps.withAction} with an action</div>
          <Delta now={r.temps.outOfRange} before={last.temps.outOfRange} goodWhenUp={false} />
        </div>}
        <div className="kpi">
          <div className="muted">Alerts</div>
          <div className="stat">{r.alerts.raised}</div>
          <div className="muted">{r.alerts.resolved} resolved{r.alerts.avgHoursToResolve !== null ? ` in ${fmt(r.alerts.avgHoursToResolve)} h on average` : ""} · {r.alerts.open} open</div>
        </div>
        <div className="kpi">
          <div className="muted">Handover actions</div>
          <div className="stat">{r.handover.actionsDone}/{r.handover.actions}</div>
          <div className="muted">done · {r.handover.slow} took over a day · {r.handover.notes} notes in all</div>
        </div>
        <div className="kpi">
          <div className="muted">Prep handovers</div>
          <div className="stat">{r.prep.sent}</div>
          <div className="muted">{r.prep.needed} items asked for · {r.prep.carried} not done by the next shift</div>
        </div>
        {(r.equipment.reported > 0 || r.equipment.open > 0) && <div className="kpi">
          <div className="muted">Equipment problems</div>
          <div className="stat" style={{ color: r.equipment.stillDown.length ? "var(--bad)" : undefined }}>{r.equipment.reported}</div>
          <div className="muted">reported · {r.equipment.fixed} fixed · {r.equipment.open} still open{r.equipment.downHours ? ` · ${fmt(r.equipment.downHours)} h out of service` : ""}</div>
        </div>}
        <div className="kpi">
          <div className="muted">Planned hours (rota)</div>
          <div className="stat">{r.rota.hours === null ? "–" : fmt(r.rota.hours)}</div>
          <div className="muted">{r.rota.people} people · {r.rota.shifts} shifts{r.rota.bySection.length ? ` · ${r.rota.bySection.map((s) => `${s.section} ${fmt(s.hours)}h`).join(" · ")}` : ""}</div>
          <Delta now={r.rota.hours} before={last.rota.hours} unit="h" goodWhenUp={false} />
        </div>
      </div>}
      {r.rota.shifts > 0 && (
        <div className="bars" aria-label="Planned hours by day">
          {r.rota.byDay.map((h, i) => (
            <div key={i} className="bar-col"><div className="bar-track"><div className="bar-v" style={{ height: `${Math.round((h / max) * 100)}%` }} title={`${fmt(h)} h`} /></div><span>{DAYS[i]}</span><span className="muted">{fmt(h)}</span></div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Owner's weekly report: one block per site, plus a group line across sites. Owners and managers (their sites). */
export default async function Report(props: { searchParams: Promise<{ week?: string }> }) {
  const searchParams = await props.searchParams;
  const ctx = await requireManager();
  const today = londonDate(Date.now());
  const thisWeek = weekStartOf(today);
  let week = isIsoDate(searchParams.week) ? weekStartOf(searchParams.week) : thisWeek;
  if (week > thisWeek) week = thisWeek;
  const sites = (await store().sites()).filter((s) => ctx.managed.includes(s.id) && s.status === "open");
  const reports = await Promise.all(sites.map((s) => loadSiteReport(s, week)));
  const g = groupTotals(reports.map((r) => r.week), new Set(reports.flatMap((r) => r.people)).size);
  const href = (w: string) => `/manage/report?week=${w}`;

  return (
    <>
      <TopBar ctx={ctx} title={`Week of ${shortDay(week)}`} eyebrow={`Weekly report${week === thisWeek ? " · this week so far" : ""}`} back="/manage" />
      <main className="wide">
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="muted lead">What the Monday message says, for every site you run.</span>
          <Link className="btn ghost small" href={href(addDays(week, -7))}>← Previous</Link>
          {week !== thisWeek && <Link className="btn ghost small" href={href(thisWeek)}>This week</Link>}
          {week < thisWeek && <Link className="btn ghost small" href={href(addDays(week, 7))}>Next →</Link>}
        </div>

        {reports.length > 1 && (
          <div className="stats">
            <div className="card"><div className="stat">{g.onTimeRate === null ? "–" : `${g.onTimeRate}%`}</div><div className="muted">checklists on time, all sites</div></div>
            <div className="card"><div className="stat" style={{ color: g.notSigned ? "var(--accent)" : undefined }}>{g.notSigned}</div><div className="muted">not signed off</div></div>
            <div className="card"><div className="stat" style={{ color: g.outOfRange ? "var(--bad)" : undefined }}>{g.outOfRange}</div><div className="muted">temperatures outside limits</div></div>
            <div className="card"><div className="stat" style={{ color: g.openAlerts ? "var(--bad)" : undefined }}>{g.openAlerts}</div><div className="muted">alerts still open</div></div>
            <div className="card"><div className="stat">{g.hours === null ? "–" : fmt(g.hours)}</div><div className="muted">planned hours · {g.people} people</div></div>
          </div>
        )}

        {reports.map((r) => <SiteBlock key={r.site.id} name={r.site.name} id={r.site.id} r={r.week} last={r.last} week={week} />)}
        <div className="muted">Checklist figures start from the day each site began recording on its tablet. Hours are planned hours from the rota sheet, not hours worked.</div>
      </main>
      <BottomNav ctx={ctx} current={ctx.isLead ? "owner" : "manage"} />
    </>
  );
}
