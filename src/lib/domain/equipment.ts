import { canManage } from "./access";
import { addDays, dayMonthYear, daysBetween } from "./time";
import type { Person, SiteId } from "./types";

/**
 * Equipment and maintenance: a register of each site's kit, faults anyone at the site can report (from the
 * tablet, their own phone or a QR label on the kit), the fix, and servicing. The history is append-only:
 * a fault, its updates, its fix and each service are separate entries that are never changed.
 */

export type EquipmentKind =
  | "fridge" | "freezer" | "cooking" | "hot_holding" | "dishwasher" | "ice_machine"
  | "probe" | "extraction" | "coffee" | "till" | "other";

export const EQUIPMENT_KINDS: { id: EquipmentKind; label: string }[] = [
  { id: "fridge", label: "Fridge / chiller" },
  { id: "freezer", label: "Freezer" },
  { id: "cooking", label: "Cooking (fryer, range, oven, wok)" },
  { id: "hot_holding", label: "Hot holding / bain-marie" },
  { id: "dishwasher", label: "Dishwasher / glasswasher" },
  { id: "ice_machine", label: "Ice machine" },
  { id: "probe", label: "Probe thermometer" },
  { id: "extraction", label: "Extraction / ventilation" },
  { id: "coffee", label: "Coffee / drinks machine" },
  { id: "till", label: "Till, card machine, printer" },
  { id: "other", label: "Other" },
];
export const equipmentKindLabel = (k: EquipmentKind) => EQUIPMENT_KINDS.find((x) => x.id === k)?.label ?? k;
/** Kit that keeps food safe: a breakdown is critical. */
export const keepsFoodSafe = (k: EquipmentKind) => k === "fridge" || k === "freezer" || k === "hot_holding" || k === "probe";

/** What to do straight away when kit that keeps food safe stops working. Follows the site's procedures, no limits here. */
export function faultHint(kind: EquipmentKind): string | undefined {
  if (kind === "fridge" || kind === "freezer") return "Move the food to a working fridge or freezer, tell the manager on shift, and note anything that had to be thrown away.";
  if (kind === "hot_holding") return "Move the food to working hot holding or follow the reheating procedure, and tell the manager on shift.";
  if (kind === "probe") return "Use the spare probe for temperature checks and tell the manager on shift.";
  return undefined;
}

export interface Equipment {
  id: string; siteId: SiteId; name: string; kind: EquipmentKind;
  location?: string; makeModel?: string; serial?: string;
  /** Months between services; undefined: no regular service. */
  serviceEveryMonths?: number;
  /** Who to call: company and phone. */
  serviceContact?: string;
  /** Short operating or cleaning instructions shown when someone scans it. */
  instructions?: string;
  createdAt: number; retiredAt?: number;
}

export type EventKind = "fault" | "update" | "fixed" | "service";
export type Severity = "down" | "attention";
export const SEVERITY_LABEL: Record<Severity, string> = { down: "Not working", attention: "Working, needs attention" };

export interface EquipmentEvent {
  id: string; equipmentId: string; siteId: SiteId; kind: EventKind;
  /** update / fixed: the fault it belongs to. */
  faultId?: string;
  /** fault only. */
  severity?: Severity;
  body: string;
  /** service only: the day of the visit (London date). */
  doneOn?: string;
  createdBy: string; createdByName?: string; createdAt: number;
}

export const NAME_MAX = 60;
export const TEXT_MAX = 500;
export const INSTRUCTIONS_MAX = 1000;

export interface Fault { fault: EquipmentEvent; updates: EquipmentEvent[]; fixed?: EquipmentEvent }

/** Faults with their updates and fix, newest first. */
export function faultsOf(events: EquipmentEvent[]): Fault[] {
  return events.filter((e) => e.kind === "fault")
    .map((f) => ({
      fault: f,
      updates: events.filter((e) => e.kind === "update" && e.faultId === f.id).sort((a, b) => a.createdAt - b.createdAt),
      fixed: events.find((e) => e.kind === "fixed" && e.faultId === f.id),
    }))
    .sort((a, b) => b.fault.createdAt - a.fault.createdAt);
}

export const openFaults = (events: EquipmentEvent[]) => faultsOf(events).filter((f) => !f.fixed);

/** Out of service: an open "not working" fault. Returns when it went down (the oldest open one). */
export function downSince(events: EquipmentEvent[]): number | undefined {
  const down = openFaults(events).filter((f) => f.fault.severity === "down").map((f) => f.fault.createdAt);
  return down.length ? Math.min(...down) : undefined;
}

/** "3 Feb 2027" + n months, kept to the end of a shorter month (31 Jan + 1 month = 28 Feb). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1, 12));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export const SERVICE_SOON_DAYS = 14;
export type ServiceStatus = "none" | "unknown" | "ok" | "soon" | "overdue";

/** When the next service is due: the last service plus the interval. Unknown until a service is recorded. */
export function serviceState(eq: Pick<Equipment, "serviceEveryMonths">, events: EquipmentEvent[], today: string): { status: ServiceStatus; last?: string; due?: string } {
  const last = events.filter((e) => e.kind === "service" && e.doneOn).map((e) => e.doneOn!).sort().at(-1);
  if (!eq.serviceEveryMonths) return { status: "none", last };
  if (!last) return { status: "unknown" };
  const due = addMonths(last, eq.serviceEveryMonths);
  if (due < today) return { status: "overdue", last, due };
  if (due <= addDays(today, SERVICE_SOON_DAYS)) return { status: "soon", last, due };
  return { status: "ok", last, due };
}

/** Hours a piece of kit was out of service between two instants ("not working" faults; open ones count to `to`). */
export function downHours(events: EquipmentEvent[], from: number, to: number): number {
  let ms = 0;
  for (const f of faultsOf(events)) {
    if (f.fault.severity !== "down") continue;
    const start = Math.max(f.fault.createdAt, from);
    const end = Math.min(f.fixed?.createdAt ?? to, to);
    if (end > start) ms += end - start;
  }
  return Math.round((ms / 3_600_000) * 10) / 10;
}

/** "2 h", "3 days": how long something has been going on. */
export function sinceText(fromMs: number, nowMs: number): string {
  const h = Math.max(0, (nowMs - fromMs) / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.floor(h / 24)} days`;
}

export type Checked = { ok: true } | { ok: false; error: string };

/** Anyone signed in who works at the site can see the kit and report a fault. */
export function canUseEquipment(person: Pick<Person, "status" | "access">, siteId: SiteId): boolean {
  return person.status === "active" && person.access.some((a) => a.siteId === siteId);
}

/** Owners and managers of the site keep the register and log services. */
export const canManageEquipment = (person: Pick<Person, "access">, siteId: SiteId) => canManage(person, siteId);

export interface EquipmentInput {
  name: string; kind: EquipmentKind; location?: string; makeModel?: string; serial?: string;
  serviceEveryMonths?: number; serviceContact?: string; instructions?: string;
}

export function validateEquipment(e: EquipmentInput): Checked {
  if (!e.name.trim()) return { ok: false, error: "Give it a name, e.g. Walk-in fridge" };
  if (e.name.length > NAME_MAX) return { ok: false, error: `Keep the name under ${NAME_MAX} characters` };
  if (!EQUIPMENT_KINDS.some((k) => k.id === e.kind)) return { ok: false, error: "Choose what kind of equipment it is" };
  if (e.serviceEveryMonths !== undefined && (!Number.isInteger(e.serviceEveryMonths) || e.serviceEveryMonths < 1 || e.serviceEveryMonths > 60))
    return { ok: false, error: "Service every 1 to 60 months, or leave it blank" };
  return { ok: true };
}

/** A service date can't be in the future or before the kit was added more than 10 years ago. */
export function validateService(doneOn: string, today: string): Checked {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doneOn)) return { ok: false, error: "Choose the date of the service" };
  if (doneOn > today) return { ok: false, error: "That date is in the future" };
  if (doneOn < addDays(today, -3660)) return { ok: false, error: "Check the date" };
  return { ok: true };
}

export interface EquipmentMessage { personId: string; title: string; body: string; dedupeKey: string; url: string }

/** Owners and managers of the site, except one person (the one who did it). */
export function siteManagers<P extends Pick<Person, "id" | "status" | "access">>(people: P[], siteId: SiteId, exceptId?: string): P[] {
  return people.filter((p) => p.status === "active" && p.id !== exceptId && canManage(p, siteId));
}

/** Who to tell about a new fault, and what to say. */
export function faultReportedMessages(eq: Pick<Equipment, "id" | "name" | "siteId" | "location">, fault: Pick<EquipmentEvent, "id" | "severity" | "body">, reporterId: string, reporterName: string,
  people: Pick<Person, "id" | "status" | "access">[]): EquipmentMessage[] {
  const title = `${fault.severity === "down" ? "Not working" : "Needs attention"}: ${eq.name}`;
  const body = `${fault.body}\nReported by ${reporterName}${eq.location ? ` · ${eq.location}` : ""}`;
  return siteManagers(people, eq.siteId, reporterId).map((p) => ({ personId: p.id, title, body, dedupeKey: `fault|${fault.id}|${p.id}`, url: `/equipment/${eq.id}` }));
}

/** Service reminders for managers: two weeks before the due date and once it has passed. Sent once per due date. */
export function serviceReminderMessages(equipment: Equipment[], events: EquipmentEvent[], people: Pick<Person, "id" | "status" | "access">[], siteNames: Partial<Record<SiteId, string>>, today: string): EquipmentMessage[] {
  const out: EquipmentMessage[] = [];
  for (const eq of equipment.filter((e) => !e.retiredAt)) {
    const s = serviceState(eq, events.filter((e) => e.equipmentId === eq.id), today);
    if ((s.status !== "soon" && s.status !== "overdue") || !s.due) continue;
    const stage = s.status === "overdue" ? "overdue" : "soon";
    const days = daysBetween(today, s.due);
    const where = siteNames[eq.siteId] ?? eq.siteId;
    for (const p of siteManagers(people, eq.siteId)) {
      out.push(stage === "overdue"
        ? { personId: p.id, title: `Service overdue: ${eq.name} (${where})`, body: `It was due on ${dayMonthYear(s.due)}.${eq.serviceContact ? ` Contact: ${eq.serviceContact}.` : ""} Log the service in Manage → Equipment once it's done.`, dedupeKey: `service|${eq.id}|${s.due}|overdue|${p.id}`, url: `/equipment/${eq.id}` }
        : { personId: p.id, title: `Service due ${days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`}: ${eq.name} (${where})`, body: `Due on ${dayMonthYear(s.due)}.${eq.serviceContact ? ` Contact: ${eq.serviceContact}.` : ""} Log it in Manage → Equipment once it's done.`, dedupeKey: `service|${eq.id}|${s.due}|soon|${p.id}`, url: `/equipment/${eq.id}` });
    }
  }
  return out;
}

/** Only these paths may be returned to after signing in (the QR labels link to them). */
export function safeNextPath(next: string | undefined | null): string | undefined {
  return next && /^\/equipment\/[A-Za-z0-9-]{1,64}$/.test(next) ? next : undefined;
}
