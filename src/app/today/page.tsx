import Link from "next/link";
import { store } from "@/lib/data";
import { progress, runState } from "@/lib/domain/checklist";
import { canUsePrep } from "@/lib/domain/prep";
import { faultsOf, sinceText } from "@/lib/domain/equipment";
import { dueText, isForPerson, priorityCode, taskOrder } from "@/lib/domain/tasks";
import { TaskDone, UndoTask } from "@/components/TaskDone";
import { currentNotes } from "@/lib/domain/handover";
import { londonNow, requireCtx } from "@/lib/session";
import { BottomNav, TopBar } from "@/components/Chrome";
import { Icon } from "@/components/Icon";
import { NoticeBanner } from "@/components/NoticeBanner";
import { unreadFor } from "@/lib/domain/notices";
import { teamRowsView, teamToday } from "@/lib/team-today";
import { TeamToday } from "@/components/TeamToday";
import { ReadyLight } from "@/components/ReadyLight";
import { GasCheck } from "@/components/GasCheck";
import { gasFor, readyFor } from "@/lib/daily-service";
import { londonHM, londonToUtc } from "@/lib/domain/time";

export const dynamic = "force-dynamic";

const LABEL = { done: "Done", overdue: "Overdue", in_progress: "In progress", not_started: "" } as const;
const CHIP = { done: "done", overdue: "late", in_progress: "warn", not_started: "" } as const;
const GROUPS = [["FOH", "Front of house"], ["BOH", "Back of house"], ["PROD", "Production"]] as const;

export default async function Today() {
  const ctx = await requireCtx();
  const db = store();
  const { date, hm } = londonNow();
  const all = await db.checklists(ctx.site.id);
  const lists = all.filter((l) => ctx.isManager || ctx.access.sections.includes(l.area));
  const rows = await Promise.all(lists.map(async (l) => {
    const run = await db.run(l.id, date);
    const p = progress(l, run.answers);
    return { l, p, state: runState(p, !!run.signedAt, l.due, hm) };
  }));
  const overdue = rows.filter((r) => r.state === "overdue");
  const alerts = (await db.alerts(ctx.site.id)).filter((a) => !a.resolvedAt);
  const done = rows.filter((r) => r.state === "done").length;
  const prepOn = canUsePrep(ctx.access) && (await db.prepEnabledSites()).includes(ctx.site.id);
  const prepOpen = prepOn ? await db.prepOutstanding(ctx.site.id) : [];
  const sent = prepOn ? (await db.prepHandovers(ctx.site.id, 2)).map((h) => h.submittedAt!) : [];
  const notesOpen = currentNotes(await db.handover(ctx.site.id), sent, Date.now()).filter((n) => n.needsAction);
  const toDo = [...prepOpen, ...notesOpen];
  const urgent = prepOpen.filter((e) => e.urgent).length + notesOpen.filter((n) => n.category === "Food safety").length;
  const unread = unreadFor(await db.teamNotices(0), ctx.person, date);
  const [kit, kitOpen] = await Promise.all([db.equipment(ctx.site.id), db.equipmentEvents({ siteId: ctx.site.id, openFaultsOnly: true })]);
  const now = Date.now();
  const siteTasks = await db.tasks({ siteIds: [ctx.site.id], closedSince: now - 10 * 60_000 });
  const myTasks = siteTasks.filter((t) => t.status === "open" && isForPerson(t, ctx.person)).sort(taskOrder(date));
  const justDone = siteTasks.filter((t) => t.status === "done" && t.doneBy === ctx.person.id);
  // Managers see today's team with their replies (late, can't make it) on the tablet.
  const team = ctx.isManager ? teamRowsView(await teamToday([ctx.site.id], now), now) : [];
  const away = team.filter((r) => r.alertUntil && now < r.alertUntil);
  // Ready to open shows until an hour after the ready time; the gas check from 15 minutes before close.
  // (All the site's checklists count, not just the ones this person's sections see.)
  const allRuns = ctx.isManager ? rows.map((r) => ({ name: r.l.name, due: r.l.due, signed: r.state === "done" })) : undefined;
  const [ready, gas] = await Promise.all([readyFor(ctx.site, now, undefined, allRuns), gasFor(ctx.site, now)]);
  const showReady = ready && ctx.site.readyBy && now < londonToUtc(date, ctx.site.readyBy) + 3_600_000;
  const down = kit.map((eq) => ({ eq, f: faultsOf(kitOpen.filter((e) => e.equipmentId === eq.id)).filter((x) => x.fault.severity === "down") }))
    .filter((x) => x.f.length).map(({ eq, f }) => ({ eq, since: Math.min(...f.map((x) => x.fault.createdAt)), body: f[f.length - 1].fault.body }));

  return (
    <>
      <TopBar ctx={ctx} />
      <main>
        <div className="row wrap" style={{ alignItems: "flex-end" }}>
          <div className="grow">
            <div className="eyebrow">{ctx.site.name} · {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" })}</div>
            <h1 className="h-display">Today&apos;s checks</h1>
          </div>
          <div className="card row" style={{ padding: "10px 16px" }}>
            <div className="stat">{done}<span style={{ fontSize: 20, color: "var(--ink-2)" }}>/{rows.length}</span></div>
            <div className="muted">signed off</div>
          </div>
        </div>

        <NoticeBanner notices={unread.map((n) => ({ id: n.id, title: n.title, body: n.body, important: n.important, from: n.createdByName,
          when: new Date(n.createdAt).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) }))} />
        {alerts.map((a) => (
          <div key={a.id} className={`alert ${a.level === "critical" ? "bad" : ""}`} role="status">
            <Icon name="alert" />
            <div className="grow"><div className="strong">{a.title}</div><div style={{ fontSize: 13 }}>{a.detail}</div></div>
          </div>
        ))}
        {down.map(({ eq, since, body }) => (
          <Link key={eq.id} href={`/equipment/${eq.id}`} className="alert bad" style={{ textDecoration: "none" }}>
            <Icon name="wrench" />
            <div className="grow"><div className="strong">Not working: {eq.name}</div><div style={{ fontSize: 13 }}>{body} · reported {sinceText(since, now)} ago</div></div>
          </Link>
        ))}
        {gas && gas.state !== "later" && gas.state !== "missed" && (
          <GasCheck siteId={ctx.site.id} siteName={ctx.site.name} state={gas.state} closeAt={londonHM(gas.day.closeAt)}
            done={gas.check ? `Checked by ${gas.check.personName} at ${londonHM(gas.check.createdAt)}${gas.check.onTablet ? " on the tablet" : " on their phone"}` : undefined} />
        )}
        {showReady && <ReadyLight r={ready} />}
        {away.map((r) => (
          <div key={r.shiftId} className={`alert ${r.status?.tone === "bad" ? "bad" : ""}`} role="status">
            <Icon name="clock" />
            <div className="grow"><div className="strong">{r.name}: {r.status?.text}</div><div style={{ fontSize: 13 }}>{r.time} · {r.section}</div></div>
          </div>
        ))}
        {(toDo.length > 0 || prepOn) && (
          <Link href={toDo.length || !prepOn ? "/handover" : "/handover/prep"} className={toDo.length ? "alert" : "list-btn"} style={{ textDecoration: "none" }}>
            <Icon name="handover" />
            <div className="grow">
              <div className="strong">{toDo.length ? `${toDo.length} handover item${toDo.length > 1 ? "s" : ""} to do` : "Shift handover"}</div>
              <div style={{ fontSize: 13 }}>{toDo.length ? (urgent ? `${urgent} urgent · ` : "") + "Open Handover and tick them off" : "Closing? Tap what the next shift needs to prep"}</div>
            </div>
          </Link>
        )}
        {(myTasks.length > 0 || justDone.length > 0) && (
          <section className="stack" aria-label="Tasks">
            <h2 className="h-sec">Tasks</h2>
            {myTasks.map((t) => {
              const due = dueText(t.dueOn, date);
              return (
                <div key={t.id} className="card stack" style={{ gap: 6 }}>
                  <div className="row wrap" style={{ gap: 6 }}>
                    <span className={`chip ${t.priority === 1 ? "bad" : t.priority === 2 ? "late" : t.priority === 3 ? "warn" : ""}`}>{priorityCode(t.priority)}</span>
                    <span className="strong grow" style={{ fontSize: 15 }}>{t.title}</span>
                    {t.dueOn && <span className={due.overdue ? "err" : "muted"} style={{ fontSize: 13 }}>{due.text}</span>}
                  </div>
                  {t.detail && <div className="muted" style={{ whiteSpace: "pre-wrap" }}>{t.detail}</div>}
                  <div className="muted" style={{ fontSize: 13 }}>{t.assigneeName ? `For ${t.assigneeName}` : t.section ? `For ${t.section}` : "For anyone on shift"} · from {t.createdByName}</div>
                  <TaskDone id={t.id} title={t.title} />
                </div>
              );
            })}
            {justDone.map((t) => (
              <div key={t.id} className="row wrap card" style={{ gap: 8, padding: "10px 14px" }}>
                <span className="chip done">Done</span><span className="grow">{t.title}</span><UndoTask id={t.id} />
              </div>
            ))}
          </section>
        )}
        {team.length > 0 && (
          <details className="card">
            <summary className="strong" style={{ cursor: "pointer" }}>Team today ({team.length})</summary>
            <TeamToday rows={team} />
          </details>
        )}
        {overdue.length > 0 && (
          <div className="alert">
            <Icon name="clock" />
            <div className="grow"><div className="strong">{overdue.length} checklist{overdue.length > 1 ? "s" : ""} overdue</div><div style={{ fontSize: 13 }}>{overdue.map((r) => r.l.name).join(" · ")}</div></div>
            <Link className="btn accent small" href={`/run/${overdue[0].l.id}`}>Start</Link>
          </div>
        )}

        {GROUPS.map(([area, label]) => {
          const g = rows.filter((r) => r.l.area === area);
          if (!g.length) return null;
          return (
            <section key={area} className="stack" aria-label={label}>
              <h2 className="h-sec">{label}</h2>
              {g.map(({ l, p, state }) => (
                <Link key={l.id} href={`/run/${l.id}`} className="list-btn">
                  <span className={`ring ${state}`}>{state === "done" ? "✓" : `${p.answered}/${p.total}`}</span>
                  <span className="grow">
                    <span className="strong" style={{ display: "block" }}>{l.name}{l.suggested && <> <span className="chip warn">new</span></>}</span>
                    <span className="muted">{l.when} · {l.items.length} checks</span>
                  </span>
                  <span className={`chip ${CHIP[state]}`}>{LABEL[state] || (l.due ? `Due ${l.due}` : l.when)}</span>
                </Link>
              ))}
            </section>
          );
        })}
        <Link href="/equipment" className="list-btn" style={{ textDecoration: "none" }}>
          <Icon name="wrench" />
          <span className="grow"><span className="strong" style={{ display: "block" }}>Equipment</span><span className="muted">Something not working? Report it here</span></span>
        </Link>
        <div className="foot-links"><Link href="/me">My shifts</Link><Link href="/pin">Change my PIN</Link></div>
      </main>
      <BottomNav ctx={ctx} current="today" />
    </>
  );
}
