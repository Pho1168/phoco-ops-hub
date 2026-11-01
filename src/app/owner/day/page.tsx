import { redirect } from "next/navigation";
import { BottomNav, TopBar } from "@/components/Chrome";
import { DoneRow, MyRow, MyTaskForm, type FormTask } from "@/components/MyDay";
import { store } from "@/lib/data";
import { repeatWords, alertWords, type MyItem } from "@/lib/domain/my-day";
import { longDay } from "@/lib/domain/time";
import { myDayFor, rowView } from "@/lib/my-day-service";
import { requireLead } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * My Day: the owner's own list, private to them. Top 3 first, then the rest of today (carried-over ones marked),
 * this week, later, no date, what's repeating, and what was ticked today. Add or change a task at the bottom.
 */
export default async function MyDayPage(props: { searchParams: Promise<{ edit?: string }> }) {
  const ctx = await requireLead();
  if (!ctx.isOwner) redirect("/owner");
  const { view, tasks, today } = await myDayFor(store(), ctx.person.id, Date.now());
  const editId = (await props.searchParams).edit;
  const edit = tasks.find((t) => t.id === editId && t.status === "open");
  const editTask: FormTask | undefined = edit && { id: edit.id, title: edit.title, note: edit.note, priority: edit.priority, repeat: edit.repeat, day: edit.day, dueOn: edit.dueOn, alertDays: edit.alertDays, top: edit.top };
  const rows = (xs: MyItem[]) => <ul className="my-list">{xs.map((i) => <MyRow key={i.task.id} r={rowView(i, today)} full />)}</ul>;
  const repeating = tasks.filter((t) => t.status === "open" && t.repeat !== "once").sort((a, b) => a.repeat.localeCompare(b.repeat) || a.day! - b.day!);
  return (
    <>
      <TopBar ctx={ctx} neutral title="My day" eyebrow={longDay(today)} back="/owner" />
      <main className="stack" style={{ paddingBottom: 120 }}>
        <section className="card stack my-card" aria-label="Top 3">
          <div className="row wrap">
            <h2 className="h-sec grow">Top 3</h2>
            <span className={`chip ${view.leftToday ? "warn" : "done"}`}>{view.leftToday ? `${view.leftToday} left today` : "Today's done"}</span>
          </div>
          {view.top.length ? rows(view.top) : <div className="muted">Nothing urgent. Pin a task with ☆ to put it here.</div>}
        </section>

        {view.today.length > 0 && <section className="stack" aria-label="Rest of today"><h2 className="grp-h">Rest of today <span>{view.today.length}</span></h2>{rows(view.today)}</section>}
        {view.week.length > 0 && <section className="stack" aria-label="This week"><h2 className="grp-h">This week <span>{view.week.length}</span></h2>{rows(view.week)}</section>}
        {view.anytime.length > 0 && <section className="stack" aria-label="No date"><h2 className="grp-h">No date <span>{view.anytime.length}</span></h2>{rows(view.anytime)}</section>}
        {view.later.length > 0 && (
          <details className="stack">
            <summary className="grp-h" style={{ cursor: "pointer" }}>Later <span>{view.later.length}</span></summary>
            {rows(view.later)}
          </details>
        )}
        {view.doneToday.length > 0 && (
          <details>
            <summary className="grp-h" style={{ cursor: "pointer" }}>Ticked today <span>{view.doneToday.length}</span></summary>
            <ul className="my-list" style={{ marginTop: 8 }}>{view.doneToday.map((d) => <DoneRow key={`${d.task.id}|${d.due}`} id={d.task.id} title={d.task.title} due={d.due} kind={d.kind} />)}</ul>
          </details>
        )}
        {repeating.length > 0 && (
          <details>
            <summary className="grp-h" style={{ cursor: "pointer" }}>Repeating <span>{repeating.length}</span></summary>
            <ul className="my-list" style={{ marginTop: 8 }}>
              {repeating.map((t) => (
                <li key={t.id} className={`my-row p${t.priority}`}>
                  <span className="my-dot" />
                  <div className="grow"><div className="my-title">{t.title}</div><div className="my-meta">{[repeatWords(t), alertWords(t)].filter(Boolean).join(" · ")}</div></div>
                  <a className="btn ghost small" href={`/owner/day?edit=${t.id}#form`}>Edit</a>
                </li>
              ))}
            </ul>
          </details>
        )}

        <MyTaskForm key={edit?.id ?? "new"} task={editTask} today={today} />
        <p className="muted">Only you can see My Day. Anything not ticked moves to the next day and shows as overdue. Orange is urgent, amber this week, teal can wait.</p>
      </main>
      <BottomNav ctx={ctx} current="owner" />
    </>
  );
}
