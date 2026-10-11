import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/actions";
import { store } from "@/lib/data";
import { addDays, londonDate, shortDay } from "@/lib/domain/time";
import { current } from "@/lib/session";
import { vapidKeys } from "@/lib/push";
import { RemindersToggle } from "./RemindersToggle";
import { TimeOffCard } from "./TimeOffCard";
import { canCancel, kindLabel, rangeLabel } from "@/lib/domain/timeoff";
import { NoticeBanner } from "@/components/NoticeBanner";
import { inAudience, isLive, unreadFor } from "@/lib/domain/notices";
import { certStatus, expectedKinds, statusText, visibleTypes } from "@/lib/domain/certificates";
import { CHIP } from "@/app/manage/certificates/cells";

export const dynamic = "force-dynamic";
const when = (t: number) => new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

export default async function MyShifts() {
  const ctx = await current();
  if (!ctx) redirect("/login");
  if (ctx.person.pinMustChange) redirect("/pin");
  const db = store();
  const today = londonDate(Date.now());
  const shifts = (await db.shiftsForPerson(ctx.person.id, today, addDays(today, 27))).filter((s) => s.published && !s.cancelled);
  const notices = (await db.notices(ctx.person.id, 25)).filter((n) => n.kind !== "notice").slice(0, 15);
  const teamNotices = await db.teamNotices(0);
  const unread = unreadFor(teamNotices, ctx.person, today);
  const myTimeOff = (await db.timeOff({ personId: ctx.person.id, from: addDays(today, -60) })).filter((t) => t.status !== "cancelled" || t.endsOn >= today);
  const readLive = teamNotices.filter((n) => isLive(n, today) && inAudience(n, ctx.person) && !unread.includes(n));
  const myCerts = await db.certificates({ personIds: [ctx.person.id] });
  const expectedCerts = new Set(expectedKinds(ctx.person));
  const certRows = visibleTypes(false).filter((t) => expectedCerts.has(t.id) || myCerts.some((c) => c.kind === t.id))
    .map((t) => ({ t, s: certStatus(myCerts, t.id, expectedCerts.has(t.id), today) }));
  const session = await db.session(ctx.sessionId);
  const onTablet = !!session?.deviceId;
  const publicKey = onTablet ? "" : (await vapidKeys()).publicKey;

  const days = new Map<string, typeof shifts>();
  for (const s of shifts) days.set(s.date, [...(days.get(s.date) ?? []), s]);

  return (
    <>
      <header className="top">
        <div className="logo">PHO &amp; CO</div>
        <div className="who">
          <span>{ctx.person.name}</span>
          {ctx.scope === "full" && <Link className="pill-btn" href="/">Back</Link>}
          <form action={signOut}><button className="pill-btn" type="submit">Sign out</button></form>
        </div>
      </header>
      <main style={{ paddingBottom: 40 }}>
        <div className="row wrap" style={{ alignItems: "flex-end" }}>
          <div className="grow"><div className="eyebrow">Next 4 weeks · published rotas only</div><h1 className="h-display">My shifts</h1></div>
          <Link className="btn ghost small" href="/rota">Team rota</Link>
        </div>

        <NoticeBanner notices={unread.map((n) => ({ id: n.id, title: n.title, body: n.body, important: n.important, from: n.createdByName, when: when(n.createdAt) }))} />

        {!onTablet && <RemindersToggle publicKey={publicKey} />}

        <section className="stack">
          {shifts.length === 0 && <div className="card muted">No published shifts in the next 4 weeks. New rotas show here as soon as they&apos;re published.</div>}
          {Array.from(days.entries()).map(([date, list]) => (
            <div key={date} className={`card row shift ${date === today ? "today" : ""}`}>
              <div className="shift-day">
                <div className="strong">{date === today ? "Today" : date === addDays(today, 1) ? "Tomorrow" : shortDay(date).split(" ")[0]}</div>
                <div className="muted">{shortDay(date).split(" ").slice(1).join(" ")}</div>
              </div>
              <div className="grow stack" style={{ gap: 4 }}>
                {list.map((s) => (
                  <div key={s.id}><span className="stat" style={{ fontSize: 24 }}>{s.start}–{s.end}</span>
                    <div className="muted">{s.siteName} · {s.section === "FOH" ? "Front of house" : s.section === "BOH" ? "Back of house" : s.section}</div></div>
                ))}
              </div>
            </div>
          ))}
        </section>

        <TimeOffCard today={today} shiftDays={shifts.map((s) => s.date)} requests={myTimeOff.map((t) => ({
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
            </div>
          ))}
        </section>
        <div className="foot-links"><Link href="/pin">Change my PIN</Link></div>
      </main>
    </>
  );
}
