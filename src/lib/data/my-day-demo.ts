import { randomUUID } from "node:crypto";
import type { MyMark, MyTask } from "@/lib/domain/my-day";
import type { MyDayStore } from "./my-day-store";

/** My Day in demo mode: in memory. Tasks are changed, never removed; ticks are only added. */
const g = globalThis as unknown as { __phocoMyDayDemo?: { tasks: MyTask[]; marks: MyMark[] } };
const S = () => (g.__phocoMyDayDemo ??= { tasks: [], marks: [] });
export function resetMyDayDemo() { g.__phocoMyDayDemo = { tasks: [], marks: [] }; }

export function makeMyDayDemo(): MyDayStore {
  const copy = (t: MyTask): MyTask => ({ ...t });
  return {
    async myTasks(personId) { return S().tasks.filter((t) => t.personId === personId).map(copy); },
    async myTasksWithAlerts() { return S().tasks.filter((t) => t.status === "open" && t.alertDays !== undefined).map(copy); },
    async myTaskMarks(taskIds) { return S().marks.filter((m) => taskIds.includes(m.taskId)).sort((a, b) => a.at - b.at).map((m) => ({ ...m })); },
    async addMyTask(personId, t) {
      const x: MyTask = { id: randomUUID(), personId, status: "open", createdAt: Date.now(), ...t };
      S().tasks.push(x);
      return copy(x);
    },
    async updateMyTask(personId, id, p) {
      const t = S().tasks.find((x) => x.id === id && x.personId === personId);
      if (!t) return false;
      Object.assign(t, p);
      return true;
    },
    async markMyTask(taskId, dueOn, kind) {
      const last = S().marks.at(-1)?.at ?? 0;
      S().marks.push({ id: randomUUID(), taskId, dueOn, kind, at: Math.max(Date.now(), last + 1) });
    },
  };
}
