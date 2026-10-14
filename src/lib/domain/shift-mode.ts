import { phoneNote, shiftEnd, shiftStart, todaysShifts, type ShiftTimes } from "./reminders";
import { sectionsFor } from "./staff";
import { londonHM, londonToUtc } from "./time";
import type { Area, Person, Site, SiteId } from "./types";

/**
 * Shift Mode: your role + your shift = your screen.
 *
 * After sign-in the app looks up the person's shift on today's published rota (site, section, start and end) and
 * shows only that shift's things, in time order: the check due now, prep for them or their section, handover notes
 * for them, allergen changes to confirm, training due, the gas check at close for closers. Nothing to find. The
 * three lanes are the sections the app already has: Kitchen (BOH), Front of house (FOH) and Production (PROD).
 * Managers see every lane that has people on today, side by side.
 *
 * The rota decides the screen, so when someone isn't on it (or the sheet has gone quiet) the tablet never dead-ends:
 * they pick a lane from their sections instead (`laneChoices`). The rules here are pure; the loader in
 * src/lib/shift-service.ts gathers the inputs and the screen in src/app/shift/ only reads them.
 */

export type Lane = Area;
export const LANES: Lane[] = ["BOH", "FOH", "PROD"];
export const LANE_NAME: Record<Lane, string> = { BOH: "Kitchen", FOH: "Front of house", PROD: "Production" };
export const laneName = (l: Lane) => LANE_NAME[l];

/** A check is "now" from this long before it's due; "late" from the moment it's due until it's signed. */
export const SOON_MIN = 45;
/** A shift still counts as yours for this long after it ends: the handover is written after the last order. */
export const SHIFT_GRACE_MIN = 45;
/** Checks due this long either side of the shift belong to it (an opening checklist due at 11:00 for a 11:30 start). */
export const WINDOW_MARGIN_MIN = 60;

export interface RotaShift extends ShiftTimes { id: string; personId: string; siteId: SiteId; section: string }

export interface MyShift { id: string; siteId: SiteId; lane: Lane; date: string; start: string; end: string; startsAt: number; endsAt: number }

/** The lane a rota section means. The sheet's section is free text, so anything unknown falls back to the person's own section at the site. */
export function laneOf(section: string, fallback: Lane[] = []): Lane | undefined {
  const s = section.trim().toUpperCase();
  if (s === "FOH" || s === "BOH" || s === "PROD") return s;
  if (s.startsWith("KITCHEN") || s === "CHEF" || s === "KP") return "BOH";
  if (s.startsWith("FRONT") || s === "BAR" || s === "SERVICE") return "FOH";
  if (s.startsWith("PROD")) return "PROD";
  return fallback[0];
}

/**
 * The shift to show someone now, from their published shifts around today: the one running (or just ended, within
 * the grace), else the next one today (or within 6 hours after midnight). On a tablet only this site's shifts count.
 */
export function shiftNow(shifts: RotaShift[], personId: string, today: string, now: number, siteId?: SiteId, sections: Lane[] = []): MyShift | undefined {
  const mine = todaysShifts(shifts.filter((s) => s.personId === personId && (!siteId || s.siteId === siteId)), today, now);
  const view = (s: RotaShift): MyShift | undefined => {
    const lane = laneOf(s.section, sections);
    return lane ? { id: s.id, siteId: s.siteId, lane, date: s.date, start: s.start, end: s.end, startsAt: shiftStart(s), endsAt: shiftEnd(s) } : undefined;
  };
  const running = mine.filter((s) => shiftStart(s) <= now && now < shiftEnd(s) + SHIFT_GRACE_MIN * 60_000).sort((a, b) => shiftEnd(b) - shiftEnd(a));
  if (running.length) return view(running[0]);
  const next = mine.filter((s) => shiftStart(s) > now).sort((a, b) => shiftStart(a) - shiftStart(b));
  return next.length ? view(next[0]) : undefined;
}

/** The lanes someone may pick when they're not on today's rota: their sections at the site; a manager with none gets the site's. */
export function laneChoices(p: Pick<Person, "access">, site: Pick<Site, "id" | "kind">): Lane[] {
  const access = p.access.find((a) => a.siteId === site.id);
  if (!access) return [];
  const own = access.sections.filter((s): s is Lane => LANES.includes(s));
  return own.length ? own : access.role === "staff" ? [] : sectionsFor(site.kind);
}

// ---------- the items of a shift ----------

export type ItemKind = "check" | "prep" | "note" | "allergen" | "sop" | "training" | "gas" | "ready" | "kit" | "task";
export type ItemState = "late" | "now" | "later" | "whenever" | "done";

export interface ShiftItem {
  kind: ItemKind; id: string; title: string; detail?: string; href: string;
  state: ItemState; urgent: boolean;
  /** When it's due (epoch ms); none for "whenever". */
  dueAt?: number;
  /** "17:30", "by 12:00", "at close". */
  when?: string;
  /** Who it's for, when it's for someone else on the lane. */
  forName?: string;
  /** The words can't go on a phone: read it on the tablet (handover notes). */
  onTablet?: boolean;
  /** For "Done this shift". */
  doneBy?: string; doneAt?: number;
}

export interface ShiftWindow { lane: Lane; date: string; startsAt: number; endsAt: number }

export interface ListToday { id: string; name: string; area: Area; due?: string; signedAt?: number; signedByName?: string; answered: number; total: number }
export interface PrepToday { id: string; name: string; urgent: boolean; assignedTo?: string; assignedToName?: string }
export interface NoteToday { id: string; category: string; body: string; needsAction: boolean; closedAt?: number; assignedTo?: string; assignedToName?: string }
export interface DocToday { id: string; title: string }
export interface GasToday { state: "later" | "due" | "overdue" | "done" | "missed"; closeAt: number; closer: boolean; doneBy?: string; doneAt?: number }
export interface ReadyToday { light: "green" | "amber" | "red"; readyBy: string; headline: string }
export interface KitDown { id: string; name: string; body: string; since: number }
export interface TaskToday { id: string; title: string; priority: number; dueOn?: string; forName?: string }

export interface ShiftInput {
  now: number; date: string; window: ShiftWindow;
  /** Whose screen: their own items come first. None for a manager's lane. */
  personId?: string;
  /** On the site tablet every note shows in full; on a phone the usual phone rules apply (phoneNote). */
  onTablet: boolean;
  lists: ListToday[]; prep: PrepToday[]; notes: NoteToday[];
  allergens: DocToday[]; sops: DocToday[];
  training: { overdue: number; again: number };
  gas?: GasToday; ready?: ReadyToday;
  kitDown: KitDown[]; tasks: TaskToday[];
}

const ORDER: Record<ItemState, number> = { late: 0, now: 1, later: 2, whenever: 3, done: 4 };

/** Everything for this shift, in the order it should be done: late first, then now, then by time, then whenever; done last. */
export function shiftItems(x: ShiftInput): ShiftItem[] {
  const out: ShiftItem[] = [];
  const { now, window: w } = x;
  const margin = WINDOW_MARGIN_MIN * 60_000;
  const inWindow = (t: number) => t >= w.startsAt - margin && t <= w.endsAt + margin;
  const soon = now + SOON_MIN * 60_000;

  for (const l of x.lists) {
    if (l.area !== w.lane) continue;
    const dueAt = l.due ? londonToUtc(x.date, l.due) : undefined;
    const signed = !!l.signedAt;
    // Checks due this shift (either side by an hour); an unsigned one that's overdue belongs to whoever is on now.
    if (dueAt !== undefined && !inWindow(dueAt) && !(dueAt < now && !signed)) continue;
    if (dueAt === undefined && signed) continue;
    const state: ItemState = signed ? "done" : dueAt === undefined ? "whenever" : dueAt <= now ? "late" : dueAt <= soon ? "now" : "later";
    const left = l.total - l.answered;
    out.push({
      kind: "check", id: l.id, title: l.name, href: `/run/${l.id}`, state, urgent: state === "late", dueAt,
      when: dueAt !== undefined ? londonHM(dueAt) : undefined,
      detail: signed ? `Signed ${londonHM(l.signedAt!)}${l.signedByName ? ` · ${l.signedByName}` : ""}` : l.answered ? `${left} of ${l.total} checks left` : `${l.total} checks`,
      doneBy: l.signedByName, doneAt: l.signedAt,
    });
  }

  // Prep: the kitchen and production lanes see the whole outstanding list (theirs first); front of house only what's theirs.
  const mine = (id?: string) => !!x.personId && id === x.personId;
  for (const p of x.prep) {
    if (w.lane === "FOH" && !mine(p.assignedTo)) continue;
    const own = mine(p.assignedTo);
    out.push({ kind: "prep", id: p.id, title: p.name, href: "/handover", state: p.urgent ? "now" : "whenever", urgent: p.urgent,
      forName: !own && p.assignedTo ? p.assignedToName : undefined, detail: own ? "For you" : p.assignedTo ? `For ${p.assignedToName ?? "someone"}` : undefined });
  }

  // Notes that need action: mine, and the ones for nobody in particular. Phone rules keep staff notes and complaint details on the tablet.
  for (const n of x.notes) {
    if (!n.needsAction || n.closedAt) continue;
    const own = mine(n.assignedTo);
    if (!own && n.assignedTo && x.personId) continue;
    const words = x.onTablet ? { text: n.body, onTablet: false } : phoneNote(n);
    out.push({ kind: "note", id: n.id, title: words.text, href: "/handover", state: "whenever", urgent: n.category === "Food safety", onTablet: words.onTablet,
      forName: !own && n.assignedTo ? n.assignedToName : undefined, detail: `${n.category} · ${own ? "for you" : n.assignedTo ? `for ${n.assignedToName ?? "someone"}` : "handover"}` });
  }

  for (const d of x.allergens) out.push({ kind: "allergen", id: d.id, title: `Allergen change: ${d.title}`, detail: "Read it and confirm", href: `/library/allergens/${d.id}`, state: "whenever", urgent: true });
  for (const d of x.sops) out.push({ kind: "sop", id: d.id, title: `Read: ${d.title}`, detail: "A new version to read", href: `/library/${d.id}`, state: "whenever", urgent: false });
  if (x.training.overdue || x.training.again) {
    const parts = [x.training.overdue ? `${x.training.overdue} overdue` : "", x.training.again ? `${x.training.again} to do again` : ""].filter(Boolean).join(", ");
    out.push({ kind: "training", id: "training", title: "Training to do", detail: parts, href: "/library/training", state: "whenever", urgent: x.training.overdue > 0 });
  }

  if (x.ready && w.startsAt <= londonToUtc(x.date, x.ready.readyBy)) {
    const readyAt = londonToUtc(x.date, x.ready.readyBy);
    const state: ItemState = x.ready.light === "green" ? "done" : readyAt <= now ? "late" : readyAt <= soon ? "now" : "later";
    out.push({ kind: "ready", id: "ready", title: `Ready to open by ${x.ready.readyBy}`, detail: x.ready.headline, href: "/today", state, urgent: state === "late", dueAt: readyAt, when: `by ${x.ready.readyBy}` });
  }

  if (x.gas && x.gas.state !== "missed" && (x.gas.closer || !x.personId)) {
    const state: ItemState = x.gas.state === "done" ? "done" : x.gas.state === "overdue" ? "late" : x.gas.state === "due" ? "now" : "later";
    out.push({ kind: "gas", id: "gas", title: "Gas check at close", detail: x.gas.state === "done" ? `Checked${x.gas.doneBy ? ` by ${x.gas.doneBy}` : ""}${x.gas.doneAt ? ` at ${londonHM(x.gas.doneAt)}` : ""}` : "Every burner off: one tap",
      href: "/today", state, urgent: state === "late", dueAt: x.gas.closeAt, when: "at close", doneBy: x.gas.doneBy, doneAt: x.gas.doneAt });
  }

  for (const k of x.kitDown) out.push({ kind: "kit", id: k.id, title: `Not working: ${k.name}`, detail: k.body, href: `/equipment/${k.id}`, state: "now", urgent: true });
  for (const t of x.tasks) out.push({ kind: "task", id: t.id, title: t.title, detail: t.forName ? `For ${t.forName}` : undefined, href: "/today", state: t.priority <= 1 ? "now" : "whenever", urgent: t.priority <= 2,
    when: t.dueOn && t.dueOn <= x.date ? "today" : undefined });

  // Late first, then now, then by time, then whenever; done last. Within that: urgent first, what's for you before
  // what's for others, and otherwise the order things were gathered in (the handover's own order for notes and prep).
  const own = (i: ShiftItem) => Number(i.detail === "For you" || i.detail?.endsWith("for you"));
  return out.map((item, index) => ({ item, index })).sort(({ item: a, index: ia }, { item: b, index: ib }) =>
    ORDER[a.state] - ORDER[b.state] || Number(b.urgent) - Number(a.urgent) || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity)
    || own(b) - own(a) || (b.doneAt ?? 0) - (a.doneAt ?? 0) || ia - ib).map(({ item }) => item);
}

export interface ShiftSummary { done: number; late: number; toCome: number }

export function shiftSummary(items: ShiftItem[]): ShiftSummary {
  return {
    done: items.filter((i) => i.state === "done").length,
    late: items.filter((i) => i.state === "late").length,
    toCome: items.filter((i) => i.state !== "done" && i.state !== "late").length,
  };
}

/** The one thing to do first: the most overdue, else the next due, else the first urgent item. */
export const firstUp = (items: ShiftItem[]): ShiftItem | undefined => items.find((i) => i.state === "late") ?? items.find((i) => i.state === "now") ?? items.find((i) => i.state === "later" && i.dueAt !== undefined);

// ---------- the manager's lanes ----------

export interface LaneOn { personId: string; name: string; start: string; end: string; shiftId: string }
export interface LaneWindow extends ShiftWindow { on: LaneOn[] }

/**
 * The lanes with people on at the site today, each spanning from its first start to its last end, FOH first as on
 * the rota. A lane with nobody on isn't shown: there's nobody to do its things.
 */
export function lanesToday(shifts: (RotaShift & { name: string })[], siteId: SiteId, today: string, now: number): LaneWindow[] {
  const on = todaysShifts(shifts.filter((s) => s.siteId === siteId), today, now);
  const out: LaneWindow[] = [];
  for (const lane of LANES) {
    const theirs = on.filter((s) => laneOf(s.section) === lane).sort((a, b) => shiftStart(a) - shiftStart(b) || a.name.localeCompare(b.name));
    if (!theirs.length) continue;
    out.push({ lane, date: today, startsAt: Math.min(...theirs.map(shiftStart)), endsAt: Math.max(...theirs.map(shiftEnd)),
      on: theirs.map((s) => ({ personId: s.personId, name: s.name, start: s.start, end: s.end, shiftId: s.id })) });
  }
  const order: Lane[] = ["FOH", "BOH", "PROD"];
  return out.sort((a, b) => order.indexOf(a.lane) - order.indexOf(b.lane));
}

/** "16:00–23:00" */
export const windowLabel = (w: Pick<ShiftWindow, "startsAt" | "endsAt">) => `${londonHM(w.startsAt)}–${londonHM(w.endsAt)}`;
