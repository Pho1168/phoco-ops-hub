import Link from "next/link";
import { store } from "@/lib/data";
import { progress, runState } from "@/lib/domain/checklist";
import { londonNow, requireCtx } from "@/lib/session";
import { BottomNav, TopBar } from "@/components/Chrome";
import { Icon } from "@/components/Icon";

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
  const handover = (await db.handover(ctx.site.id)).filter((h) => h.needsAction && !h.closedAt);
  const done = rows.filter((r) => r.state === "done").length;

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

        {alerts.map((a) => (
          <div key={a.id} className={`alert ${a.level === "critical" ? "bad" : ""}`} role="status">
            <Icon name="alert" />
            <div className="grow"><div className="strong">{a.title}</div><div style={{ fontSize: 13 }}>{a.detail}</div></div>
          </div>
        ))}
        {handover.length > 0 && (
          <Link href="/handover" className="alert" style={{ textDecoration: "none" }}>
            <Icon name="handover" />
            <div className="grow"><div className="strong">{handover.length} open handover item{handover.length > 1 ? "s" : ""}</div><div style={{ fontSize: 13 }}>{handover[0].body}</div></div>
          </Link>
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
      </main>
      <BottomNav ctx={ctx} current="today" />
    </>
  );
}
