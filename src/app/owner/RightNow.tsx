import Link from "next/link";

export interface RightNowProps {
  /** Urgent things across the sites: P1 and P2 in the task centre (faults, overdue checks, food-safety notes). */
  urgent: number;
  /** Sites whose opening checks are due today, and how many are ready (green). Undefined before any site has a ready time today. */
  ready?: { green: number; of: number };
  /** Prep still outstanding across the sites, and how much of it is urgent. */
  prep?: { toDo: number; urgent: number };
  /** Today's team: on the rota, late or not coming. */
  team: { onRota: number; late: number; cantMakeIt: number };
  /** The site this session works at: its lanes are one tap away. */
  lanes?: { site: string; href: string };
}

/** The owner's first glance: four numbers that say whether the day is fine, then the sites. */
export function RightNow({ urgent, ready, prep, team, lanes }: RightNowProps) {
  const trouble = team.late + team.cantMakeIt;
  return (
    <section className="sm-kpis" aria-label="Right now">
      <Link href="/manage/tasks" className={`card sm-kpi ${urgent ? "urgent" : ""}`}>
        <span className="eyebrow">Urgent</span>
        <span className="stat">{urgent}</span>
        <span className="muted">{urgent ? "P1 and P2 across your sites" : "nothing urgent"}</span>
      </Link>
      <div className="card sm-kpi">
        <span className="eyebrow">Ready to open</span>
        <span className="stat">{ready ? <>{ready.green}<span className="sm-kpi-of">/{ready.of}</span></> : "—"}</span>
        <span className="muted">{ready ? (ready.green === ready.of ? "every site ready" : "sites ready") : "no opening checks due yet"}</span>
      </div>
      <Link href="/handover" className="card sm-kpi">
        <span className="eyebrow">Prep to do</span>
        <span className="stat">{prep ? prep.toDo : "—"}</span>
        <span className="muted">{prep ? (prep.urgent ? `${prep.urgent} urgent` : prep.toDo ? "from the last handover" : "all done") : "prep board off"}</span>
      </Link>
      <div className={`card sm-kpi ${trouble ? "warn" : ""}`}>
        <span className="eyebrow">On shift today</span>
        <span className="stat">{team.onRota}</span>
        <span className="muted">{trouble ? [team.late ? `${team.late} late` : "", team.cantMakeIt ? `${team.cantMakeIt} can't make it` : ""].filter(Boolean).join(" · ") : team.onRota ? "all as planned" : "nobody on the rota"}</span>
      </div>
      {lanes && <Link href={lanes.href} className="btn ghost small sm-kpi-lanes">Lanes at {lanes.site}</Link>}
    </section>
  );
}
