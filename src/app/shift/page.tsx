import Link from "next/link";
import { redirect } from "next/navigation";
import { BottomNav, PhoneTopBar, TopBar } from "@/components/Chrome";
import { Icon } from "@/components/Icon";
import { store } from "@/lib/data";
import { LANES, laneName, windowLabel, type Lane } from "@/lib/domain/shift-mode";
import { firstName } from "@/lib/domain/names";
import { londonDate, londonHM, shortDay } from "@/lib/domain/time";
import { current } from "@/lib/session";
import { myShift, siteLaneIds, siteLanes, type ShiftView } from "@/lib/shift-service";
import { ShiftReply } from "@/app/me/ShiftReply";
import { DayStrip, FirstUp, LaneTitle, OnShift, ShiftList, Summary } from "./parts";
import { CleaningBoard } from "@/components/CleaningBoard";
import { boardRows, cleaningBoards } from "@/lib/cleaning-service";

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

  const Bar = onPhone ? PhoneTopBar : TopBar;
  // The weekly cleaning board sits at the top of every view on the tablet, for everyone.
  const cleaning = onTablet ? (await cleaningBoards(db, [ctx.site.id], now)).get(ctx.site.id) ?? [] : [];
  const board = cleaning.length ? <CleaningBoard site={ctx.site.name} rows={boardRows(cleaning, ctx.person.id)} canAct compact /> : null;
  const dateLine = (site: string, when = shortDay(today)) => `${site} · ${when}`;

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
        <Bar ctx={ctx} title="Today’s lanes" eyebrow={dateLine(ctx.site.name)} />
        <main className="wide">
          {board}
          <div className="row wrap" style={{ gap: 8 }}>
            <span className="muted lead">Every lane with people on today, side by side.</span>
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
                  <OnShift on={v.on} label="On this lane" />
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
        <Bar ctx={ctx} title={`Hi ${firstName(ctx.person.name)}`} eyebrow={dateLine(ctx.site.name)} />
        <main>
          {board}
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
      <Bar ctx={ctx} title={<LaneTitle lane={w.lane} />} eyebrow={`${dateLine(site.name, dayLabel(w.date, today))} · ${windowLabel(w)}${picked ? " · not on the rota" : ""}`} />
      <main>
        {board}
        {(managerHere || picked) && (
          <div className="row wrap" style={{ gap: 8 }}>
            <span className="muted lead">{picked ? "Not on today's rota: showing the lane you picked." : "Your own shift."}</span>
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
        )}

        <div className="card stack sm-head" style={{ gap: 10 }}>
          <div className="row wrap" style={{ gap: 10 }}>
            <Summary view={v} />
            <span className="muted" style={{ marginLeft: "auto" }}>Now {londonHM(now)}</span>
          </div>
          <DayStrip view={v} now={now} />
          <OnShift on={v.on.filter((p) => p.personId !== ctx.person.id)} label="On with you" />
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
