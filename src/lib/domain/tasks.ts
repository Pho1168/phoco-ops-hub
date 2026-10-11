import { canManage } from "./access";
import { addDays, shortDay } from "./time";
import type { Area, Person, SiteId } from "./types";

/**
 * Tasks and the task centre. Managers give one-off jobs to a person, a section or everyone at a site, with a
 * priority and a date. The task centre puts those together with everything else that's open (alerts, broken
 * kit, handover actions, prep, overdue checklists, time off, certificates, services) in one list by priority.
 * The other items stay where they are: the centre only reads them and links to them.
 */

export type Priority = 1 | 2 | 3 | 4;
export const PRIORITIES: { id: Priority; code: string; label: string; hint: string }[] = [
  { id: 1, code: "P1", label: "Critical", hint: "Immediate safety or operational risk" },
  { id: 2, code: "P2", label: "High", hint: "Important work for this shift" },
  { id: 3, code: "P3", label: "Normal", hint: "Routine work" },
  { id: 4, code: "P4", label: "Improvement", hint: "When there's time" },
];
export const priorityCode = (p: Priority) => `P${p}`;

export type TaskCategory = "cleaning" | "maintenance" | "food_safety" | "stock" | "training" | "admin" | "other";
export const TASK_CATEGORIES: { id: TaskCategory; label: string }[] = [
  { id: "cleaning", label: "Cleaning" },
  { id: "food_safety", label: "Food safety" },
  { id: "maintenance", label: "Maintenance" },
  { id: "stock", label: "Stock and ordering" },
  { id: "training", label: "Training" },
  { id: "admin", label: "Admin" },
  { id: "other", label: "Other" },
];
export const categoryLabel = (c: TaskCategory) => TASK_CATEGORIES.find((x) => x.id === c)?.label ?? c;

export type TaskStatus = "open" | "done" | "cancelled";

export interface Task {
  id: string; siteId: SiteId; title: string; detail?: string; priority: Priority; category: TaskCategory;
  /** A named person; or else a section; or neither: anyone at the site. */
  assigneeId?: string; assigneeName?: string; section?: Area;
  /** London date it's due by. */
  dueOn?: string;
  status: TaskStatus;
  createdBy: string; createdByName: string; createdAt: number;
  doneBy?: string; doneByName?: string; doneAt?: number; doneNote?: string;
  cancelledBy?: string; cancelledAt?: number;
}

export const TITLE_MAX = 120;
export const DETAIL_MAX = 1000;

export type Checked = { ok: true } | { ok: false; error: string };

export interface TaskInput { title: string; detail?: string; priority: Priority; category: TaskCategory; assigneeId?: string; section?: Area; dueOn?: string }

export function validateTask(t: TaskInput, today: string): Checked {
  if (!t.title.trim()) return { ok: false, error: "Say what needs doing" };
  if (t.title.length > TITLE_MAX) return { ok: false, error: `Keep the task under ${TITLE_MAX} characters` };
  if ((t.detail ?? "").length > DETAIL_MAX) return { ok: false, error: `Keep the details under ${DETAIL_MAX} characters` };
  if (![1, 2, 3, 4].includes(t.priority)) return { ok: false, error: "Choose a priority" };
  if (!TASK_CATEGORIES.some((c) => c.id === t.category)) return { ok: false, error: "Choose a category" };
  if (t.assigneeId && t.section) return { ok: false, error: "Give it to a person or a section, not both" };
  if (t.dueOn !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.dueOn)) return { ok: false, error: "Check the date" };
    if (t.dueOn < today) return { ok: false, error: "The date is already past" };
    if (t.dueOn > addDays(today, 366)) return { ok: false, error: "That's more than a year away" };
  }
  return { ok: true };
}

/** A task is for: its named person; or everyone in its section at the site; or everyone at the site. Managers of the site see them all. */
export function isForPerson(t: Pick<Task, "siteId" | "assigneeId" | "section">, person: Pick<Person, "id" | "status" | "access">): boolean {
  if (person.status !== "active") return false;
  const access = person.access.find((a) => a.siteId === t.siteId);
  if (!access) return false;
  if (t.assigneeId) return t.assigneeId === person.id;
  if (t.section) return access.sections.includes(t.section);
  return true;
}

/** Who can tick it done: the people it's for, and the site's managers. */
export const canComplete = (t: Pick<Task, "siteId" | "assigneeId" | "section">, person: Pick<Person, "id" | "status" | "access">) =>
  isForPerson(t, person) || (person.status === "active" && canManage(person, t.siteId));

/** Most urgent first: priority, then anything overdue, then the due date, then the oldest. */
export function taskOrder(today: string) {
  return (a: Pick<Task, "priority" | "dueOn" | "createdAt">, b: Pick<Task, "priority" | "dueOn" | "createdAt">) =>
    a.priority - b.priority
    || Number(!!b.dueOn && b.dueOn < today) - Number(!!a.dueOn && a.dueOn < today)
    || (a.dueOn ?? "9999-12-31").localeCompare(b.dueOn ?? "9999-12-31")
    || a.createdAt - b.createdAt;
}

export function dueText(dueOn: string | undefined, today: string): { text: string; overdue: boolean } {
  if (!dueOn) return { text: "No date", overdue: false };
  if (dueOn < today) return { text: `Overdue since ${shortDay(dueOn)}`, overdue: true };
  if (dueOn === today) return { text: "Due today", overdue: false };
  if (dueOn === addDays(today, 1)) return { text: "Due tomorrow", overdue: false };
  return { text: `Due ${shortDay(dueOn)}`, overdue: false };
}

/** Who a task is for, in words. */
export function audienceText(t: Pick<Task, "assigneeName" | "section">, siteName: string): string {
  if (t.assigneeName) return t.assigneeName;
  if (t.section) return `${t.section} at ${siteName}`;
  return `Anyone at ${siteName}`;
}

// ---------- the task centre ----------

export type Source = "task" | "alert" | "equipment" | "handover" | "prep" | "checklist" | "timeoff" | "certificate" | "service";
export const SOURCE_LABEL: Record<Source, string> = {
  task: "Task", alert: "Alert", equipment: "Equipment", handover: "Handover", prep: "Prep", checklist: "Checklist",
  timeoff: "Time off", certificate: "Certificates", service: "Servicing",
};

export interface CentreItem {
  key: string; source: Source; priority: Priority; siteId: SiteId; title: string; detail?: string;
  /** When it started (ms), for "how long has this been open". */
  since?: number;
  dueOn?: string;
  href: string;
  /** For alerts: its id, so managers can resolve it from the centre. */
  alertId?: string;
  /** For tasks: the task, so it can be ticked off from the centre. */
  task?: Task;
}

export interface CentreInput {
  siteId: SiteId; today: string;
  tasks: Task[];
  alerts: { id: string; level: "warning" | "critical"; title: string; detail: string; createdAt: number }[];
  /** Equipment with open problems: "down" on food-safety kit is critical. */
  kit: { id: string; name: string; foodSafety: boolean; down: boolean; problems: number; since: number; latest: string }[];
  handoverActions: { id: string; category: string; body: string; createdAt: number }[];
  prepOutstanding: { urgent: number; total: number; since?: number };
  checklistsOverdue: { id: string; name: string; due?: string }[];
  timeOffPending: number;
  certificates: { expired: { personId: string; name: string; label: string }[]; expiring: { personId: string; name: string; label: string; text: string }[]; missing: number };
  services: { id: string; name: string; overdue: boolean; due: string }[];
}

/** Everything open at one site, as one list. Priorities follow the rules in the comments; sorted most urgent first. */
export function taskCentre(x: CentreInput): CentreItem[] {
  const out: CentreItem[] = [];
  const s = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  for (const t of x.tasks.filter((t) => t.status === "open"))
    out.push({ key: `task:${t.id}`, source: "task", priority: t.priority, siteId: x.siteId, title: t.title, detail: t.detail, since: t.createdAt, dueOn: t.dueOn, href: `/manage/tasks?site=${x.siteId}#t-${t.id}`, task: t });
  // Alerts come from failed food-safety checks: critical ones are P1, warnings P2.
  for (const a of x.alerts)
    out.push({ key: `alert:${a.id}`, source: "alert", priority: a.level === "critical" ? 1 : 2, siteId: x.siteId, title: a.title, detail: a.detail, since: a.createdAt, href: "/today", alertId: a.id });
  // Kit that keeps food safe and isn't working is P1; other kit not working P2; "needs attention" P3.
  for (const k of x.kit)
    out.push({ key: `kit:${k.id}`, source: "equipment", priority: k.down ? (k.foodSafety ? 1 : 2) : 3, siteId: x.siteId,
      title: `${k.down ? "Not working" : "Needs attention"}: ${k.name}`, detail: k.latest + (k.problems > 1 ? ` (+${k.problems - 1} more)` : ""), since: k.since, href: `/equipment/${k.id}` });
  // Overdue checklists today: P2.
  for (const c of x.checklistsOverdue)
    out.push({ key: `list:${c.id}`, source: "checklist", priority: 2, siteId: x.siteId, title: `Overdue: ${c.name}`, detail: c.due ? `Was due at ${c.due}` : undefined, dueOn: x.today, href: `/run/${c.id}` });
  // Handover actions: food safety P2, the rest P3.
  for (const h of x.handoverActions)
    out.push({ key: `note:${h.id}`, source: "handover", priority: h.category === "Food safety" ? 2 : 3, siteId: x.siteId, title: h.body.length > 90 ? `${h.body.slice(0, 87)}…` : h.body, detail: h.category, since: h.createdAt, href: "/handover" });
  if (x.prepOutstanding.total)
    out.push({ key: "prep", source: "prep", priority: x.prepOutstanding.urgent ? 2 : 3, siteId: x.siteId, title: `${s(x.prepOutstanding.total, "prep item")} from the last handover not done yet`,
      detail: x.prepOutstanding.urgent ? `${x.prepOutstanding.urgent} marked urgent` : undefined, since: x.prepOutstanding.since, href: "/handover" });
  if (x.timeOffPending)
    out.push({ key: "timeoff", source: "timeoff", priority: 3, siteId: x.siteId, title: `${s(x.timeOffPending, "time-off request")} to decide`, href: "/manage/time-off" });
  // Certificates: run out P2, running out P3, never recorded P4 (one line).
  for (const c of x.certificates.expired)
    out.push({ key: `cert-x:${c.personId}:${c.label}`, source: "certificate", priority: 2, siteId: x.siteId, title: `${c.name}: ${c.label} has run out`, href: `/manage/certificates/${c.personId}` });
  for (const c of x.certificates.expiring)
    out.push({ key: `cert-s:${c.personId}:${c.label}`, source: "certificate", priority: 3, siteId: x.siteId, title: `${c.name}: ${c.label}`, detail: c.text, href: `/manage/certificates/${c.personId}` });
  if (x.certificates.missing)
    out.push({ key: "cert-missing", source: "certificate", priority: 4, siteId: x.siteId, title: `${s(x.certificates.missing, "expected certificate")} not recorded yet`, href: `/manage/certificates?site=${x.siteId}` });
  // Services: overdue P3, due soon P4.
  for (const v of x.services)
    out.push({ key: `svc:${v.id}`, source: "service", priority: v.overdue ? 3 : 4, siteId: x.siteId, title: `${v.overdue ? "Service overdue" : "Service due soon"}: ${v.name}`, dueOn: v.due, href: `/equipment/${v.id}` });
  return out.sort((a, b) => a.priority - b.priority || (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || (a.since ?? Infinity) - (b.since ?? Infinity));
}
