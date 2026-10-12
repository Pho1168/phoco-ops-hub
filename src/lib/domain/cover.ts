import { canManage } from "./access";
import { sectionName, shiftEnd, shiftStart, type ShiftTimes } from "./reminders";
import { afterQuietHours, shortDay } from "./time";
import { offOn, type TimeOff } from "./timeoff";
import type { Person, SiteId } from "./types";

/**
 * Shift cover. Someone who can't do a published shift asks for cover; people at the same site who work the same
 * section, aren't already working then and aren't off can offer; a manager of the site approves one (or declines).
 * The app never changes the rota sheet: once approved, the manager moves the shift in the sheet, and when the next
 * import shows it moved, the request is done. Requests and offers are kept: they're withdrawn or decided, not deleted.
 */

export type CoverStatus = "open" | "approved" | "declined" | "withdrawn";
export interface CoverOffer { id: string; personId: string; personName: string; createdAt: number; withdrawnAt?: number }
export interface CoverRequest extends ShiftTimes {
  id: string; shiftId: string; siteId: SiteId; siteName: string; personId: string; personName: string; section: string;
  note?: string; status: CoverStatus; createdAt: number;
  coveredBy?: string; coveredByName?: string; decidedBy?: string; decidedByName?: string; decidedAt?: number; decisionNote?: string;
  /** The shift as it is now: cancelled, or given to someone else, once the rota sheet has been changed. */
  shiftCancelled: boolean; shiftPersonId: string;
  offers: CoverOffer[];
}

export const NOTE_MAX = 200;
export const liveOffers = (r: Pick<CoverRequest, "offers">) => r.offers.filter((o) => !o.withdrawnAt);
/** Still in play: open, or approved and waiting for the rota. */
export const isLive = (r: Pick<CoverRequest, "status">) => r.status === "open" || r.status === "approved";

export type Checked = { ok: true } | { ok: false; error: string };
type Shift = ShiftTimes & { id: string; personId: string; siteId: SiteId; section: string; published: boolean; cancelled: boolean };

/** Your own published shift that hasn't started, with no request already in play. */
export function canAskCover(shift: Shift, personId: string, requests: Pick<CoverRequest, "shiftId" | "status">[], now: number): Checked {
  if (shift.personId !== personId) return { ok: false, error: "That isn't your shift" };
  if (!shift.published || shift.cancelled) return { ok: false, error: "That shift isn't on the rota any more" };
  if (now >= shiftStart(shift)) return { ok: false, error: "That shift has already started. Talk to your manager" };
  if (requests.some((r) => r.shiftId === shift.id && isLive(r))) return { ok: false, error: "You've already asked for cover for this shift" };
  return { ok: true };
}

const overlap = (a: ShiftTimes, b: ShiftTimes) => shiftStart(a) < shiftEnd(b) && shiftStart(b) < shiftEnd(a);

/**
 * Who can cover: active, works at the site in that section, not the person asking, not working at any site at the
 * same time, and not on approved time off that day.
 */
export function canCover(p: Pick<Person, "id" | "status" | "access">, r: Pick<CoverRequest, "personId" | "siteId" | "section" | "date" | "start" | "end">,
  theirShifts: ShiftTimes[], theirTimeOff: TimeOff[]): Checked {
  if (p.status !== "active") return { ok: false, error: "Your account isn't active" };
  if (p.id === r.personId) return { ok: false, error: "That's your own shift" };
  const access = p.access.find((a) => a.siteId === r.siteId);
  if (!access || !access.sections.includes(r.section as never)) return { ok: false, error: `Only ${sectionName(r.section).toLowerCase()} staff at that site can cover it` };
  if (theirShifts.some((s) => overlap(s, r))) return { ok: false, error: "You're already working then" };
  if (offOn(theirTimeOff, r.date).length) return { ok: false, error: "You're off that day" };
  return { ok: true };
}

/** Offers are open while the request is open and the shift hasn't started. */
export function canOffer(r: CoverRequest, personId: string, now: number): Checked {
  if (r.status !== "open") return { ok: false, error: r.status === "approved" ? "Someone is already covering it" : "This request has closed" };
  if (now >= shiftStart(r)) return { ok: false, error: "That shift has started" };
  if (liveOffers(r).some((o) => o.personId === personId)) return { ok: false, error: "You've already offered" };
  return { ok: true };
}

/** A manager of the site decides, while it's open and before the shift starts; not their own request (owners excepted). */
export function canDecideCover(actor: Pick<Person, "id" | "access">, r: CoverRequest, coveredBy: string | undefined, now: number): Checked {
  if (!canManage(actor, r.siteId)) return { ok: false, error: "Only a manager of that site can decide this" };
  if (r.status !== "open") return { ok: false, error: "This request has already been decided" };
  if (actor.id === r.personId && !actor.access.some((a) => a.role === "owner")) return { ok: false, error: "Another manager needs to decide your own request" };
  if (coveredBy !== undefined) {
    if (now >= shiftStart(r)) return { ok: false, error: "That shift has already started" };
    if (!liveOffers(r).some((o) => o.personId === coveredBy)) return { ok: false, error: "That person hasn't offered (or has taken their offer back)" };
  }
  return { ok: true };
}

export type CoverState = "open" | "expired" | "approved" | "done" | "declined" | "withdrawn";
/**
 * Where a request stands. Approved is done once the rota shows the shift has moved: the original shift is cancelled or
 * belongs to someone else, and the person covering has a shift overlapping it. An open request whose shift has started
 * has expired.
 */
export function coverState(r: CoverRequest, coverersShifts: ShiftTimes[], now: number): CoverState {
  if (r.status === "declined" || r.status === "withdrawn") return r.status;
  if (r.status === "open") return now >= shiftStart(r) ? "expired" : "open";
  const moved = (r.shiftCancelled || r.shiftPersonId !== r.personId) && coverersShifts.some((s) => overlap(s, r));
  return moved ? "done" : "approved";
}

export const STATE_TEXT: Record<CoverState, string> = {
  open: "Asking for cover", expired: "Not covered", approved: "Approved: rota to update", done: "Covered", declined: "Not approved", withdrawn: "Withdrawn",
};

// ---------- messages ----------

export interface CoverMessage { personId: string; title: string; body: string; dedupeKey: string; url: string }
const when = (r: ShiftTimes) => `${shortDay(r.date)} ${r.start}–${r.end}`;
const managersOf = (people: Pick<Person, "id" | "status" | "access">[], siteId: SiteId, except: string[]) =>
  people.filter((p) => p.status === "active" && !except.includes(p.id) && canManage(p, siteId));

/** Cover messages wait out quiet hours, unless the shift starts within 12 hours (then they go until midnight, like other urgent ones). */
export const coverSendAfter = (now: number, r: ShiftTimes) => afterQuietHours(now, shiftStart(r) - now < 12 * 3_600_000);

/**
 * A new request: the site's managers and owners are told (they decide; if they work that section they can still
 * offer from My shifts), and everyone else who could cover is asked. Each person gets one message.
 */
export function askMessages(r: CoverRequest, candidates: string[], people: Pick<Person, "id" | "status" | "access">[]): CoverMessage[] {
  const quote = r.note ? `\n"${r.note}"` : "";
  const managers = managersOf(people, r.siteId, [r.personId]);
  const told = managers.map((p) => ({ personId: p.id, title: `Cover needed: ${r.personName}`,
    body: `${when(r)} (${sectionName(r.section)}) at ${r.siteName}.${quote}`, dedupeKey: `cover|ask|${r.id}|${p.id}`, url: "/manage/cover" }));
  const asked = candidates.filter((id) => !managers.some((m) => m.id === id)).map((id) => ({ personId: id, title: `Can you cover? ${when(r)} · ${r.siteName}`,
    body: `${r.personName} is asking for cover (${sectionName(r.section)}). Tap to offer.${quote}`, dedupeKey: `cover|ask|${r.id}|${id}`, url: "/me" }));
  return [...told, ...asked];
}

/** Someone offers: the managers (to decide) and the person asking (so they know). */
export function offerMessages(r: CoverRequest, offerId: string, offerer: { id: string; name: string }, people: Pick<Person, "id" | "status" | "access">[]): CoverMessage[] {
  return [
    ...managersOf(people, r.siteId, [offerer.id, r.personId]).map((p) => ({ personId: p.id, title: `${offerer.name} can cover ${r.personName}`,
      body: `${when(r)} (${sectionName(r.section)}) at ${r.siteName}. Approve it in Manage → Shift cover.`, dedupeKey: `cover|offer|${offerId}|${p.id}`, url: "/manage/cover" })),
    { personId: r.personId, title: `${offerer.name} offered to cover your shift`, body: `${when(r)}. Your manager will decide.`, dedupeKey: `cover|offer|${offerId}|${r.personId}`, url: "/me" },
  ];
}

/** The decision goes to the person asking, the person covering, and anyone else who offered. */
export function decisionMessages(r: CoverRequest, decision: "approved" | "declined", coveredBy: { id: string; name: string } | undefined, deciderName: string, note?: string): CoverMessage[] {
  const out: CoverMessage[] = [];
  const key = (id: string) => `cover|decide|${r.id}|${id}`;
  if (decision === "approved" && coveredBy) {
    out.push({ personId: r.personId, title: `Cover approved: ${shortDay(r.date)} ${r.start}`, body: `${coveredBy.name} is covering your ${when(r)} shift. It moves on the rota once ${deciderName} updates the sheet.`, dedupeKey: key(r.personId), url: "/me" });
    out.push({ personId: coveredBy.id, title: `You're covering ${r.personName}'s shift`, body: `${when(r)} (${sectionName(r.section)}) at ${r.siteName}. It shows under My shifts once the rota is updated.`, dedupeKey: key(coveredBy.id), url: "/me" });
  } else {
    out.push({ personId: r.personId, title: `Cover not approved: ${shortDay(r.date)} ${r.start}`, body: `${deciderName}: ${note || "please keep this shift, or talk to your manager."}`, dedupeKey: key(r.personId), url: "/me" });
  }
  for (const o of liveOffers(r).filter((o) => o.personId !== coveredBy?.id)) {
    out.push({ personId: o.personId, title: "Thanks for offering", body: decision === "approved" ? `${r.personName}'s ${when(r)} shift has been covered.` : `${r.personName}'s ${when(r)} shift is staying with them.`, dedupeKey: key(o.personId), url: "/me" });
  }
  return out;
}

/** The person asking takes it back: managers and anyone who offered are told. */
export function withdrawMessages(r: CoverRequest, people: Pick<Person, "id" | "status" | "access">[]): CoverMessage[] {
  const managers = new Set(managersOf(people, r.siteId, [r.personId]).map((p) => p.id));
  const to = new Set([...Array.from(managers), ...liveOffers(r).map((o) => o.personId)]);
  return Array.from(to).map((id) => ({ personId: id, title: "Cover no longer needed", body: `${r.personName} will do their ${when(r)} shift after all.`,
    dedupeKey: `cover|withdraw|${r.id}|${id}`, url: managers.has(id) ? "/manage/cover" : "/me" }));
}
