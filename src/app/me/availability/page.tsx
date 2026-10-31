import Link from "next/link";
import { redirect } from "next/navigation";
import { PhoneTopBar, TopBar } from "@/components/Chrome";
import { store } from "@/lib/data";
import { askedWeek, asksAvailability, dueDay, isLate, latestAvailability, weekDays } from "@/lib/domain/availability";
import { addDays, longDay, shortDay } from "@/lib/domain/time";
import { current } from "@/lib/session";
import { AvailabilityForm } from "./AvailabilityForm";

export const dynamic = "force-dynamic";
const when = (t: number) => new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

/** Staff say when they can work in the week ahead (or the one after), on their own phone or the tablet. */
export default async function MyAvailability(props: { searchParams: Promise<{ week?: string }> }) {
  const ctx = await current();
  if (!ctx) redirect("/login");
  if (ctx.person.pinMustChange) redirect("/pin");
  const db = store();
  const now = Date.now();
  const next = askedWeek(now);
  const after = addDays(next, 7);
  const week = (await props.searchParams).week === after ? after : next;
  const asked = asksAvailability(ctx.person, await db.sites());
  const mine = latestAvailability(await db.myAvailability(ctx.person.id, [week])).get(ctx.person.id);
  const Bar = ctx.scope === "full" ? TopBar : PhoneTopBar;
  const late = week === next && !mine && isLate(week, now);
  return (
    <>
      <Bar ctx={ctx} title="Availability" eyebrow={`Week of ${shortDay(week)}`} back="/me" />
      <main className="stack" style={{ paddingBottom: 40 }}>
        {!asked ? (
          <div className="card muted">Your availability isn&apos;t asked for here.</div>
        ) : (
          <>
            <nav className="seg sm-seg" role="group" aria-label="Week">
              <Link href="/me/availability" aria-current={week === next ? "page" : undefined} className={week === next ? "sm-seg-on" : ""}>Next week</Link>
              <Link href={`/me/availability?week=${after}`} aria-current={week === after ? "page" : undefined} className={week === after ? "sm-seg-on" : ""}>Week after</Link>
            </nav>
            <div className={`card stack${late ? " avail-late" : ""}`} style={{ gap: 4 }}>
              <div className="strong">When can you work the week of {longDay(week)}?</div>
              <div className="muted" style={{ fontSize: 14 }}>
                {week === next ? <>Due by the end of {longDay(dueDay(week))}, so the rota can be written. </> : null}
                Morning is up to 15:00, evening from then on. Add a note if only part of a shift works for you.
              </div>
              {mine && <div className="chip done" style={{ alignSelf: "flex-start" }}>Sent {when(mine.createdAt)}{isLate(week, mine.createdAt) ? " (late)" : ""}</div>}
              {mine && (isLate(week, now)
                ? <div className="alert" role="note" style={{ fontSize: 14 }}><span>It&apos;s past the deadline, so the rota is being written from this. You can still add more time (an Off day to a shift, or a shift to All day), but not take any away. To take a day off, <Link href="/me">request time off</Link> or ask your manager.</span></div>
                : <div className="muted" style={{ fontSize: 14 }}>You can change anything until the end of {longDay(dueDay(week))}. After that you can only add more time.</div>)}
              {late && <div className="chip late" style={{ alignSelf: "flex-start" }}>Overdue: please send it now</div>}
            </div>
            <AvailabilityForm week={week} days={weekDays(week).map((d) => ({ date: d, label: shortDay(d) }))} current={mine?.days} locked={!!mine && isLate(week, now)} />
          </>
        )}
      </main>
    </>
  );
}
