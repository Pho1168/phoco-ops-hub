import Link from "next/link";
import { redirect } from "next/navigation";
import { store } from "@/lib/data";
import { buildTeamWeek, weekStartOf } from "@/lib/domain/rota";
import { addDays, isIsoDate, londonDate, shortDay } from "@/lib/domain/time";
import type { SiteId } from "@/lib/domain/types";
import { current } from "@/lib/session";
import { BottomNav, PhoneTopBar, TopBar } from "@/components/Chrome";
import { offOn } from "@/lib/domain/timeoff";
import { canManage } from "@/lib/domain/access";
import { sameBusiness } from "@/lib/domain/brand";
import { coverState, liveOffers } from "@/lib/domain/cover";
import { Avatar } from "@/components/Avatar";
import { toneOf } from "@/lib/domain/login";
import { ownerRotaSites } from "@/lib/availability-service";
import { AVAIL_DUE_AT, AVAIL_LABEL, AVAIL_SHORT, availabilityGrid, dueDay } from "@/lib/domain/availability";

export const dynamic = "force-dynamic";

const fmtHours = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));
const dayName = (d: string) => shortDay(d).split(" ")[0];

/**
 * The team rota for one week, like the Schedule tab in the rota sheet: the grid beside this week's numbers, open
 * cover requests and time off. Everyone working at the site can see it, on the shop tablet or their own phone.
 * Paid hours and totals, and weeks not yet published, are for owners and managers.
 */
export default async function TeamRota(props: { searchParams: Promise<{ week?: string; site?: string }> }) {
  const searchParams = await props.searchParams;
  const ctx = await current();
  if (!ctx) redirect("/login");
  if (ctx.person.pinMustChange) redirect("/pin");
  const db = store();
  const sites = sameBusiness((await db.sites()).filter((s) => ctx.person.access.some((a) => a.siteId === s.id) && s.status === "open"), ctx.site);
  const site = sites.find((s) => s.id === searchParams.site) ?? sites.find((s) => s.id === ctx.site.id) ?? sites[0];
  if (!site) redirect(ctx.scope === "shifts" ? "/me" : "/today");
  const isManager = ctx.isOwner || canManage(ctx.person, site.id);

  const now = Date.now();
  const today = londonDate(now);
  const thisWeek = weekStartOf(today);
  const week = isIsoDate(searchParams.week) ? weekStartOf(searchParams.week) : thisWeek;
  const status = (await db.weekStatuses(site.id as SiteId)).get(week);
  const published = status === "published";
  const visible = published || isManager;
  const team = buildTeamWeek(week, visible ? await db.teamShifts(site.id as SiteId, week) : [], isManager);
  // Approved time off this week for people who work at this site.
  const people = await db.people();
  const atSite = new Set(people.filter((p) => p.access.some((a) => a.siteId === site.id)).map((p) => p.id));
  const leave = visible ? (await db.timeOff({ from: week, to: addDays(week, 6), statuses: ["approved"] })).filter((t) => atSite.has(t.personId)) : [];
  const offNames = (date: string) => offOn(leave, date).map((t) => t.personName);
  const isOff = (personId: string, date: string) => offOn(leave, date).some((t) => t.personId === personId);
  // Cover still being arranged at this site, for managers.
  const cover = isManager ? (await db.coverRequests({ siteIds: [site.id as SiteId], live: true })).filter((r) => ["open", "approved"].includes(coverState(r, now))) : [];
  // Availability staff sent for this week (managers, owners, ops): before the rota is written, and while it's worked on.
  const allSites = await db.sites();
  const avail = isManager && week > thisWeek ? availabilityGrid(people, allSites, site.id as SiteId, week, await db.availability(week), await ownerRotaSites(db, people, now)) : undefined;
  const href = (w: string) => `/rota?week=${w}${site.id !== ctx.site.id ? `&site=${site.id}` : ""}`;
  const me = ctx.person.id;
  const tone = (personId: string) => { const p = people.find((x) => x.id === personId); return p ? toneOf(p, site.id as SiteId) : undefined; };
  const Bar = ctx.scope === "full" ? TopBar : PhoneTopBar;
  const weekWord = week === thisWeek ? "this week" : week === addDays(thisWeek, 7) ? "next week" : week === addDays(thisWeek, -7) ? "last week" : "";

  return (
    <>
      <Bar ctx={ctx} title={`Week of ${shortDay(week)}`} eyebrow={`${site.name} · team rota${weekWord ? ` · ${weekWord}` : ""}`}>
        {status && <span className={`chip ${published ? "done" : "warn"}`}>{published ? "Published" : "Draft"}</span>}
      </Bar>
      <main className="wide rota-page">
        <div className="row wrap" style={{ gap: 8 }}>
          <Link className="btn ghost small" href={href(addDays(week, -7))} aria-label="Previous week">← Previous</Link>
          {week !== thisWeek && <Link className="btn ghost small" href={href(thisWeek)}>This week</Link>}
          <Link className="btn ghost small" href={href(addDays(week, 7))} aria-label="Next week">Next →</Link>
          <span className="grow" />
          {sites.length > 1 && (
            <nav className="row" style={{ gap: 6 }} aria-label="Site">
              {sites.map((s) => <Link key={s.id} className={`chip${s.id === site.id ? " done" : ""}`} href={`/rota?week=${week}&site=${s.id}`}>{s.name}</Link>)}
            </nav>
          )}
          {status && !published && <span className="muted">Only managers can see a draft week.</span>}
        </div>

        {!visible && <div className="card muted">This week&apos;s rota isn&apos;t published yet. It shows here as soon as it is.</div>}
        {visible && team.rows.length === 0 && leave.length === 0 && <div className="card muted">No shifts on the rota for this week{status ? "" : " yet"}.</div>}

        {avail && avail.rows.length > 0 && (
          <section className="card stack avail-grid" aria-label="Availability" style={{ gap: 10 }}>
            <div className="row wrap" style={{ gap: 8, alignItems: "baseline" }}>
              <h2 className="h-sec grow" style={{ margin: 0 }}>Availability</h2>
              <span className="muted">{avail.rows.length - avail.waiting.length} of {avail.rows.length} sent · due {shortDay(dueDay(week))} {AVAIL_DUE_AT}</span>
            </div>
            <div className="rota-grid-wrap">
              <table className="rota-grid">
                <colgroup><col className="name" />{avail.days.map((d) => <col key={d} />)}</colgroup>
                <thead>
                  <tr><th scope="col">Name</th>{avail.days.map((d) => <th key={d} scope="col">{dayName(d)}<br /><span className="muted">{shortDay(d).split(" ").slice(1).join(" ")}</span></th>)}</tr>
                </thead>
                <tbody>
                  {avail.rows.map((r) => (
                    <tr key={r.personId}>
                      <th scope="row">
                        <span className="row" style={{ gap: 8 }}>
                          <Avatar name={r.name} tone={tone(r.personId)} size={28} />
                          <span><span className="strong" style={{ fontSize: 14, display: "block", whiteSpace: "normal", lineHeight: 1.2 }}>{r.name}</span>
                            {r.sections.map((x) => <span key={x} className={`sec ${x}`}>{x}</span>)}{r.late && <span className="muted" style={{ fontSize: 12 }}> · late</span>}</span>
                        </span>
                      </th>
                      {avail.days.map((d, i) => {
                        const day = r.answer?.days[i];
                        return (
                          <td key={d}>
                            {day ? <span className={`avail-cell ${day.a}`} title={AVAIL_LABEL[day.a]}>{AVAIL_SHORT[day.a]}</span> : <span className="muted" style={{ fontSize: 12 }}>–</span>}
                            {day?.note && <span className="avail-note">{day.note}</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {avail.waiting.length > 0
              ? <div className="muted"><span className="strong">Not sent yet:</span> {avail.waiting.map((r) => r.name).join(", ")}. They&apos;re reminded on Friday and Saturday morning.</div>
              : <div className="muted">Everyone has sent theirs.</div>}
            <div className="muted" style={{ fontSize: 13 }}>AM = morning (to 15:00), PM = evening, All = all day. Staff send it from My shifts.</div>
          </section>
        )}

        <div className={`cols ${isManager ? "two narrow" : ""}`}>
          {visible && (team.rows.length > 0 || leave.length > 0) && (
            <div className="stack" style={{ gap: 12 }}>
              {/* Computer and tablet: the week as a grid, like the Schedule tab */}
              <div className="rota-grid-wrap">
                <table className="rota-grid">
                  <colgroup><col className="name" />{team.days.map((d) => <col key={d} />)}</colgroup>
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      {team.days.map((d) => <th key={d} scope="col" className={d === today ? "today" : ""}>{dayName(d)}<br /><span className="muted">{shortDay(d).split(" ").slice(1).join(" ")}</span></th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {team.rows.map((r) => (
                      <tr key={`${r.personId}|${r.section}`} className={r.personId === me ? "me" : ""}>
                        <th scope="row">
                          <span className="row" style={{ gap: 8 }}>
                            <Avatar name={r.name} tone={tone(r.personId)} size={28} />
                            <span><span className="strong" style={{ fontSize: 14, display: "block", whiteSpace: "normal", lineHeight: 1.2 }}>{r.name}</span><span className={`sec ${r.section}`}>{r.section}</span>{isManager && <span className="muted" style={{ fontSize: 12 }}> · {fmtHours(r.hours)} h</span>}</span>
                          </span>
                        </th>
                        {r.days.map((cell, i) => (
                          <td key={i} className={team.days[i] === today ? "today" : ""}>
                            {cell.length === 0 && isOff(r.personId, team.days[i]) && <div className="slot off">Off</div>}
                            {cell.length === 0 && !isOff(r.personId, team.days[i]) && <span className="muted" style={{ fontSize: 12 }}>off</span>}
                            {cell.map((s) => (
                              <div key={s!.start} className={`slot ${s!.section}${isManager && isOff(s!.personId, s!.date) ? " clash" : ""}`} title={isManager && isOff(s!.personId, s!.date) ? "On approved time off" : undefined}>
                                {s!.start}–{s!.end}
                                {s!.hours !== undefined && <span className="slot-hrs">{fmtHours(s!.hours)}h paid</span>}
                              </div>
                            ))}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {leave.length > 0 && (
                      <tr className="off-row">
                        <th scope="row">Time off</th>
                        {team.days.map((d) => <td key={d}>{offNames(d).map((n) => <div key={n} className="slot off">{n}</div>)}</td>)}
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr><th scope="row">On shift</th>{team.onShift.map((n, i) => <td key={i} className="num-cell">{n}</td>)}</tr>
                    {isManager && <tr><th scope="row">Hours <span className="muted">({fmtHours(team.weekHours ?? 0)} this week)</span></th>{team.dayHours!.map((n, i) => <td key={i} className="num-cell">{fmtHours(n)}</td>)}</tr>}
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
              <div className="muted">From the {site.name} rota sheet, updated every hour. Changes are made in the sheet, not here.{isManager ? " Paid hours are from the sheet's Export tab." : ""}</div>
            </div>
          )}

          {isManager && (
            <aside className="aside panel">
              <div className="card stack" style={{ gap: 4 }}>
                <div className="eyebrow" style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, fontSize: 12 }}>This week</div>
                <div className="row" style={{ gap: 18 }}>
                  <span className="stack" style={{ gap: 0 }}><span className="stat">{team.people}</span><span className="muted">staff</span></span>
                  <span className="stack" style={{ gap: 0 }}><span className="stat">{fmtHours(team.weekHours ?? 0)}</span><span className="muted">hours planned</span></span>
                </div>
              </div>
              <section className="stack" aria-label="Cover" style={{ gap: 8 }}>
                <h2 className="grp-h">Cover <span>{cover.length ? `${cover.length} in play` : "nothing open"}</span></h2>
                {cover.map((r) => {
                  const st = coverState(r, now);
                  return (
                    <Link key={r.id} href="/manage/cover" className={st === "open" ? "alert" : "list-btn"} style={{ textDecoration: "none", padding: "10px 12px" }}>
                      <Avatar name={r.personName} tone={tone(r.personId)} />
                      <span className="grow">
                        <span className="strong" style={{ display: "block", fontSize: 14 }}>{r.personName} · {shortDay(r.date)} {r.start}–{r.end}</span>
                        <span style={{ fontSize: 12 }}>{st === "open" ? (liveOffers(r).length ? `${liveOffers(r).length} offer${liveOffers(r).length > 1 ? "s" : ""} · waiting for a decision` : "no offers yet") : `${r.coveredByName} covers · until the sheet shows it`}</span>
                      </span>
                    </Link>
                  );
                })}
                <Link className="btn ghost small" href="/manage/cover" style={{ alignSelf: "flex-start" }}>All cover requests</Link>
              </section>
              <section className="stack" aria-label="Time off" style={{ gap: 8 }}>
                <h2 className="grp-h">Time off <span>{leave.length ? `${leave.length} approved this week` : "none this week"}</span></h2>
                {leave.map((t) => (
                  <div key={t.id} className="list-btn" style={{ minHeight: 52, padding: "8px 12px" }}>
                    <Avatar name={t.personName} tone={tone(t.personId)} />
                    <span className="grow"><span className="strong" style={{ display: "block", fontSize: 14 }}>{t.personName}</span><span className="muted">{shortDay(t.startsOn)}{t.endsOn !== t.startsOn ? ` – ${shortDay(t.endsOn)}` : ""}</span></span>
                  </div>
                ))}
                <Link className="btn ghost small" href="/manage/time-off" style={{ alignSelf: "flex-start" }}>Requests to decide</Link>
              </section>
              <div className="card" style={{ background: "color-mix(in srgb, var(--teal-tint) 55%, var(--surface))", fontSize: 13 }}>
                Staff see published weeks with times only. Draft weeks and paid hours are for managers and owners.
              </div>
            </aside>
          )}
        </div>
      </main>
      {ctx.scope === "full" && <BottomNav ctx={ctx} current="rota" />}
    </>
  );
}
