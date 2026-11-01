import type { MyMark, MyMarkKind, MyTask, MyTaskClean } from "@/lib/domain/my-day";

/**
 * My Day, the owner's own to-do list (migration 0049). Part of Store (both stores implement it). Tasks are changed or
 * stopped, never deleted; ticks are only added.
 */
export interface MyDayStore {
  /** A person's tasks, open and stopped, oldest first. */
  myTasks(personId: string): Promise<MyTask[]>;
  /** Every open task with a reminder, everyone's (for the scheduler). */
  myTasksWithAlerts(): Promise<MyTask[]>;
  /** Every tick on these tasks, oldest first. */
  myTaskMarks(taskIds: string[]): Promise<MyMark[]>;
  addMyTask(personId: string, t: MyTaskClean & { startsOn: string }): Promise<MyTask>;
  /** Changes the person's own task. False if it isn't theirs. */
  updateMyTask(personId: string, id: string, patch: Partial<MyTaskClean & { startsOn: string; status: MyTask["status"] }>): Promise<boolean>;
  markMyTask(taskId: string, dueOn: string, kind: MyMarkKind): Promise<void>;
}
