import Link from "next/link";
import { store } from "@/lib/data";
import { audienceText, categoryLabel, dueText, PRIORITIES, SOURCE_LABEL, type CentreItem } from "@/lib/domain/tasks";
import { sinceText } from "@/lib/domain/equipment";
import { sectionsFor } from "@/lib/domain/staff";
import { londonDate } from "@/lib/domain/time";
import { BottomNav, TopBar } from "@/components/Chrome";
import { TaskDone, UndoTask } from "@/components/TaskDone";
import { requireManager } from "@/lib/session";
import { centreFor } from "@/lib/task-centre";
import { ResolveAlert } from "./ResolveAlert";
import { TaskForm } from "./TaskForm";

export const dynamic = "force-dynamic";

const PRIO_CHIP = { 1: "bad", 2: "late", 3: "warn", 4: "" } as const;
const when = (t: number) => new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

/**
 * The task centre: everything open at the sites a manager runs, in one list by priority. Manual tasks are added
 * and ticked here; alerts can be resolved here; everything else links to where it's dealt with.
 */
export default async function TaskCentre(props: { searchParams: Promise<{ site?: string }> }) {
  const searchParams = await props.searchParams;
  const ctx = await requireManager();
  const db = store();
  const now = Date.now();
  const today = londonDate(now);
  const all = (await db.sites()).filter((s) => s.status === "open" && ctx.managed.includes(s.id));
  const picked = all.filter((s) => s.id === searchParams.site);
  const sites = picked.length ? picked : all; // an unknown or someone else's site shows all of theirs
  const [lists, people, recent] = await Promise.all([
    Promise.all(sites.map((s) => centreFor(s, ctx.person, now))),
    db.people(),
    db.tasks({ siteIds: sites.map((s) => s.id), closedSince: now - 7 * 86_400_000 }),
  ]);
  const items = lists.flat().sort((a, b) => a.priority - b.priority || (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || (a.since ?? Infinity) - (b.since ?? Infinity));
  const siteName = new Map(all.map((s) => [s.id, s.name]));
  const multi = sites.length > 1;
  const closed = recent.filter((t) => t.status !== "open").sort((a, b) => (b.doneAt ?? b.cancelledAt ?? 0) - (a.doneAt ?? a.cancelledAt ?? 0)).slice(0, 25);
  const choices = all.map((s) => ({
    id: s.id, name: s.name, sections: sectionsFor(s.kind),
    people: people.filter((p) => p.status === "active" && p.access.some((a) => a.siteId === s.id)).map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)),
  }));

  const Item = ({ it }: { it: CentreItem }) => {
    const due = it.dueOn ? dueText(it.dueOn, today) : undefined;
    return (
      <div className="card stack task-item" id={it.task ? `t-${it.task.id}` : undefined} style={{ gap: 6 }}>
        <div className="row wrap" style={{ gap: 6 }}>
          <span className={`chip ${PRIO_CHIP[it.priority]}`}>P{it.priority}</span>
          <span className="chip">{SOURCE_LABEL[it.source]}{it.task ? ` · ${categoryLabel(it.task.category)}` : ""}</span>
          {multi && <span className="chip">{siteName.get(it.siteId)}</span>}
          <span className="grow" />
          {due ? <span className={due.overdue ? "err" : "muted"} style={{ fontSize: 13 }}>{due.text}</span>
            : it.since ? <span className="muted" style={{ fontSize: 13 }}>open {sinceText(it.since, now)}</span> : null}
        </div>
        <div className="strong" style={{ fontSize: 15 }}>{it.title}</div>
        {it.detail && <div className="muted" style={{ whiteSpace: "pre-wrap" }}>{it.detail}</div>}
        {it.task && <div className="muted" style={{ fontSize: 13 }}>For {audienceText(it.task, siteName.get(it.siteId) ?? it.siteId)} · from {it.task.createdByName}</div>}
        {it.task ? <TaskDone id={it.task.id} title={it.task.title} canCancel />
          : it.alertId ? <ResolveAlert id={it.alertId} />
          : <div><Link className="btn ghost small" href={it.href}>Open</Link></div>}
      </div>
    );
  };

  return (
    <>
      <TopBar ctx={ctx} />
      <main className="wide">
        <div><div className="eyebrow">Manager tools · {multi ? "all your sites" : sites[0]?.name}</div><h1 className="h-display">Task centre</h1></div>
        {all.length > 1 && (
          <nav className="row wrap" style={{ gap: 6 }} aria-label="Site">
            <Link className={`chip ${!picked.length ? "done" : ""}`} href="/manage/tasks">All sites</Link>
            {all.map((s) => <Link key={s.id} className={`chip ${s.id === searchParams.site ? "done" : ""}`} href={`/manage/tasks?site=${s.id}`}>{s.name}</Link>)}
          </nav>
        )}
        <div className="stats">
          {PRIORITIES.map((p) => {
            const n = items.filter((i) => i.priority === p.id).length;
            return <div key={p.id} className="card"><div className="stat" style={{ color: n && p.id === 1 ? "var(--bad)" : n && p.id === 2 ? "var(--accent)" : undefined }}>{n}</div><div className="muted">{p.code} {p.label.toLowerCase()}</div></div>;
          })}
        </div>

        {sites.length === 0
          ? <div className="card muted">None of the sites you manage is open, so there&apos;s nothing to show.</div>
          : <TaskForm key={sites.map((s) => s.id).join(",")} sites={choices.filter((c) => sites.some((s) => s.id === c.id))} today={today} />}

        {items.length === 0 && <div className="alert good" role="status"><div className="strong">Nothing open. Everything is up to date.</div></div>}
        {PRIORITIES.map((p) => {
          const group = items.filter((i) => i.priority === p.id);
          if (!group.length) return null;
          return (
            <section key={p.id} className="stack" aria-label={`${p.code} ${p.label}`}>
              <h2 className="h-sec">{p.code} · {p.label} <span className="muted" style={{ fontSize: 14 }}>({group.length})</span></h2>
              {group.map((it) => <Item key={it.key} it={it} />)}
            </section>
          );
        })}

        {closed.length > 0 && (
          <details className="card">
            <summary className="strong" style={{ cursor: "pointer" }}>Done or taken off in the last 7 days ({closed.length})</summary>
            <div className="log" style={{ marginTop: 8 }}>
              {closed.map((t) => (
                <div key={t.id} style={{ alignItems: "center" }}>
                  <span className="grow">{t.title} <span className="muted">· {t.status === "done" ? `done by ${t.doneByName}, ${when(t.doneAt!)}${t.doneNote ? `: "${t.doneNote}"` : ""}` : `taken off, ${when(t.cancelledAt!)}`}{multi ? ` · ${siteName.get(t.siteId)}` : ""}</span></span>
                  {t.status === "done" && t.doneBy === ctx.person.id && now - t.doneAt! < 10 * 60_000 && <UndoTask id={t.id} />}
                </div>
              ))}
            </div>
          </details>
        )}
        <div className="muted" style={{ fontSize: 13 }}>P1 critical: a safety or operational risk now. P2 high: this shift. P3 normal: routine. P4: improvements. Alerts, broken kit, handover actions, prep, overdue checklists, time off, certificates and servicing appear here by themselves and stay where they are.</div>
      </main>
      <BottomNav ctx={ctx} current={ctx.isOwner ? "owner" : "manage"} />
    </>
  );
}
