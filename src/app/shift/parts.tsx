import Link from "next/link";
import { Icon } from "@/components/Icon";
import { GasCheck } from "@/components/GasCheck";
import { TaskDone } from "@/components/TaskDone";
import { initials } from "@/lib/domain/names";
import { laneName, type ItemState, type ShiftItem } from "@/lib/domain/shift-mode";
import { londonHM } from "@/lib/domain/time";
import type { OnLane, ShiftView } from "@/lib/shift-service";

/** Shift Mode's building blocks. Server components: the only buttons are the ones the rest of the app already has. */

const STATE_LABEL: Record<ItemState, string> = { late: "Late", now: "Now", later: "Later", whenever: "This shift", done: "Done this shift" };
const ICON: Record<ShiftItem["kind"], string> = { check: "today", prep: "prep", note: "handover", allergen: "alert", sop: "book", training: "cert", gas: "flame", ready: "clock", kit: "wrench", task: "check" };

export function ShiftItemRow({ item, siteId, siteName, needsPin }: { item: ShiftItem; siteId: string; siteName: string; needsPin: boolean }) {
  if (item.kind === "gas" && (item.state === "now" || item.state === "late")) {
    return <GasCheck siteId={siteId} siteName={siteName} state={item.state === "late" ? "overdue" : "due"} closeAt={item.dueAt ? londonHM(item.dueAt) : ""} needsPin={needsPin} />;
  }
  const body = (
    <>
      <span className={`sm-state ${item.state}`} aria-hidden>{item.state === "done" ? "✓" : item.when ?? <Icon name={ICON[item.kind]} />}</span>
      <span className="grow">
        <span className={`strong ${item.state === "done" ? "sm-done" : ""}`} style={{ display: "block" }}>{item.title}</span>
        {(item.detail || item.onTablet || item.forName) && (
          <span className="muted">{item.detail}{item.onTablet ? " · read it on the tablet" : ""}</span>
        )}
      </span>
      {item.urgent && item.state !== "done" && <span className="chip bad">{item.state === "late" ? "Late" : "Urgent"}</span>}
    </>
  );
  if (item.kind === "task") {
    return (
      <div className="sm-item">
        {body}
        <TaskDone id={item.id} title={item.title} />
      </div>
    );
  }
  return <Link href={item.href} className={`sm-item ${item.state}`}>{body}</Link>;
}

/** The items of a shift, under Late / Now / Later / This shift headings; done ones folded away at the end. */
export function ShiftList({ view, needsPin, compact = false }: { view: ShiftView; needsPin: boolean; compact?: boolean }) {
  const groups = (["late", "now", "later", "whenever"] as ItemState[]).map((s) => ({ s, items: view.items.filter((i) => i.state === s) })).filter((g) => g.items.length);
  const done = view.items.filter((i) => i.state === "done");
  return (
    <div className="stack" style={{ gap: compact ? 10 : 14 }}>
      {groups.length === 0 && <div className="card muted">Nothing waiting for this shift right now.</div>}
      {groups.map((g) => (
        <section key={g.s} className="stack" style={{ gap: 6 }} aria-label={STATE_LABEL[g.s]}>
          <h2 className={`h-sec ${g.s === "late" ? "err-text" : ""}`} style={{ fontSize: compact ? 16 : 19 }}>{STATE_LABEL[g.s]}{g.s === "later" ? " today" : ""}</h2>
          {g.items.map((i) => <ShiftItemRow key={`${i.kind}:${i.id}`} item={i} siteId={view.site.id} siteName={view.site.name} needsPin={needsPin} />)}
        </section>
      ))}
      {done.length > 0 && (
        <details className="card sm-donebox">
          <summary className="strong" style={{ cursor: "pointer" }}>Done this shift ({done.length})</summary>
          <div className="stack" style={{ gap: 6, marginTop: 10 }}>
            {done.map((i) => <ShiftItemRow key={`${i.kind}:${i.id}`} item={i} siteId={view.site.id} siteName={view.site.name} needsPin={needsPin} />)}
          </div>
        </details>
      )}
    </div>
  );
}

/** The one thing to do first, big. */
export function FirstUp({ item }: { item: ShiftItem }) {
  const late = item.state === "late";
  return (
    <Link href={item.href} className={`sm-first ${late ? "late" : ""}`}>
      <span className="eyebrow sm-first-eyebrow">{late ? "Do this first · late" : item.when ? `${item.state === "now" ? "Now" : "Next"} · ${item.when}` : "Do this first"}</span>
      <span className="sm-first-title">{item.title}</span>
      {item.detail && <span className="sm-first-detail">{item.detail}</span>}
      <span className="btn accent small sm-first-btn">{item.kind === "check" ? "Start" : "Open"}</span>
    </Link>
  );
}

/** Who's on the lane, with their late / can't-make-it replies. */
export function OnShift({ on, showTimes = true }: { on: OnLane[]; showTimes?: boolean }) {
  if (!on.length) return null;
  return (
    <ul className="sm-on" aria-label="On this shift">
      {on.map((p) => (
        <li key={p.shiftId}>
          <span className="avatar sm-avatar" aria-hidden>{initials(p.name)}</span>
          <span className="strong" style={{ fontSize: 14 }}>{p.name}</span>
          {showTimes && <span className="muted">{p.time}</span>}
          {p.reply && <span className={`chip ${p.reply.tone}`}>{p.reply.text}</span>}
        </li>
      ))}
    </ul>
  );
}


/** The shift as a strip of time: its timed items as dots, the moment now as a line. */
export function DayStrip({ view, now }: { view: ShiftView; now: number }) {
  const { startsAt, endsAt } = view.window;
  const span = Math.max(endsAt - startsAt, 60_000);
  const pct = (t: number) => `${Math.min(100, Math.max(0, ((t - startsAt) / span) * 100))}%`;
  const timed = view.items.filter((i) => i.dueAt !== undefined);
  return (
    <div className="sm-strip" aria-label={`Shift ${londonHM(startsAt)} to ${londonHM(endsAt)}`}>
      <div className="sm-strip-line" />
      {timed.map((i) => <span key={`${i.kind}:${i.id}`} className={`sm-dot ${i.state}`} style={{ left: pct(i.dueAt!) }} title={`${i.when ?? ""} ${i.title}`} />)}
      {now >= startsAt && now <= endsAt && <span className="sm-now" style={{ left: pct(now) }} />}
      <span className="sm-strip-t" style={{ left: 0 }}>{londonHM(startsAt)}</span>
      <span className="sm-strip-t" style={{ right: 0 }}>{londonHM(endsAt)}</span>
    </div>
  );
}

export function Summary({ view }: { view: ShiftView }) {
  const s = view.summary;
  return (
    <div className="row wrap" style={{ gap: 6 }} aria-label="Shift so far">
      <span className="chip done">{s.done} done</span>
      {s.late > 0 && <span className="chip bad">{s.late} late</span>}
      <span className="chip">{s.toCome} to come</span>
    </div>
  );
}

export function LaneTitle({ lane }: { lane: ShiftView["window"]["lane"] }) {
  return <>{laneName(lane)} shift</>;
}
