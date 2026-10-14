import Link from "next/link";
import { describeRule } from "@/lib/domain/temperature";
import { clampRange } from "@/lib/domain/records";
import { addDays, londonDate, shortDay } from "@/lib/domain/time";
import { BottomNav, TopBar } from "@/components/Chrome";
import { requireManager } from "@/lib/session";
import { pickSite } from "../load";
import { loadRecords } from "./data";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

const hm = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const dayHm = (t: number) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const RESULT = { ok: ["OK", "done"], warn: ["Above target", "warn"], bad: ["Out of limit", "bad"], done: ["Done", "done"], todo: ["", ""] } as const;
const STATUS = { on_time: ["On time", "done"], late: ["Signed late", "warn"], not_signed: ["Not signed", "bad"], open: ["Still open", ""] } as const;

/**
 * Inspection mode: the food-safety records an Environmental Health Officer asks for, for one site and date range.
 * Owners and managers. Printable, and the temperature log downloads as CSV.
 */
export default async function Records(
  props: { searchParams: Promise<{ site?: string; from?: string; to?: string }> }
) {
  const searchParams = await props.searchParams;
  const ctx = await requireManager();
  const { sites, site } = await pickSite(ctx.managed, searchParams.site, ctx.site.id);
  const today = londonDate(Date.now());
  const { from, to } = clampRange(searchParams.from, searchParams.to, today, 7);
  const r = await loadRecords(site.id, from, to);
  const q = (f: string, t: string) => `/manage/records?site=${site.id}&from=${f}&to=${t}`;
  const csv = (kind: string) => `/manage/records/csv?site=${site.id}&from=${from}&to=${to}&kind=${kind}`;
  const range = `${shortDay(from)} ${from.slice(0, 4)} to ${shortDay(to)} ${to.slice(0, 4)}`;

  return (
    <>
      <TopBar ctx={ctx} title="Food safety records" eyebrow={`${site.name} · ${range}`} back="/manage" />
      <main className="wide records">
        {/* The bar doesn't print: the inspector's copy gets its own heading. */}
        <div className="print-only">
          <div className="eyebrow">PHO &amp; CO · food safety records</div>
          <h1 className="h-display">{site.name}</h1>
          <div className="strong" style={{ fontSize: 15 }}>{range}</div>
        </div>
        <div className="row wrap no-print" style={{ gap: 8 }}>
          <span className="muted lead">The records an Environmental Health Officer asks for. Print them, or download the logs.</span>
          <PrintButton />
          <a className="btn ghost small" href={csv("temps")} download>Temperatures CSV</a>
          <a className="btn ghost small" href={csv("signoffs")} download>Sign-offs CSV</a>
        </div>

        <form className="card row wrap no-print" style={{ gap: 10 }} action="/manage/records">
          {sites.length > 1 && (
            <label className="row" style={{ gap: 6 }}><span className="muted">Site</span>
              <select name="site" defaultValue={site.id}>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </label>
          )}
          {sites.length === 1 && <input type="hidden" name="site" value={site.id} />}
          <label className="row" style={{ gap: 6 }}><span className="muted">From</span><input className="txt" style={{ width: 160 }} type="date" name="from" defaultValue={from} max={today} /></label>
          <label className="row" style={{ gap: 6 }}><span className="muted">To</span><input className="txt" style={{ width: 160 }} type="date" name="to" defaultValue={to} max={today} /></label>
          <button className="btn small" type="submit">Show</button>
          <span className="row wrap" style={{ gap: 6 }}>
            <Link className="chip" href={q(today, today)}>Today</Link>
            <Link className="chip" href={q(addDays(today, -6), today)}>Last 7 days</Link>
            <Link className="chip" href={q(addDays(today, -27), today)}>Last 28 days</Link>
            <Link className="chip" href={q(addDays(today, -89), today)}>Last 90 days</Link>
          </span>
        </form>

        <div className="stats">
          <div className="card"><div className="stat">{r.summary.readings}</div><div className="muted">temperature readings</div></div>
          <div className="card"><div className="stat" style={{ color: r.summary.outOfRange ? "var(--bad)" : undefined }}>{r.summary.outOfRange}</div><div className="muted">outside target or limit</div></div>
          <div className="card"><div className="stat">{r.summary.actions}/{r.summary.outOfRange}</div><div className="muted">with a corrective action</div></div>
          <div className="card"><div className="stat">{r.summary.onTime + r.summary.late}</div><div className="muted">checklists signed ({r.summary.late} late)</div></div>
          <div className="card"><div className="stat" style={{ color: r.summary.notSigned ? "var(--accent)" : undefined }}>{r.summary.notSigned}</div><div className="muted">not signed</div></div>
        </div>
        {!r.trackingFrom && <div className="card muted">No checklists have been recorded at {site.name} yet. Records start from the first day a checklist is filled in on the shop tablet.</div>}
        {r.trackingFrom && r.trackingFrom > from && <div className="muted">Checklists at {site.name} have been recorded since {shortDay(r.trackingFrom)} {r.trackingFrom.slice(0, 4)}. Days before that aren&apos;t counted.</div>}

        <section className="stack">
          <h2 className="h-sec">Temperature log</h2>
          {r.readings.length === 0 ? <div className="card muted">No temperature readings in this period.</div> : (
            <div className="table-wrap">
              <table className="rec">
                <thead><tr><th>Date</th><th>Time</th><th>Check</th><th>Reading</th><th>Limit</th><th>Result</th><th>Corrective action</th><th>By</th></tr></thead>
                <tbody>
                  {r.readings.map((x, i) => {
                    const rule = x.ruleCode ? r.rules[x.ruleCode] : undefined;
                    return (
                      <tr key={i} className={x.outcome === "bad" ? "bad" : x.outcome === "warn" ? "warn" : ""}>
                        <td>{shortDay(x.date)}</td><td>{hm(x.at)}</td>
                        <td>{x.itemText}<div className="muted">{x.listName}</div></td>
                        <td className="num-cell strong">{x.value}°C{x.correctedTo !== undefined && <div className="muted">re-checked: {x.correctedTo}°C</div>}</td>
                        <td className="muted">{rule ? describeRule(rule) : ""}</td>
                        <td><span className={`chip ${RESULT[x.outcome][1]}`}>{RESULT[x.outcome][0]}</span></td>
                        <td>{x.action ? <>{x.action}<div className="muted">{x.actionByName} · {x.actionAt ? hm(x.actionAt) : ""}</div></> : x.outcome === "ok" ? "" : <span className="chip bad">None recorded</span>}</td>
                        <td>{x.byName}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="stack">
          <h2 className="h-sec">Checklist sign-offs</h2>
          <div className="muted no-print">Checklists with a due time are expected every day. Ones without (deliveries, toilet rounds, weekly cleans) only show once someone starts them.</div>
          {r.signoffs.length === 0 ? <div className="card muted">No checklists to show for this period.</div> : (
            <div className="table-wrap">
              <table className="rec">
                <thead><tr><th>Date</th><th>Checklist</th><th>Due</th><th>Status</th><th>Signed</th><th>By</th><th>Checks done</th></tr></thead>
                <tbody>
                  {r.signoffs.map((x) => (
                    <tr key={`${x.date}|${x.listId}`} className={x.status === "not_signed" ? "bad" : ""}>
                      <td>{shortDay(x.date)}</td><td>{x.listName}<div className="muted">{x.area}</div></td><td>{x.due ?? ""}</td>
                      <td><span className={`chip ${STATUS[x.status][1]}`}>{STATUS[x.status][0]}</span></td>
                      <td>{x.signedAt ? dayHm(x.signedAt) : ""}</td><td>{x.signedByName ?? ""}</td>
                      <td className="num-cell">{x.total ? `${x.answered}/${x.total}` : "0"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="stack">
          <h2 className="h-sec">Alerts and how they were resolved</h2>
          {r.alerts.length === 0 ? <div className="card muted">No alerts in this period.</div> : (
            <div className="table-wrap">
              <table className="rec">
                <thead><tr><th>Raised</th><th>Level</th><th>What</th><th>Resolved</th><th>By</th><th>What was done</th></tr></thead>
                <tbody>
                  {r.alerts.map((a) => (
                    <tr key={a.id}>
                      <td>{dayHm(a.createdAt)}</td><td><span className={`chip ${a.level === "critical" ? "bad" : "warn"}`}>{a.level === "critical" ? "Critical" : "Warning"}</span></td>
                      <td>{a.title}<div className="muted">{a.detail}</div></td>
                      <td>{a.resolvedAt ? dayHm(a.resolvedAt) : <span className="chip bad">Still open</span>}</td><td>{a.resolvedByName ?? ""}</td><td>{a.resolutionNote ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="stack">
          <h2 className="h-sec">Food safety notes from handovers</h2>
          {r.foodSafety.length === 0 ? <div className="card muted">No food safety notes in this period.</div> : (
            <div className="table-wrap">
              <table className="rec">
                <thead><tr><th>Written</th><th>Note</th><th>By</th><th>Done</th></tr></thead>
                <tbody>
                  {r.foodSafety.map((n) => (
                    <tr key={n.id}><td>{dayHm(n.createdAt)}</td><td style={{ whiteSpace: "pre-wrap" }}>{n.body}</td><td>{n.createdByName}</td><td>{n.closedAt ? `${dayHm(n.closedAt)} · ${n.closedByName ?? ""}` : n.needsAction ? "Open" : "For info"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="muted">Records are kept exactly as entered. Readings and checks can&apos;t be edited or deleted: a correction is added as a new entry, and both are shown. Printed {dayHm(Date.now())} by {ctx.person.name}.</div>
      </main>
      <BottomNav ctx={ctx} current={ctx.isLead ? "owner" : "manage"} />
    </>
  );
}
