import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/actions";
import { store } from "@/lib/data";
import { buildTeamWeek, weekStartOf } from "@/lib/domain/rota";
import { addDays, isIsoDate, londonDate, shortDay } from "@/lib/domain/time";
import type { SiteId } from "@/lib/domain/types";
import { current } from "@/lib/session";
import { BottomNav, TopBar } from "@/components/Chrome";
import { offOn } from "@/lib/domain/timeoff";

export const dynamic = "force-dynamic";

const fmtHours = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));
const dayName = (d: string) => shortDay(d).split(" ")[0];

/**
 * The team rota for one week, like the Schedule tab in the rota sheet. Everyone working at the site can see it,
 * on the shop tablet or their own phone. Paid hours and totals, and weeks not yet published, are for owners and managers.
 */
export default async function TeamRota(props: { searchParams: Promise<{ week?: string; site?: string }> }) {
  const searchParams = await props.searchParams;
  const ctx = await current();
  if (!ctx) redirect("/login");
  if (ctx.person.pinMustChange) redirect("/pin");
  const db = store();
  const sites = (await db.sites()).filter((s) => ctx.person.access.some((a) => a.siteId === s.id) && s.status === "open");
  const site = sites.find((s) => s.id === searchParams.site) ?? sites.find((s) => s.id === ctx.site.id) ?? sites[0];
  if (!site) redirect(ctx.scope === "shifts" ? "/me" : "/today");
  const access = ctx.person.access.find((a) => a.siteId === site.id);
  const isManager = ctx.isOwner || access?.role === "manager";

  const today = londonDate(Date.now());
  const thisWeek = weekStartOf(today);
  const week = isIsoDate(searchParams.week) ? weekStartOf(searchParams.week) : thisWeek;
  const status = (await db.weekStatuses(site.id as SiteId)).get(week);
  const published = status === "published";
  const visible = published || isManager;
  const team = buildTeamWeek(week, visible ? await db.teamShifts(site.id as SiteId, week) : [], isManager);
  // Approved time off this week for people who work at this site.
  const atSite = new Set((await db.people()).filter((p) => p.access.some((a) => a.siteId === site.id)).map((p) => p.id));
  const leave = visible ? (await db.timeOff({ from: week, to: addDays(week, 6), statuses: ["approved"] })).filter((t) => atSite.has(t.personId)) : [];
  const offNames = (date: string) => offOn(leave, date).map((t) => t.personName);
  const isOff = (personId: string, date: string) => offOn(leave, date).some((t) => t.personId === personId);
  const href = (w: string) => `/rota?week=${w}${site.id !== ctx.site.id ? `&site=${site.id}` : ""}`;
  const me = ctx.person.id;

  return (
    <>
      {ctx.scope === "full" ? <TopBar ctx={ctx} /> : (
        <header className="top">
          <div className="logo">PHO &amp; CO</div>
          <div className="who">
            <span>{ctx.person.name}</span>
            <Link className="pill-btn" href="/me">My shifts</Link>
            <form action={signOut}><button className="pill-btn" type="submit">Sign out</button></form>
          </div>
        </header>
      )}
      <main className="wide rota-page">
        <div className="row wrap" style={{ alignItems: "flex-end" }}>
          <div className="grow">
            <div className="eyebrow">{site.name} · team rota{week === thisWeek ? " · this week" : week === addDays(thisWeek, 7) ? " · next week" : ""}</div>
            <h1 className="h-display">Week of {shortDay(week)}</h1>
          </div>
          {sites.length > 1 && (
            <nav className="row" style={{ gap: 6 }} aria-label="Site">
              {sites.map((s) => <Link key={s.id} className={`chip${s.id === site.id ? " done" : ""}`} href={`/rota?week=${week}&site=${s.id}`}>{s.name}</Link>)}
            </nav>
          )}
        </div>

        <div className="row wrap" style={{ gap: 8 }}>
          <Link className="btn ghost small" href={href(addDays(week, -7))} aria-label="Previous week">← Previous</Link>
          {week !== thisWeek && <Link className="btn ghost small" href={href(thisWeek)}>This week</Link>}
          <Link className="btn ghost small" href={href(addDays(week, 7))} aria-label="Next week">Next →</Link>
          <span className="grow" />
          {status && <span className={`chip ${published ? "done" : "warn"}`}>{published ? "Published" : "Draft · only managers can see this"}</span>}
        </div>

        {!visible && <div className="card muted">This week&apos;s rota isn&apos;t published yet. It shows here as soon as it is.</div>}
        {visible && team.rows.length === 0 && leave.length === 0 && <div className="card muted">No shifts on the rota for this week{status ? "" : " yet"}.</div>}

        {visible && (team.rows.length > 0 || leave.length > 0) && (
          <>
            {isManager && (
              <div className="row wrap" style={{ gap: 10 }}>
                <div className="card" style={{ padding: "10px 16px" }}><div className="stat">{fmtHours(team.weekHours ?? 0)}</div><div className="muted">hours planned</div></div>
                <div className="card" style={{ padding: "10px 16px" }}><div className="stat">{team.people}</div><div className="muted">staff</div></div>
              </div>
            )}

            {/* Computer and tablet: the week as a grid, like the Schedule tab */}
            <div className="rota-grid-wrap">
              <table className="rota-grid">
                <colgroup><col className="name" />{team.days.map((d) => <col key={d} />)}{isManager && <col style={{ width: 64 }} />}</colgroup>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    {team.days.map((d) => <th key={d} scope="col" className={d === today ? "today" : ""}>{dayName(d)}<br /><span className="muted">{shortDay(d).split(" ").slice(1).join(" ")}</span></th>)}
                    {isManager && <th scope="col">Hours</th>}
                  </tr>
                </thead>
                <tbody>
                  {team.rows.map((r) => (
                    <tr key={`${r.personId}|${r.section}`} className={r.personId === me ? "me" : ""}>
                      <th scope="row"><span className="strong" style={{ fontSize: 15 }}>{r.name}</span> <span className={`sec ${r.section}`}>{r.section}</span></th>
                      {r.days.map((cell, i) => (
                        <td key={i} className={team.days[i] === today ? "today" : ""}>
                          {cell.length === 0 && isOff(r.personId, team.days[i]) && <div className="slot off">Off</div>}
                          {cell.map((s) => (
                            <div key={s!.start} className={`slot ${s!.section}${isManager && isOff(s!.personId, s!.date) ? " clash" : ""}`} title={isManager && isOff(s!.personId, s!.date) ? "On approved time off" : undefined}>
                              {s!.start}–{s!.end}
                              {s!.hours !== undefined && <span className="slot-hrs">{fmtHours(s!.hours)}h paid</span>}
                            </div>
                          ))}
                        </td>
                      ))}
                      {isManager && <td className="num-cell">{fmtHours(r.hours)}</td>}
                    </tr>
                  ))}
                  {leave.length > 0 && (
                    <tr className="off-row">
                      <th scope="row">Time off</th>
                      {team.days.map((d) => <td key={d}>{offNames(d).map((n) => <div key={n} className="slot off">{n}</div>)}</td>)}
                      {isManager && <td />}
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr><th scope="row">On shift</th>{team.onShift.map((n, i) => <td key={i} className="num-cell">{n}</td>)}{isManager && <td className="num-cell">{team.people}</td>}</tr>
                  {isManager && <tr><th scope="row">Hours</th>{team.dayHours!.map((n, i) => <td key={i} className="num-cell">{fmtHours(n)}</td>)}<td className="num-cell strong">{fmtHours(team.weekHours ?? 0)}</td></tr>}
                </tfoot>
              </table>
            </div>

            {/* Phone: day by day */}
            <div className="rota-days">
              {team.byDay.map((d) => (
                <section key={d.date} className={`card stack rota-day${d.date === today ? " today" : ""}`} style={{ gap: 6 }}>
                  <div className="row">
                    <span className="strong grow">{d.date === today ? "Today" : dayName(d.date)} {shortDay(d.date).split(" ").slice(1).join(" ")}</span>
                    <span className="muted">{d.shifts.length ? `${new Set(d.shifts.map((s) => s.personId)).size} on` : "Nobody on"}{isManager && team.dayHours ? ` · ${fmtHours(team.dayHours[team.days.indexOf(d.date)])}h` : ""}</span>
                  </div>
                  {offNames(d.date).length > 0 && <div className="muted">Off: {offNames(d.date).join(", ")}</div>}
                  {d.shifts.map((s) => (
                    <div key={`${s.personId}|${s.section}|${s.start}`} className={`row rota-line${s.personId === me ? " me" : ""}${isManager && isOff(s.personId, s.date) ? " clash" : ""}`} style={{ gap: 10 }}>
                      <span className={`sec ${s.section}`}>{s.section}</span>
                      <span className="grow">{s.name}{s.personId === me ? " (you)" : ""}</span>
                      <span className="strong" style={{ fontSize: 15, fontVariantNumeric: "tabular-nums" }}>{s.start}–{s.end}</span>
                      {s.hours !== undefined && <span className="muted">{fmtHours(s.hours)}h</span>}
                    </div>
                  ))}
                </section>
              ))}
            </div>
          </>
        )}
        <div className="muted">From the {site.name} rota sheet, updated every hour. Changes are made in the sheet, not here.</div>
      </main>
      {ctx.scope === "full" && <BottomNav ctx={ctx} current="rota" />}
    </>
  );
}
