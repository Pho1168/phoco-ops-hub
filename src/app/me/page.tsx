import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/actions";
import { store } from "@/lib/data";
import { addDays, londonDate, shortDay } from "@/lib/domain/time";
import { current } from "@/lib/session";
import { vapidKeys } from "@/lib/push";
import { RemindersToggle } from "./RemindersToggle";

export const dynamic = "force-dynamic";
const when = (t: number) => new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

export default async function MyShifts() {
  const ctx = await current();
  if (!ctx) redirect("/login");
  if (ctx.person.pinMustChange) redirect("/pin");
  const db = store();
  const today = londonDate(Date.now());
  const shifts = (await db.shiftsForPerson(ctx.person.id, today, addDays(today, 27))).filter((s) => s.published && !s.cancelled);
  const notices = await db.notices(ctx.person.id, 15);
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
        <div><div className="eyebrow">Next 4 weeks · published rotas only</div><h1 className="h-display">My shifts</h1></div>

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

        <section className="stack">
          <h2 className="h-sec">Messages</h2>
          {notices.length === 0 && <div className="card muted">Rota messages appear here too, even if notifications are off.</div>}
          {notices.map((n) => (
            <div key={n.id} className="card stack" style={{ gap: 4 }}>
              <div className="row"><span className="strong grow">{n.title}</span><span className="muted">{when(n.sendAfter)}</span></div>
              <div style={{ whiteSpace: "pre-line", fontSize: 14 }}>{n.body}</div>
            </div>
          ))}
        </section>
        <div className="foot-links"><Link href="/pin">Change my PIN</Link></div>
      </main>
    </>
  );
}
