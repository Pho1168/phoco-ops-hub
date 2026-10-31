import { brandOf } from "@/lib/domain/brand";
import { store } from "@/lib/data";
import { isKitchen } from "@/lib/domain/stock-count";
import type { Store } from "@/lib/data/store";
import { readyFor, gasFor, type DayShift, type GasNow } from "@/lib/daily-service";
import { periodAt, periodBounds } from "@/lib/domain/assign";
import { progress } from "@/lib/domain/checklist";
import { gasDay, readyHeadline, readyShownUntil, type Ready } from "@/lib/domain/daily";
import { faultsOf } from "@/lib/domain/equipment";
import { currentNotes } from "@/lib/domain/handover";
import { latestReplies, replyOpen, replyText, todaysShifts, type ShiftReply } from "@/lib/domain/reminders";
import {
  firstUp, laneChoices, lanesToday, shiftItems, shiftNow, shiftSummary, type Lane, type LaneWindow, type ListToday, type MyShift, type RotaShift,
  type ShiftInput, type ShiftItem, type ShiftSummary, type ShiftWindow,
} from "@/lib/domain/shift-mode";
import { isForPerson, taskOrder } from "@/lib/domain/tasks";
import { addDays, londonDate } from "@/lib/domain/time";
import type { Person, Site, SiteId } from "@/lib/domain/types";
import { allergenChangesToConfirm, sopsToRead } from "@/lib/library-service";
import type { Ctx } from "@/lib/session";
import { myTraining } from "@/lib/training-service";

/**
 * Read-only: gathers what Shift Mode's rules need (src/lib/domain/shift-mode.ts) for one person's shift, or for a
 * manager's lane. Nothing is written here; the screen's buttons call the same actions the rest of the app uses.
 */

export interface OnLane { shiftId: string; personId: string; name: string; time: string; reply?: { text: string; tone: "done" | "late" | "bad" } }

export interface ShiftView {
  site: Site; window: ShiftWindow; items: ShiftItem[]; summary: ShiftSummary; first?: ShiftItem;
  /** The person's own rota shift, when they're on one (not when they picked a lane). */
  shift?: MyShift;
  /** Replying to today's shift: open from the start of the day until it ends. */
  reply?: { shiftId: string; started: boolean; current?: { text: string; tone: string } };
  gas?: GasNow; ready?: Ready;
  /** Who's on this lane today, for a manager's view. */
  on: OnLane[];
}

/** Today's and the surrounding days' published shifts: last night's still going and tonight's after midnight count too. */
type DayRota = DayShift & RotaShift & { name: string };

async function shiftsAroundToday(today: string, db: Store): Promise<DayRota[]> {
  const [rows, people] = await Promise.all([db.shiftsOnDate(addDays(today, -1), addDays(today, 1)), db.people()]);
  const names = new Map(people.map((p) => [p.id, p.name]));
  return rows.map((s) => ({ ...s, name: names.get(s.personId) ?? s.staffCode }));
}

async function gather(site: Site, window: ShiftWindow, person: Person | undefined, onTablet: boolean, isManager: boolean, now: number, db: Store,
  shifts: DayRota[]): Promise<Pick<ShiftView, "items" | "summary" | "first" | "gas" | "ready">> {
  const today = londonDate(now);
  const [all, people, prepOn, prepItems, notes, sent, kit, kitOpen, alerts, tasks] = await Promise.all([
    db.checklists(site.id), db.people(), db.prepEnabledSites(), db.prepItems(brandOf(site).id), db.handover(site.id), db.prepHandovers(site.id, 2),
    db.equipment(site.id), db.equipmentEvents({ siteId: site.id, openFaultsOnly: true }), db.alerts(site.id), db.tasks({ siteIds: [site.id] }),
  ]);
  const names = new Map(people.map((p) => [p.id, p.name]));
  const runs = await Promise.all(all.map((l) => db.run(l.id, today)));
  const lists: ListToday[] = all.map((l, i) => {
    const p = progress(l, runs[i].answers);
    return { id: l.id, name: l.name, area: l.area, due: l.due, signedAt: runs[i].signedAt, signedByName: runs[i].signedBy ? names.get(runs[i].signedBy!) : undefined, answered: p.answered, total: p.total };
  });
  const prep = prepOn.includes(site.id) ? await db.prepOutstanding(site.id) : [];
  const itemNames = new Map(prepItems.map((i) => [i.id, i.name]));
  const sentTimes = sent.map((h) => h.submittedAt!).filter((t) => t !== undefined);
  const openNotes = currentNotes(notes, sentTimes, now);
  const [allergens, sops, training] = person
    ? await Promise.all([allergenChangesToConfirm(person, db), sopsToRead(person, db), myTraining(person, [site], db).then((t) => t.tally)])
    : [[], [], { overdue: 0, again: 0 }];
  const known = { shifts: shifts.filter((s) => s.siteId === site.id), kit, openFaults: kitOpen, alerts, people };
  const readyShown = !!site.readyBy && now < readyShownUntil(today, site.readyBy);
  const [gas, ready] = await Promise.all([
    gasFor(site, now, db, known),
    readyShown ? readyFor(site, now, db, { ...known, lists: lists.map((l) => ({ name: l.name, due: l.due, signed: !!l.signedAt })) }, { forStaff: !isManager }) : undefined,
  ]);
  // The stock report at close, for whoever is on until the kitchen closes (as for the gas check).
  let stockReport: ShiftInput["stockReport"];
  if (site.stockReminder !== false && site.status === "open") {
    const day = gasDay(site.id, today, known.shifts, undefined, site.gasBy);
    if (day) {
      const sent = (await db.stockReports([site.id], now - 86_400_000)).filter((r) => r.date === today).sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0))[0];
      stockReport = { closeAt: day.closeAt, closer: !!person && day.closers.includes(person.id), sentBy: sent?.personName, sentAt: sent?.submittedAt };
    }
  }
  // The production count at close, at a production kitchen, for whoever is on until it closes.
  let productionCount: ShiftInput["productionCount"];
  if (isKitchen(site) && site.status === "open") {
    const day = gasDay(site.id, today, known.shifts, undefined, site.gasBy);
    if (day) {
      const counted = (await db.stockCounts(site.id, now - 86_400_000)).filter((c) => c.date === today).sort((a, b) => a.createdAt - b.createdAt)[0];
      productionCount = { closeAt: day.closeAt, closer: !!person && day.closers.includes(person.id), sentBy: counted?.countedByName, sentAt: counted?.createdAt };
    }
  }
  const kitDown = kit.flatMap((eq) => {
    const f = faultsOf(kitOpen.filter((e) => e.equipmentId === eq.id)).filter((x) => x.fault.severity === "down");
    return f.length ? [{ id: eq.id, name: eq.name, body: f[f.length - 1].fault.body, since: Math.min(...f.map((x) => x.fault.createdAt)) }] : [];
  });
  // A lane's tasks: its section's, anyone's, and a named person's when they work this lane here.
  const sectionsOf = (id: string) => people.find((p) => p.id === id)?.access.find((a) => a.siteId === site.id)?.sections ?? [];
  const inLane = (t: (typeof tasks)[number]) => t.assigneeId ? sectionsOf(t.assigneeId).includes(window.lane) : !t.section || t.section === window.lane;
  const openTasks = tasks.filter((t) => t.status === "open" && (person ? isForPerson(t, person) : inLane(t))).sort(taskOrder(today));
  const input: ShiftInput = {
    now, date: today, window, personId: person?.id, onTablet,
    lists,
    prep: prep.map((e) => ({ id: e.id, name: itemNames.get(e.itemId) ?? "Prep item", urgent: e.urgent, assignedTo: e.assignedTo, assignedToName: e.assignedToName })),
    notes: openNotes.map((n) => ({ id: n.id, category: n.category, body: n.body, needsAction: n.needsAction, closedAt: n.closedAt, assignedTo: n.assignedTo, assignedToName: n.assignedToName })),
    allergens: allergens.map((d) => ({ id: d.id, title: d.published?.title ?? d.code })),
    sops: sops.map((d) => ({ id: d.id, title: d.published?.title ?? d.code })),
    training,
    gas: gas ? { state: gas.state, closeAt: gas.day.closeAt, closer: !!person && gas.day.closers.includes(person.id), doneBy: gas.check?.personName, doneAt: gas.check?.createdAt } : undefined,
    ready: ready ? { light: ready.light, readyBy: ready.readyBy, headline: readyHeadline(ready) } : undefined,
    stockReport,
    productionCount,
    kitDown,
    tasks: openTasks.map((t) => ({ id: t.id, title: t.title, priority: t.priority, dueOn: t.dueOn, forName: person ? undefined : t.assigneeName ?? (t.section ? undefined : "anyone on shift") })),
  };
  const items = shiftItems(input);
  return { items, summary: shiftSummary(items), first: firstUp(items), gas, ready };
}

/** The period someone who picked a lane is working: this morning (05:00–15:00) or this evening (15:00–05:00). */
function periodWindow(lane: Lane, now: number): ShiftWindow {
  const p = periodAt(now);
  const [startsAt, endsAt] = periodBounds(p);
  return { lane, date: p.date, startsAt, endsAt };
}

export type MyShiftResult =
  | { kind: "shift"; view: ShiftView }
  /** Not on today's rota here: the lanes they may pick from (none: they work elsewhere, or have no section). */
  | { kind: "pick"; choices: Lane[]; elsewhere?: { site: Site; start: string; end: string } };

/**
 * The screen for one person: their shift on today's rota (at this site on a tablet; anywhere on their own phone),
 * else the lanes they can pick. `lane`: a lane they picked, for the current morning or evening.
 */
export async function myShift(ctx: Ctx, opts: { onTablet: boolean; lane?: Lane; now?: number }, db: Store = store()): Promise<MyShiftResult> {
  const now = opts.now ?? Date.now();
  const today = londonDate(now);
  const [shifts, sites] = await Promise.all([shiftsAroundToday(today, db), db.sites()]);
  const sections = ctx.access.sections.filter((s): s is Lane => s === "FOH" || s === "BOH" || s === "PROD");
  const mine = shiftNow(shifts, ctx.person.id, today, now, opts.onTablet ? ctx.site.id : undefined, sections);
  const site = (mine && sites.find((s) => s.id === mine.siteId)) || ctx.site;
  if (!mine && !opts.lane) {
    const elsewhere = opts.onTablet ? shiftNow(shifts, ctx.person.id, today, now, undefined, sections) : undefined;
    const other = elsewhere ? sites.find((s) => s.id === elsewhere.siteId) : undefined;
    return { kind: "pick", choices: laneChoices(ctx.person, ctx.site), elsewhere: elsewhere && other ? { site: other, start: elsewhere.start, end: elsewhere.end } : undefined };
  }
  const window: ShiftWindow = mine ? { lane: mine.lane, date: mine.date, startsAt: mine.startsAt, endsAt: mine.endsAt } : periodWindow(opts.lane!, now);
  const isManager = ctx.isOwner || ctx.isManager;
  const gathered = await gather(site, window, ctx.person, opts.onTablet, isManager, now, db, shifts);
  let reply: ShiftView["reply"];
  if (mine && replyOpen(mine, now)) {
    const latest = latestReplies(await db.shiftReplies([mine.id])).get(mine.id);
    const TONE: Record<ShiftReply["kind"], string> = { on_my_way: "done", late: "late", cant_make_it: "bad" };
    reply = { shiftId: mine.id, started: now >= mine.startsAt, current: latest ? { text: replyText(latest), tone: TONE[latest.kind] } : undefined };
  }
  const on = laneOn(shifts.filter((s) => s.siteId === site.id), window.lane, today, now, new Map());
  return { kind: "shift", view: { site, window, shift: mine, reply, on, ...gathered } };
}

function laneOn(shifts: (RotaShift & { name: string })[], lane: Lane, today: string, now: number, replies: Map<string, ShiftReply>): OnLane[] {
  const w = lanesToday(shifts, shifts[0]?.siteId ?? "EAS", today, now).find((l) => l.lane === lane);
  const TONE = { on_my_way: "done", late: "late", cant_make_it: "bad" } as const;
  return (w?.on ?? []).map((p) => {
    const r = replies.get(p.shiftId);
    return { shiftId: p.shiftId, personId: p.personId, name: p.name, time: `${p.start}–${p.end}`, reply: r ? { text: replyText(r), tone: TONE[r.kind] } : undefined };
  });
}

/**
 * A manager's view of the site: every lane with people on today, side by side, each with its things in time order
 * and who's on it (with their late / can't-make-it replies). Empty when nobody is on the rota today.
 */
export async function siteLanes(site: Site, now = Date.now(), db: Store = store()): Promise<{ lane: LaneWindow; view: ShiftView }[]> {
  const today = londonDate(now);
  const shifts = await shiftsAroundToday(today, db);
  const lanes = lanesToday(shifts, site.id, today, now);
  if (!lanes.length) return [];
  const replies = latestReplies(await db.shiftReplies(todaysShifts(shifts.filter((s) => s.siteId === site.id), today, now).map((s) => s.id)));
  return Promise.all(lanes.map(async (lane) => {
    const gathered = await gather(site, lane, undefined, true, true, now, db, shifts);
    return { lane, view: { site, window: lane, on: laneOn(shifts.filter((s) => s.siteId === site.id), lane.lane, today, now, replies), ...gathered } };
  }));
}

/** The lanes a site could show a manager who's viewing as a section, with nobody on: the site's own sections. */
export const siteLaneIds = (site: Pick<Site, "kind">): Lane[] => (site.kind === "production" ? ["PROD"] : ["FOH", "BOH"]);

export type { Lane, SiteId };
