import type { MyMark, MyTask } from "@/lib/domain/my-day";
import { sql } from "./pg";
import type { MyDayStore } from "./my-day-store";

/** Postgres implementation of My Day (migration 0049). */
interface TaskRow {
  id: string; person_id: string; title: string; note: string | null; priority: number; repeat: MyTask["repeat"]; repeat_day: number | null;
  due_on: string | null; starts_on: string; alert_days: number | null; top: boolean; status: MyTask["status"]; created_at: Date;
}
interface MarkRow { id: string; task_id: string; due_on: string; kind: MyMark["kind"]; at: Date }

const toTask = (r: TaskRow): MyTask => ({
  id: r.id, personId: r.person_id, title: r.title, note: r.note ?? undefined, priority: r.priority as MyTask["priority"], repeat: r.repeat,
  day: r.repeat_day ?? undefined, dueOn: r.due_on ?? undefined, startsOn: r.starts_on, alertDays: r.alert_days ?? undefined, top: r.top,
  status: r.status, createdAt: r.created_at.getTime(),
});
const COLS = "id, person_id, title, note, priority, repeat, repeat_day, to_char(due_on, 'YYYY-MM-DD') as due_on, to_char(starts_on, 'YYYY-MM-DD') as starts_on, alert_days, top, status, created_at";

export const myDaySql: MyDayStore = {
  async myTasks(personId) {
    const q = sql();
    return (await q<TaskRow[]>`select ${q.unsafe(COLS)} from my_tasks where person_id = ${personId} order by created_at, id`).map(toTask);
  },
  async myTasksWithAlerts() {
    const q = sql();
    return (await q<TaskRow[]>`select ${q.unsafe(COLS)} from my_tasks where status = 'open' and alert_days is not null order by created_at, id`).map(toTask);
  },
  async myTaskMarks(taskIds) {
    if (!taskIds.length) return [];
    const q = sql();
    return (await q<MarkRow[]>`select id, task_id, to_char(due_on, 'YYYY-MM-DD') as due_on, kind, at from my_task_marks
      where task_id = any(${taskIds}::uuid[]) order by at, id`).map((r) => ({ id: r.id, taskId: r.task_id, dueOn: r.due_on, kind: r.kind, at: r.at.getTime() }));
  },
  async addMyTask(personId, t) {
    const q = sql();
    const [r] = await q<TaskRow[]>`insert into my_tasks (person_id, title, note, priority, repeat, repeat_day, due_on, starts_on, alert_days, top)
      values (${personId}, ${t.title}, ${t.note ?? null}, ${t.priority}, ${t.repeat}, ${t.day ?? null}, ${t.dueOn ?? null}, ${t.startsOn}, ${t.alertDays ?? null}, ${t.top})
      returning ${q.unsafe(COLS)}`;
    return toTask(r);
  },
  async updateMyTask(personId, id, p) {
    const q = sql();
    const set: Record<string, unknown> = {};
    if (p.title !== undefined) set.title = p.title;
    if ("note" in p) set.note = p.note ?? null;
    if (p.priority !== undefined) set.priority = p.priority;
    if (p.repeat !== undefined) set.repeat = p.repeat;
    if ("day" in p) set.repeat_day = p.day ?? null;
    if ("dueOn" in p) set.due_on = p.dueOn ?? null;
    if (p.startsOn !== undefined) set.starts_on = p.startsOn;
    if ("alertDays" in p) set.alert_days = p.alertDays ?? null;
    if (p.top !== undefined) set.top = p.top;
    if (p.status !== undefined) set.status = p.status;
    const keys = Object.keys(set);
    if (!keys.length) return true;
    const r = await q`update my_tasks set ${q(set as Record<string, string>, ...keys)}, updated_at = now() where id = ${id} and person_id = ${personId}`;
    return r.count === 1;
  },
  async markMyTask(taskId, dueOn, kind) {
    const q = sql();
    await q`insert into my_task_marks (task_id, due_on, kind) values (${taskId}, ${dueOn}, ${kind})`;
  },
};
