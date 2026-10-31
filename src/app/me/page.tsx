import Link from "next/link";
import { redirect } from "next/navigation";
import { PhoneTopBar, TopBar } from "@/components/Chrome";
import { store } from "@/lib/data";
import { addDays, londonDate, shortDay } from "@/lib/domain/time";
import { current } from "@/lib/session";
import { vapidKeys } from "@/lib/push";
import { RemindersToggle } from "./RemindersToggle";
import { CleaningBoard } from "@/components/CleaningBoard";
import { boardRows, cleaningBoards } from "@/lib/cleaning-service";
import { TimeOffCard } from "./TimeOffCard";
import { canCancel, kindLabel, rangeLabel } from "@/lib/domain/timeoff";
import { NoticeBanner } from "@/components/NoticeBanner";
import { inAudience, isLive, unreadFor } from "@/lib/domain/notices";
import { certStatus, expectedKinds, statusText, visibleTypes } from "@/lib/domain/certificates";
import { CHIP } from "@/app/manage/certificates/cells";
import { dueText, isForPerson, priorityCode, taskOrder } from "@/lib/domain/tasks";
import { TaskDone } from "@/components/TaskDone";
import { canSayOnMyWay, latestReplies, replyOpen, replyText, sectionName, type ShiftReply as Reply } from "@/lib/domain/reminders";
import { ShiftReply } from "./ShiftReply";
import { GasCheck } from "@/components/GasCheck";
import { CoverAsk, type MyCover } from "./CoverAsk";
import { CoverOffers } from "./CoverOffers";
import { couldCover } from "@/lib/cover-service";
import { coverState } from "@/lib/domain/cover";
import { shiftStart } from "@/lib/domain/reminders";
import { gasFor } from "@/lib/daily-service";
import { londonHM } from "@/lib/domain/time";
import { MustRead } from "@/components/MustRead";
import { TrainingDue } from "@/components/TrainingDue";
import { myTraining } from "@/lib/training-service";
import { allergenChangesToConfirm, sopsToRead } from "@/lib/library-service";
import { forYouAt } from "@/lib/handover-service";
import { phoneHandoverSites } from "@/lib/domain/handover";
import { askedWeek, asksAvailability, latestAvailability } from "@/lib/domain/availability";
import { AvailabilityCard } from "@/components/AvailabilityCard";

export const dynamic = "force-dynamic";
const when = (t: number) => new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

export default async function MyShifts() {
  const ctx = await current();
  if (!ctx) redirect("/login");
  if (ctx.person.pinMustChange) redirect("/pin");
  const db = store();
  const today = londonDate(Date.now());
  const shifts = (await db.shiftsForPerson(ctx.person.id, today, addDays(today, 27))).filter((s) => s.published && !s.cancelled);
  // Shift reminders and the evening-before list are only useful until the shift: older ones drop off, so they don't
  // push rota changes, time off decisions and certificate warnings out of the list.
  const now = Date.now();
  const notices = (await db.notices(ctx.person.id, 60))
    .filter((n) => n.kind !== "notice" && !(n.kind === "shift" && n.createdAt < now - 18 * 3_600_000) && !(n.kind === "evening" && n.createdAt < now - 36 * 3_600_000))
    .slice(0, 15);
  const teamNotices = await db.teamNotices(0);
  const unread = unreadFor(teamNotices, ctx.person, today);
  const myTimeOff = (await db.timeOff({ personId: ctx.person.id, from: addDays(today, -60) })).filter((t) => t.status !== "cancelled" || t.endsOn >= today);
  const readLive = teamNotices.filter((n) => isLive(n, today) && inAudience(n, ctx.person) && !unread.includes(n));
  const myCerts = await db.certificates({ personIds: [ctx.person.id] });
  const expectedCerts = new Set(expectedKinds(ctx.person));
  const certRows = visibleTypes(false).filter((t) => expectedCerts.has(t.id) || myCerts.some((c) => c.kind === t.id))
    .map((t) => ({ t, s: certStatus(myCerts, t.id, expectedCerts.has(t.id), today) }));
  const myTasks = (await db.tasks({ siteIds: ctx.person.access.map((a) => a.siteId) })).filter((t) => isForPerson(t, ctx.person)).sort(taskOrder(today));
  const session = await db.session(ctx.sessionId);
  const onTablet = !!session?.deviceId;
  const publicKey = onTablet ? "" : (await vapidKeys()).publicKey;

  const replyable = shifts.filter((s) => replyOpen(s, now));
  const replies = replyable.length ? latestReplies(await db.shiftReplies(replyable.map((s) => s.id))) : new Map<string, Reply>();
  const TONE = { on_my_way: "done", late: "late", cant_make_it: "bad" } as const;
  // The gas check at close, for the people on until the end (closers) at a site where it's due now.
  const recentSites = Array.from(new Set((await db.shiftsForPerson(ctx.person.id, addDays(today, -1), today)).filter((s) => s.published && !s.cancelled).map((s) => s.siteId)));
  const allSites = await db.sites();
  const gasCards = (await Promise.all(recentSites.map(async (id) => {
    const site = allSites.find((x) => x.id === id);
    const g = site ? await gasFor(site, now) : undefined;
    return site && g && (g.state === "due" || g.state === "overdue" || g.state === "done") && g.day.closers.includes(ctx.person.id) ? { site, g } : undefined;
  }))).filter((x) => x !== undefined).filter((x) => !onTablet || x.site.id === ctx.site.id); // a tablet only does its own site

  // The cleaning board for where they work (on a phone, read-only; on the tablet, its own site).
  const cleanSites = allSites.filter((s) => s.status === "open" && (onTablet ? s.id === ctx.site.id : ctx.person.access.some((a) => a.siteId === s.id)));
  const cleaning = await cleaningBoards(db, cleanSites.map((s) => s.id), now);

  // Shift cover: my latest request for each upcoming shift, and colleagues' shifts I could cover.
  const myCover = new Map<string, MyCover>();
  for (const r of await db.coverRequests({ personId: ctx.person.id, shiftEndsAfter: now })) { // newest first
    if (myCover.has(r.shiftId)) continue;
    const state = coverState(r, now);
    myCover.set(r.shiftId, { id: r.id, state: state === "open" || state === "approved" || state === "done" || state === "declined" || state === "cancelled" ? state : "none",
      offers: r.offers.filter((o) => !o.withdrawnAt).length, coveredByName: r.coveredByName, note: r.status === "cancelled" ? r.cancelNote : r.decisionNote });
  }
  const canCoverRows = (await couldCover(ctx.person, now)).map((r) => ({
    id: r.id, who: `${r.personName} is asking`, when: `${shortDay(r.date)} · ${r.start}–${r.end}`, where: `${r.siteName} · ${sectionName(r.section)}`,
    offered: r.offers.some((o) => o.personId === ctx.person.id && !o.withdrawnAt),
  }));

  const [toRead, allergenChanges, training, forMe] = await Promise.all([
    sopsToRead(ctx.person, db), allergenChangesToConfirm(ctx.person, db), myTraining(ctx.person, allSites, db), forYouAt(ctx.person, allSites, db),
  ]);
  // Managers on their own phone can read the handover (read-only) at the open sites they manage.
  const readsHandover = ctx.scope === "shifts" && phoneHandoverSites(ctx.person, allSites).length > 0;

  // Next week's availability: asked of staff and managers, due by the end of Thursday.
  const availWeek = askedWeek(now);
  const availAsked = asksAvailability(ctx.person, allSites);
  const myAvail = availAsked ? latestAvailability(await db.myAvailability(ctx.person.id, [availWeek])).get(ctx.person.id) : undefined;

  const days = new Map<string, typeof shifts>();
  for (const s of shifts) days.set(s.date, [...(days.get(s.date) ?? []), s]);

  return (
    <>
      {ctx.scope === "full"
        ? <TopBar ctx={ctx} title="My shifts" eyebrow="Next 4 weeks · published rotas only" back="/" />
        : <PhoneTopBar ctx={ctx} title="My shifts" eyebrow="Next 4 weeks · published rotas only" home />}
      <main style={{ paddingBottom: 40 }}>
        <div className="stack" style={{ gap: 10 }}>
          <nav className="row wrap" aria-label="More" style={{ gap: 8 }}>
            {readsHandover && <Link className="btn ghost small" href="/handover">Handover</Link>}
            <Link className="btn ghost small" href="/library">SOPs</Link>
            <Link className="btn ghost small" href="/library/allergens">Allergens</Link>
            {training.rows.length > 0 && <Link className="btn ghost small" href="/library/training">Training</Link>}
            <Link className="btn ghost small" href="/rota">Team rota</Link>
            <Link className="btn ghost small" href="/stock">Stock</Link>
          </nav>
        </div>

        <NoticeBanner notices={unread.map((n) => ({ id: n.id, title: n.title, body: n.body, important: n.important, from: n.createdByName, when: when(n.createdAt) }))} />
        <MustRead docs={toRead} allergens={allergenChanges} />
        <TrainingDue overdue={training.tally.overdue} again={training.tally.again} />

        {availAsked && <AvailabilityCard week={availWeek} sent={!!myAvail} now={now} />}

        {cleanSites.filter((s) => cleaning.has(s.id)).map((s) => (
          <CleaningBoard key={s.id} site={s.name} rows={boardRows(cleaning.get(s.id)!, ctx.person.id)} canAct={onTablet} compact={!onTablet ? false : true} />
        ))}

        {gasCards.map(({ site, g }) => (
          <GasCheck key={site.id} siteId={site.id} siteName={site.name} state={g.state as "due" | "overdue" | "done"} closeAt={londonHM(g.day.closeAt)} needsPin={onTablet}
            done={g.check ? `Checked by ${g.check.personName} at ${londonHM(g.check.createdAt)}` : undefined} />
        ))}

        {forMe.length > 0 && (
          <section className="card stack" aria-label="For you" style={{ gap: 8 }}>
            <h2 className="h-sec">For you</h2>
            {forMe.map(({ site, items }) => (
              <div key={site.id} className="stack" style={{ gap: 4 }}>
                {forMe.length > 1 && <div className="strong">{site.name}</div>}
                <ul className="for-you">
                  {items.map((i, n) => (
                    <li key={n}>{i.urgent && <span className="chip bad">Urgent</span>} {i.text}{i.onTablet && <span className="muted"> · read it on the tablet</span>}</li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="muted" style={{ fontSize: 13 }}>From the handover{forMe.length === 1 ? ` at ${forMe[0].site.name}` : ""}. Tick them off on the tablet when they&apos;re done.</div>
          </section>
        )}

        {!onTablet && <RemindersToggle publicKey={publicKey} />}

        <CoverOffers rows={canCoverRows} />

        <section className="stack">
          {shifts.length === 0 && <div className="card muted">No published shifts in the next 4 weeks. New rotas show here as soon as they&apos;re published.</div>}
          {Array.from(days.entries()).map(([date, list]) => (
            <div key={date} className={`card row shift ${date === today ? "today" : ""}`}>
              <div className="shift-day">
                <div className="strong">{date === today ? "Today" : date === addDays(today, 1) ? "Tomorrow" : shortDay(date).split(" ")[0]}</div>
                <div className="muted">{shortDay(date).split(" ").slice(1).join(" ")}</div>
              </div>
              <div className="grow stack" style={{ gap: 4 }}>
                {list.map((s) => {
                  const r = replies.get(s.id);
                  return (
                    <div key={s.id}><span className="stat" style={{ fontSize: 24 }}>{s.start}–{s.end}</span>
                      <div className="muted">{s.siteName} · {sectionName(s.section)}</div>
                      {replyOpen(s, now) && <ShiftReply shiftId={s.id} started={!canSayOnMyWay(s, now)} current={r ? { text: replyText(r), tone: TONE[r.kind] } : undefined} />}
                      {now < shiftStart(s) && <CoverAsk shiftId={s.id} cover={myCover.get(s.id)} />}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        {myTasks.length > 0 && (
          <section className="card stack" aria-label="My tasks" style={{ gap: 10 }}>
            <h2 className="h-sec">My tasks</h2>
            {myTasks.map((t) => (
              <div key={t.id} className="stack timeoff-row" style={{ gap: 6 }}>
                <div className="row wrap" style={{ gap: 6 }}>
                  <span className={`chip ${t.priority === 1 ? "bad" : t.priority === 2 ? "late" : t.priority === 3 ? "warn" : ""}`}>{priorityCode(t.priority)}</span>
                  <span className="strong grow" style={{ fontSize: 15 }}>{t.title}</span>
                  {t.dueOn && <span className={dueText(t.dueOn, today).overdue ? "err" : "muted"} style={{ fontSize: 13 }}>{dueText(t.dueOn, today).text}</span>}
                </div>
                {t.detail && <div className="muted" style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{t.detail}</div>}
                <TaskDone id={t.id} title={t.title} />
              </div>
            ))}
          </section>
        )}

        <TimeOffCard today={today} shiftDays={shifts.map((s) => s.date)} decider={ctx.isOps ? "the owner" : "your manager"} requests={myTimeOff.map((t) => ({
          id: t.id, range: rangeLabel(t), kind: kindLabel(t.kind), status: t.status, note: t.note, canCancel: canCancel(t, today),
          decision: t.decidedByName ? `${t.status === "approved" ? "approved" : "declined"} by ${t.decidedByName}${t.decisionNote ? `: "${t.decisionNote}"` : ""}` : undefined,
        }))} />

        {certRows.length > 0 && (
          <section className="card stack" aria-label="My certificates" style={{ gap: 8 }}>
            <h2 className="h-sec">My certificates</h2>
            {certRows.map(({ t, s }) => (
              <div key={t.id} className="row wrap" style={{ gap: 8 }}>
                <span className="grow strong" style={{ fontSize: 15 }}>{t.label}</span>
                <span className={`chip ${CHIP[s.status]}`}>{statusText(t.id, s, today)}</span>
              </div>
            ))}
            <div className="muted" style={{ fontSize: 13 }}>Done a course or got a new certificate? Show it to your manager and they&apos;ll add it. You&apos;ll get a message before one runs out.</div>
          </section>
        )}

        {readLive.length > 0 && (
          <details className="card">
            <summary className="strong" style={{ cursor: "pointer" }}>Team notices ({readLive.length})</summary>
            <div className="stack" style={{ marginTop: 10 }}>
              {readLive.map((n) => (
                <div key={n.id} className="stack" style={{ gap: 2 }}>
                  <div className="row"><span className="strong grow">{n.title}</span><span className="muted">{when(n.createdAt)}</span></div>
                  <div style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{n.body}</div>
                </div>
              ))}
            </div>
          </details>
        )}

        <section className="stack">
          <h2 className="h-sec">Messages</h2>
          {notices.length === 0 && <div className="card muted">Rota messages appear here too, even if notifications are off.</div>}
          {notices.map((n) => (
            <div key={n.id} className="card stack" style={{ gap: 4 }}>
              <div className="row"><span className="strong grow">{n.title}</span><span className="muted">{when(n.createdAt)}</span></div>
              <div style={{ whiteSpace: "pre-line", fontSize: 14 }}>{n.body}</div>
              {n.url && n.url !== "/me" && (ctx.scope === "full" || n.url.startsWith("/equipment/")) && <div><Link className="btn ghost small" href={n.url}>Open</Link></div>}
            </div>
          ))}
        </section>
        <div className="foot-links"><Link href="/pin">Change my PIN</Link></div>
      </main>
    </>
  );
}
