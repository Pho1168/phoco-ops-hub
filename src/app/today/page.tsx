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
import { readyHeadline, readyShownUntil } from "@/lib/domain/daily";
import { londonHM } from "@/lib/domain/time";
import { MustRead } from "@/components/MustRead";
import { TrainingDue } from "@/components/TrainingDue";
import { myTraining } from "@/lib/training-service";
import { allergenChangesToConfirm, sopsToRead } from "@/lib/library-service";

export const dynamic = "force-dynamic";

const STATE = { done: "done", overdue: "late", in_progress: "now", not_started: "" } as const;
const GROUPS = [["FOH", "Front of house"], ["BOH", "Back of house"], ["PROD", "Production"]] as const;

/** Everything at the site today: the checks by area, the team, and what needs attention. Shift Mode is the home; this is the whole picture. */
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
  const onTablet = !!(await db.session(ctx.sessionId))?.deviceId;
  // Managers see today's team with their replies (late, can't make it) on the tablet.
  const team = ctx.isManager ? teamRowsView(await teamToday([ctx.site.id], now), now) : [];
  const away = team.filter((r) => r.alertUntil && now < r.alertUntil);
  // Ready to open shows until an hour after the ready time (all the site's checklists count, not just the ones this
  // person's sections see; staff aren't shown who's late or not coming). The gas check from 15 minutes before close.
  const readyShown = !!ctx.site.readyBy && now < readyShownUntil(date, ctx.site.readyBy);
  const readyLists = async () => {
    const seen = new Map(rows.map((r) => [r.l.id, r.state === "done"]));
    const others = all.filter((l) => !seen.has(l.id));
    const runs = await Promise.all(others.map((l) => db.run(l.id, date)));
    others.forEach((l, i) => seen.set(l.id, !!runs[i].signedAt));
    return all.map((l) => ({ name: l.name, due: l.due, signed: seen.get(l.id)! }));
  };
  const [ready, gas, toRead, allergenChanges, training] = await Promise.all([
    readyShown ? readyLists().then((lists) => readyFor(ctx.site, now, db, { lists, kit, openFaults: kitOpen, alerts }, { forStaff: !ctx.isManager })) : undefined,
    gasFor(ctx.site, now, db),
    sopsToRead(ctx.person, db),
    allergenChangesToConfirm(ctx.person, db),
    db.sites().then((sites) => myTraining(ctx.person, sites, db)),
  ]);
  const showReady = readyShown && ready;
  const faults = faultsOf(kitOpen).filter((f) => kit.some((eq) => eq.id === f.fault.equipmentId));
  const down = kit.map((eq) => ({ eq, f: faults.filter((x) => x.fault.equipmentId === eq.id && x.fault.severity === "down") }))
    .filter((x) => x.f.length).map(({ eq, f }) => ({ eq, since: Math.min(...f.map((x) => x.fault.createdAt)), body: f[f.length - 1].fault.body }));
  const groups = GROUPS.map(([area, label]) => ({ area, label, rows: rows.filter((r) => r.l.area === area) })).filter((g) => g.rows.length);
  const bannerCount = alerts.length + down.length + away.length + (gas && gas.state !== "later" && gas.state !== "missed" ? 1 : 0) + (showReady ? 1 : 0);

  return (
    <>
      <TopBar ctx={ctx} title={`Today at ${ctx.site.name}`}>
        <Link className="pill-btn top-extra" href="/shift">← My shift</Link>
      </TopBar>
      <main className="wide">
        <NoticeBanner notices={unread.map((n) => ({ id: n.id, title: n.title, body: n.body, important: n.important, from: n.createdByName,
          when: new Date(n.createdAt).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) }))} />

        <section className="sm-kpis" aria-label="Today in numbers">
          <div className={`card sm-kpi ${overdue.length ? "urgent" : ""}`}>
            <span className="eyebrow">Checks signed</span>
            <span className="stat">{done}<span className="sm-kpi-of">/{rows.length}</span></span>
            <span className="muted">{overdue.length ? `${overdue.length} overdue` : rows.length ? "none overdue" : "nothing due today"}</span>
          </div>
          <div className={`card sm-kpi ${showReady && ready.light !== "green" ? "warn" : ""}`}>
            <span className="eyebrow">Ready to open</span>
            <span className="stat kpi-dot">{showReady ? <><span className={`light ${ready.light}`} aria-hidden />{ready.signed}<span className="sm-kpi-of">/{ready.total}</span></> : "—"}</span>
            <span className="muted">{showReady ? readyHeadline(ready) : ctx.site.readyBy ? `opening checks count towards ${ctx.site.readyBy}` : "no ready time set"}</span>
          </div>
          <Link href="/handover" className={`card sm-kpi ${urgent ? "warn" : ""}`}>
            <span className="eyebrow">Handover</span>
            <span className="stat">{toDo.length}</span>
            <span className="muted">{toDo.length ? `${notesOpen.length} note${notesOpen.length === 1 ? "" : "s"} need action · ${prepOpen.length} prep to do${urgent ? ` · ${urgent} urgent` : ""}` : "nothing outstanding"}</span>
          </Link>
          <Link href="/equipment" className={`card sm-kpi ${down.length ? "urgent" : ""}`}>
            <span className="eyebrow">Kit</span>
            <span className="stat">{faults.length}</span>
            <span className="muted">{down.length ? `not working: ${down.map((d) => d.eq.name).join(", ")}` : faults.length ? `fault${faults.length > 1 ? "s" : ""} open, still working` : "all working"}</span>
          </Link>
        </section>

        {bannerCount > 0 && (
          <section className="stack" aria-label="Right now">
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
              <GasCheck siteId={ctx.site.id} siteName={ctx.site.name} state={gas.state} closeAt={londonHM(gas.day.closeAt)} needsPin={onTablet}
                done={gas.check ? `Checked by ${gas.check.personName} at ${londonHM(gas.check.createdAt)}${gas.check.onTablet ? " on the tablet" : " on their phone"}` : undefined} />
            )}
            {showReady && ready.light !== "green" && <ReadyLight r={ready} />}
            {away.map((r) => (
              <div key={r.shiftId} className={`alert ${r.status?.tone === "bad" ? "bad" : ""}`} role="status">
                <Icon name="clock" />
                <div className="grow"><div className="strong">{r.name}: {r.status?.text}</div><div style={{ fontSize: 13 }}>{r.time} · {r.section}</div></div>
              </div>
            ))}
          </section>
        )}

        <div className="cols two">
          <div className={`cols areas ${groups.length === 1 ? "one" : ""}`}>
            {groups.map((g) => {
              const signed = g.rows.filter((r) => r.state === "done").length;
              const late = g.rows.filter((r) => r.state === "overdue").length;
              return (
                <section key={g.area} className="stack" aria-label={g.label} style={{ gap: 8 }}>
                  <h2 className="grp-h">{g.label} <span>{signed} of {g.rows.length} signed{late ? ` · ${late} late` : ""}</span></h2>
                  {g.rows.map(({ l, p, state }) => (
                    <Link key={l.id} href={`/run/${l.id}`} className={`sm-item sm-row ${STATE[state]}`}>
                      <span className={`sm-state ${STATE[state]}`}>{state === "done" ? "✓" : l.due ?? <Icon name="rota" />}</span>
                      <span className="grow">
                        <span className="strong" style={{ display: "block", fontSize: 15 }}>{l.name}{l.suggested && <span className="chip warn">new</span>}</span>
                        <span className="muted">{l.when} · {l.items.length} checks</span>
                      </span>
                      <span className={`ring ${state}`}>{state === "done" ? "✓" : `${p.answered}/${p.total}`}</span>
                    </Link>
                  ))}
                </section>
              );
            })}
            {groups.length === 0 && <div className="card muted">No checklists for your sections at {ctx.site.name} yet.</div>}
          </div>

          <aside className="aside panel">
            {(myTasks.length > 0 || justDone.length > 0) && (
              <section className="stack" aria-label="Tasks" style={{ gap: 8 }}>
                <h2 className="grp-h">My tasks <span>{myTasks.length}</span></h2>
                {myTasks.map((t) => {
                  const due = dueText(t.dueOn, date);
                  return (
                    <div key={t.id} className="card stack" style={{ gap: 6 }}>
                      <div className="row wrap" style={{ gap: 6 }}>
                        <span className={`chip ${t.priority === 1 ? "bad" : t.priority === 2 ? "late" : t.priority === 3 ? "warn" : ""}`}>{priorityCode(t.priority)}</span>
                        <span className="strong grow" style={{ fontSize: 15 }}>{t.title}</span>
                        {t.dueOn && <span className={due.overdue ? "err-text" : "muted"} style={{ fontSize: 13 }}>{due.text}</span>}
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
            {(toRead.length > 0 || allergenChanges.length > 0 || training.tally.overdue > 0 || training.tally.again > 0) && (
              <section className="stack" aria-label="Needs attention" style={{ gap: 8 }}>
                <h2 className="grp-h">Needs attention</h2>
                <MustRead docs={toRead} allergens={allergenChanges} />
                <TrainingDue overdue={training.tally.overdue} again={training.tally.again} />
              </section>
            )}
            {team.length > 0 && (
              <section className="card stack" aria-label="Team today" style={{ gap: 8 }}>
                <div className="row"><h2 className="h-sec grow" style={{ fontSize: 17 }}>Team today</h2><span className="muted">{team.length} on the rota</span></div>
                <TeamToday rows={team} />
              </section>
            )}
            {(toDo.length > 0 || prepOn) && (
              <Link href={toDo.length || !prepOn ? "/handover" : "/handover/prep"} className={toDo.length ? "alert" : "cta-dark"} style={{ textDecoration: "none" }}>
                <Icon name="handover" />
                <div className="grow">
                  <div className="strong">{toDo.length ? `${toDo.length} handover item${toDo.length > 1 ? "s" : ""} to do` : "Closing up? Start the prep handover"}</div>
                  <div style={{ fontSize: 13, opacity: .9 }}>{toDo.length ? (urgent ? `${urgent} urgent · ` : "") + "Open Handover and tick them off" : "Tap what the next shift needs to prep, then send"}</div>
                </div>
              </Link>
            )}
            <Link href="/equipment" className="list-btn" style={{ textDecoration: "none" }}>
              <Icon name="wrench" />
              <span className="grow"><span className="strong" style={{ display: "block" }}>Equipment</span><span className="muted">Something not working? Report it here</span></span>
            </Link>
            <div className="foot-links"><Link href="/me">My shifts</Link><Link href="/pin">Change my PIN</Link></div>
          </aside>
        </div>
      </main>
      <BottomNav ctx={ctx} current="today" />
    </>
  );
}
