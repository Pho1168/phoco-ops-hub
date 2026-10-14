import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/actions";
import { BottomNav, TopBar } from "@/components/Chrome";
import { Icon } from "@/components/Icon";
import { store } from "@/lib/data";
import { LANES, laneName, windowLabel, type Lane } from "@/lib/domain/shift-mode";
import { londonDate, londonHM, shortDay } from "@/lib/domain/time";
import { current } from "@/lib/session";
import { myShift, siteLaneIds, siteLanes, type ShiftView } from "@/lib/shift-service";
import { ShiftReply } from "@/app/me/ShiftReply";
import { DayStrip, FirstUp, LaneTitle, OnShift, ShiftList, Summary } from "./parts";

export const dynamic = "force-dynamic";

const isLane = (s: unknown): s is Lane => typeof s === "string" && (LANES as string[]).includes(s);
const dayLabel = (date: string, today: string) => (date === today ? "Today" : shortDay(date));

/**
 * Shift Mode: your role + your shift = your screen. Works on the site tablet and on a staff member's own phone
 * (read-only there, like My shifts). Managers see every lane side by side, or their own shift.
 */
export default async function Shift({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await current();
  if (!ctx) redirect("/login");
  if (ctx.person.pinMustChange) redirect("/pin");
  const params = await searchParams;
  const db = store();
  const now = Date.now();
  const today = londonDate(now);
  const onPhone = ctx.scope === "shifts";
  const onTablet = !onPhone;
  const needsPin = !!(await db.session(ctx.sessionId))?.deviceId;
  const pickedLane = isLane(params.lane) ? params.lane : undefined;
  const managerHere = !onPhone && ctx.isManager;
  const view = params.view === "me" || params.view === "lanes" ? params.view : managerHere ? "lanes" : "me";

  const header = onPhone ? (
    <header className="top">
      <div className="logo">PHO &amp; CO</div>
      <div className="who">
        <span>{ctx.person.name}</span>
        <Link className="pill-btn" href="/me">My shifts</Link>
        <form action={signOut}><button className="pill-btn" type="submit">Sign out</button></form>
      </div>
    </header>
  ) : <TopBar ctx={ctx} />;

  const more = (site: ShiftView["site"] | undefined) => (
    <nav className="row wrap" aria-label="More" style={{ gap: 8 }}>
      {!onPhone && <Link className="btn ghost small" href="/today">Everything at {site?.name ?? ctx.site.name}</Link>}
      <Link className="btn ghost small" href="/handover">Handover</Link>
      {!onPhone && <Link className="btn ghost small" href="/library/recipes">Recipes</Link>}
      <Link className="btn ghost small" href="/library">SOPs</Link>
      <Link className="btn ghost small" href="/library/allergens">Allergens</Link>
      <Link className="btn ghost small" href="/rota">Rota</Link>
      <Link className="btn ghost small" href="/me">My shifts</Link>
    </nav>
  );

  // A manager's view: every lane with people on today, side by side.
  if (view === "lanes" && managerHere) {
    const lanes = await siteLanes(ctx.site, now, db);
    return (
      <>
        {header}
        <main className="wide">
          <div className="row wrap" style={{ alignItems: "flex-end" }}>
            <div className="grow">
              <div className="eyebrow">{ctx.site.name} · {shortDay(today)} · {londonHM(now)}</div>
              <h1 className="h-display">Today&apos;s lanes</h1>
            </div>
            <div className="seg sm-seg" role="group" aria-label="View as">
              <Link href="/shift?view=lanes" aria-current="page" className="sm-seg-on">Every lane</Link>
              <Link href="/shift?view=me">My shift</Link>
            </div>
          </div>
          {lanes.length === 0 && (
            <div className="card stack">
              <div className="strong">Nobody is on the published rota at {ctx.site.name} today.</div>
              <div className="muted">Lanes appear as soon as a rota week is published. Until then, pick one to see what&apos;s waiting:</div>
              <div className="row wrap" style={{ gap: 8 }}>{siteLaneIds(ctx.site).map((l) => <Link key={l} className="btn ghost small" href={`/shift?view=me&lane=${l}`}>{laneName(l)}</Link>)}</div>
            </div>
          )}
          <div className="sm-lanes">
            {lanes.map(({ lane, view: v }) => (
              <section key={lane.lane} className="sm-lane" aria-label={`${laneName(lane.lane)} lane`}>
                <div className="sm-lane-head">
                  <div className="row wrap" style={{ gap: 8, alignItems: "baseline" }}>
                    <h2 className="h-sec" style={{ fontSize: 24 }}>{laneName(lane.lane)}</h2>
                    <span className="muted">{windowLabel(lane)}</span>
                  </div>
                  <OnShift on={v.on} />
                  <Summary view={v} />
                </div>
                <DayStrip view={v} now={now} />
                {v.first && <FirstUp item={v.first} />}
                <ShiftList view={v} needsPin={needsPin} compact />
              </section>
            ))}
          </div>
          {more(ctx.site)}
        </main>
        <BottomNav ctx={ctx} current="shift" />
      </>
    );
  }

  const result = await myShift(ctx, { onTablet, lane: pickedLane, now }, db);

  // Not on today's rota. On their own phone that's My shifts' job; on the tablet they pick a lane.
  if (result.kind === "pick") {
    if (onPhone) redirect("/me");
    const { choices, elsewhere } = result;
    return (
      <>
        {header}
        <main>
          <div>
            <div className="eyebrow">{ctx.site.name} · {shortDay(today)} · {londonHM(now)}</div>
            <h1 className="h-display">Hi {ctx.person.name.split(" ")[0]}</h1>
          </div>
          <div className="card stack" style={{ gap: 10 }}>
            <div className="strong" style={{ fontSize: 18 }}>You&apos;re not on today&apos;s published rota at {ctx.site.name}.</div>
            {elsewhere && <div className="muted">Your shift today is at {elsewhere.site.name}, {elsewhere.start}–{elsewhere.end}.</div>}
            <div className="muted">Working anyway? Pick where you are and the shift screen shows what&apos;s waiting there.</div>
            <div className="sm-pick">
              {choices.map((l) => (
                <Link key={l} href={`/shift?view=me&lane=${l}`} className="sm-pick-btn"><Icon name={l === "FOH" ? "notice" : "prep"} /><span>{laneName(l)}</span></Link>
              ))}
              {choices.length === 0 && <div className="muted">Your account has no section at {ctx.site.name}: ask a manager to add one.</div>}
            </div>
          </div>
          {more(undefined)}
        </main>
        {!onPhone && <BottomNav ctx={ctx} current="shift" />}
      </>
    );
  }

  const v = result.view;
  const { window: w, shift, site } = v;
  const picked = !shift;
  return (
    <>
      {header}
      <main>
        <div className="row wrap" style={{ alignItems: "flex-end" }}>
          <div className="grow">
            <div className="eyebrow">{site.name} · {dayLabel(w.date, today)} · {windowLabel(w)}{picked ? " · not on the rota" : ""}</div>
            <h1 className="h-display"><LaneTitle lane={w.lane} /></h1>
          </div>
          {managerHere && (
            <div className="seg sm-seg" role="group" aria-label="View as">
              <Link href="/shift?view=lanes">Every lane</Link>
              <Link href="/shift?view=me" aria-current="page" className="sm-seg-on">My shift</Link>
            </div>
          )}
          {picked && (
            <div className="row wrap" style={{ gap: 6 }} aria-label="Lane">
              {LANES.filter((l) => l !== w.lane && siteLaneIds(site).includes(l)).map((l) => <Link key={l} className="btn ghost small" href={`/shift?view=me&lane=${l}`}>Switch to {laneName(l)}</Link>)}
            </div>
          )}
        </div>

        <div className="card stack sm-head" style={{ gap: 10 }}>
          <div className="row wrap" style={{ gap: 10 }}>
            <Summary view={v} />
            <span className="muted" style={{ marginLeft: "auto" }}>Now {londonHM(now)}</span>
          </div>
          <DayStrip view={v} now={now} />
          <OnShift on={v.on.filter((p) => p.personId !== ctx.person.id)} />
          {v.reply && <ShiftReply shiftId={v.reply.shiftId} current={v.reply.current} />}
        </div>

        {v.first && <FirstUp item={v.first} />}
        <ShiftList view={v} needsPin={needsPin} />
        {more(site)}
        <div className="foot-links"><Link href="/pin">Change my PIN</Link></div>
      </main>
      {!onPhone && <BottomNav ctx={ctx} current="shift" />}
    </>
  );
}
