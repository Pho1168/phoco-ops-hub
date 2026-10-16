"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { cleanNewSite } from "@/lib/domain/sites";
import { canPurchase, canReportAt, canSeeTask, orderingSites, runsOrdering, cleanLines as cleanStockLines, cleanPrice as cleanStockPrice, cleanProduct, cleanSupplier, methodOf as stockMethodOf, onProductionTeam,
  reqCode as stockReqCode, runsPurchasing, taskCode as stockTaskCode } from "@/lib/domain/stock";
import { driverTick, giveToDriver, neededView, notifyTask, routeProduction, sendProductionCount, sendStockReport, stockSince, tickNeeded } from "@/lib/stock-service";
import { canCount, changedTargets, cleanTargets, COUNT_MAX, COUNT_NOTE_MAX, countProducts, isKitchen, plansProduction } from "@/lib/domain/stock-count";
import { DEMO_MODE, store } from "@/lib/data";
import { canUseDeviceForSite, formatPairCode, makePairCode, normalizePairCode, PAIR_TTL_MINUTES } from "@/lib/domain/devices";
import { currentDevice, DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE, newDeviceToken, sha256 } from "@/lib/device";
import { pushToPerson } from "@/lib/push";
import { rotaScript } from "@/lib/rota-script";
import { headers } from "next/headers";
import { randomInt } from "node:crypto";
import { canFreeze, canManage, canSignIn, canSwitchTo, isOwner, isPinLocked, managedSites, planSiteClosure, registerPinFailure, remoteSignIn } from "@/lib/domain/access";
import { canCancel, canDecide, clashes, kindLabel, rangeLabel, timeOffDeciders, validateRequest } from "@/lib/domain/timeoff";
import { canPostTo, inAudience, NOTICE_BODY_MAX, NOTICE_TITLE_MAX } from "@/lib/domain/notices";
import { afterQuietHours, dayMonthYear, isIsoDate, londonDate } from "@/lib/domain/time";
import { canEditCerts, certType, validateCert, CERT_KINDS, type CertKind } from "@/lib/domain/certificates";
import { canComplete, categoryLabel, isForPerson, priorityCode, validateTask, TASK_CATEGORIES, type Priority, type TaskCategory } from "@/lib/domain/tasks";
import { canManageEquipment, canUseEquipment, faultReportedMessages, faultsOf, siteManagers, validateEquipment, validateService,
  EQUIPMENT_KINDS, INSTRUCTIONS_MAX, NAME_MAX, SEVERITY_LABEL, TEXT_MAX, type EquipmentKind } from "@/lib/domain/equipment";
import { deliverDue, queueShiftReminders } from "@/lib/rota-service";
import { canReply, replyMessages, replySendAfter, replyText, sameReply, type LateMinutes } from "@/lib/domain/reminders";
import { gasConfirmedMessages } from "@/lib/domain/daily";
import { gasFor } from "@/lib/daily-service";
import { askMessages, canAskCover, canCancelCover, canDecideCover, canOffer, canWithdraw, cancelMessages, coverSendAfter, decisionMessages, NOTE_MAX, offerMessages,
  offerWithdrawnMessages, withdrawMessages, type CoverMessage } from "@/lib/domain/cover";
import { canCoverNow, coverCandidates } from "@/lib/cover-service";
import { canDiscard, canDraft, canEditDraft, canReinstate, canRetire, canReview, canWithdraw as canTakeBack, changeFor, CHANGE_TEXT, cleanSop, codePrefix, docReach,
  dropPhotos, isKind, photoIds, readsAny, readyForReview, validReviewBy, type LibraryBody, type LibraryKind, type SopBody } from "@/lib/domain/library";
import { alertedAt, allergenAlert, cleanRecipe, recipeReady, type DishBody, type PrepBody } from "@/lib/domain/recipes";
import { canConfirmNow, canEditTraining, canMarkDone, canTakeBackNow, cleanGuide, cleanPathway, cleanQuestion, cleanSkill, gradeQuiz, guidePhotoIds, managesTraining, passport, PATHWAY_TEXT,
  quizOf, quizVersion, TRAINING_LIMITS, type PassportRow } from "@/lib/domain/training";
import { trainingData } from "@/lib/training-service";
import { canSignOff, evaluateAnswer } from "@/lib/domain/checklist";
import { AREA_TEXT, canEditChecklists, canPublish, cleanItems, cleanSettings, describeChange, templateId, toDraftItems } from "@/lib/domain/checklist-edit";
import { hashPin, isValidPin, PIN_RULE, verifyPin } from "@/lib/domain/pin";
import { canEditPrepList, canLinkRecipe, canRetirePrepItem, canUndo, canUsePrep, cleanPrepItem, kindLabel as prepKindLabel, moveTarget, planSubmit, shiftLabel } from "@/lib/domain/prep";
import { NOTE_CATEGORIES } from "@/lib/domain/handover";
import { canBeGiven, noteCanBeFor } from "@/lib/domain/assign";
import { accountsFor, canChangeAccess, canGiveAccess, canManageAccount, canMarkLeft, canRejoin, canUnfreeze, normalizeStaffCode, ROLES, sectionsFor, validatePersonInput } from "@/lib/domain/staff";
import type { Person, Role, SiteId } from "@/lib/domain/types";
import { current, londonNow, requireCtx, requireLead, SESSION_COOKIE, SESSION_TTL_MS, type Ctx } from "@/lib/session";

const SiteIdZ = z.string().regex(/^[A-Z]{2,5}$/);
/** Someone still on the temporary PIN an owner gave them chooses their own before doing anything. */
const MUST_CHANGE_PIN = "Choose your own PIN first: tap Change my PIN";
export type ActionResult = { ok: true } | { ok: false; error: string };

export async function signIn(siteId: string, personId: string, pin: string): Promise<ActionResult> {
  const db = store();
  const site = await db.site(SiteIdZ.parse(siteId));
  const person = await db.person(personId);
  if (!site || !person) return { ok: false, error: "Choose your name again" };
  const now = Date.now();
  const device = await currentDevice();
  if (!DEMO_MODE) {
    const d = canUseDeviceForSite(device, site.id);
    if (!d.allowed) return { ok: false, error: d.reason };
  }
  const gate = canSignIn(person, site, now);
  if (!gate.allowed) return { ok: false, error: gate.reason };
  if (!verifyPin(pin, person.pinHash)) {
    await db.updatePerson(person.id, registerPinFailure(person, now));
    await db.audit({ actorId: person.id, siteId: site.id, action: "signin.failed", detail: `Wrong PIN${device ? ` on ${device.label}` : ""}` });
    return { ok: false, error: "That PIN doesn't match. Try again" };
  }
  await startSession(person.id, site.id, device?.id);
  await db.audit({ actorId: person.id, siteId: site.id, action: "signin", detail: device ? `Signed in on ${device.label}` : "Signed in" });
  return { ok: true };
}

/** "My shifts" on a personal phone stays signed in for 60 days so reminders lead straight to it. */
const SHIFTS_TTL_MS = 60 * 24 * 60 * 60 * 1000;

async function startSession(personId: string, siteId: SiteId, deviceId?: string, scope: "full" | "shifts" = "full") {
  const db = store();
  await db.updatePerson(personId, { pinFailed: 0, pinLockedUntil: undefined });
  const ttl = scope === "shifts" ? SHIFTS_TTL_MS : SESSION_TTL_MS;
  const s = await db.createSession(personId, siteId, ttl, deviceId, scope);
  (await cookies()).set(SESSION_COOKIE, s.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: ttl / 1000, path: "/" });
}

/**
 * Sign-in by staff ID + PIN on a device that isn't a registered site tablet (someone's own phone or computer).
 * Owners and operations managers get the full app. Everyone else gets "My shifts" only: their own shifts and
 * messages, no names, no checklists. The error is the same "not recognised" for every failure, so the screen gives
 * nothing away.
 */
export async function staffIdSignIn(staffCode: string, pin: string): Promise<ActionResult> {
  const db = store();
  const code = normalizeStaffCode(z.string().max(20).parse(staffCode));
  const notRecognised = { ok: false as const, error: "Staff ID or PIN not recognised" };
  const person = code ? (await db.people()).find((p) => normalizeStaffCode(p.staffCode) === code) : undefined;
  if (!person || !person.access.length) return notRecognised;
  const landing = remoteSignIn(person, await db.sites());
  if (!landing) return notRecognised;
  const { site, scope } = landing;
  const now = Date.now();
  const gate = canSignIn(person, site, now);
  if (!gate.allowed) return { ok: false, error: gate.reason };
  if (!verifyPin(pin, person.pinHash)) {
    await db.updatePerson(person.id, registerPinFailure(person, now));
    await db.audit({ actorId: person.id, action: "signin.failed", detail: "Wrong PIN (staff ID sign-in, unregistered device)" });
    return notRecognised;
  }
  if (scope === "full") {
    await startSession(person.id, site.id);
    await db.audit({ actorId: person.id, siteId: site.id, action: "signin", detail: `${isOwner(person) ? "Owner" : "Operations manager"} signed in on an unregistered device` });
  } else {
    await startSession(person.id, site.id, undefined, "shifts");
    await db.audit({ actorId: person.id, siteId: site.id, action: "signin", detail: "Signed in to My shifts on own phone" });
  }
  return { ok: true };
}

/** Registers this browser as a site tablet using a one-time code from an owner. */
export async function pairDevice(input: string): Promise<ActionResult> {
  const code = normalizePairCode(z.string().max(20).parse(input));
  if (!code) return { ok: false, error: "That code doesn't look right. It's 6 letters and numbers, like ABC-234" };
  const token = newDeviceToken();
  const device = await store().redeemPairing(sha256(code), sha256(token), Date.now());
  if (!device) return { ok: false, error: "Code not recognised, already used or expired. Ask the owner or operations manager for a new one" };
  (await cookies()).set(DEVICE_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: DEVICE_COOKIE_MAX_AGE, path: "/" });
  (await cookies()).delete(SESSION_COOKIE);
  await store().audit({ siteId: device.siteId, action: "device.paired", detail: `${device.label} set up` });
  return { ok: true };
}

export async function signOut() {
  const sid = (await cookies()).get(SESSION_COOKIE)?.value;
  if (sid) {
    const db = store();
    const s = await db.session(sid);
    if (s) await db.revokeSessions({ personId: s.personId, siteId: s.siteId }, "signed out");
  }
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export async function answerItem(listId: string, itemId: string, raw: string | boolean): Promise<ActionResult> {
  const ctx = await requireCtx();
  const db = store();
  const list = await db.checklist(listId);
  if (!list || list.siteId !== ctx.site.id) return { ok: false, error: "Checklist not found" };
  if (!ctx.isManager && !ctx.access.sections.includes(list.area)) return { ok: false, error: "This checklist is for another section" };
  const item = list.items.find((i) => i.id === itemId);
  if (!item) return { ok: false, error: "Check not found" };
  const { date, hm } = londonNow();
  const run = await db.run(listId, date);
  if (run.signedAt) return { ok: false, error: "Already signed off. Add a correction through your manager" };
  const res = evaluateAnswer(item, raw, await db.rules());
  if (!res.ok) return res;
  await db.addAnswer(listId, date, { itemId, value: res.value, outcome: res.outcome, recordedBy: ctx.person.id, capturedAt: Date.now() });
  if (item.type === "temp" && (res.outcome === "warn" || res.outcome === "bad")) {
    await db.raiseAlert({
      siteId: ctx.site.id, level: res.outcome === "bad" ? "critical" : "warning",
      title: `${item.text} at ${res.value}°C`,
      detail: `${list.name} · recorded ${hm} by ${ctx.person.name}`,
      dedupeKey: `${date}|${listId}|${itemId}`,
    });
  }
  if (item.type === "temp") await db.audit({ actorId: ctx.person.id, siteId: ctx.site.id, action: "reading", detail: `${list.name}: ${item.text} ${res.value}°C (${res.outcome})` });
  revalidatePath(`/run/${listId}`);
  return { ok: true };
}

export async function recordAction(listId: string, itemId: string, action: string): Promise<ActionResult> {
  const ctx = await requireCtx();
  const db = store();
  const { date } = londonNow();
  const run = await db.run(listId, date);
  const last = [...run.answers].reverse().find((a) => a.itemId === itemId);
  if (!last) return { ok: false, error: "Record the reading first" };
  await db.addAnswer(listId, date, { ...last, action: action.slice(0, 200), recordedBy: ctx.person.id, capturedAt: Date.now() });
  await db.audit({ actorId: ctx.person.id, siteId: ctx.site.id, action: "corrective_action", detail: `${itemId}: ${action}` });
  revalidatePath(`/run/${listId}`);
  return { ok: true };
}

export async function signOffRun(listId: string, pin: string): Promise<ActionResult> {
  const ctx = await requireCtx();
  const db = store();
  const now = Date.now();
  if (isPinLocked(ctx.person, now)) return { ok: false, error: "Too many wrong PINs. Try again in a few minutes or ask a manager" };
  if (!verifyPin(pin, ctx.person.pinHash)) {
    // Wrong PINs at sign-off count towards the same lockout as the sign-in screen.
    const patch = registerPinFailure(ctx.person, now);
    await db.updatePerson(ctx.person.id, patch);
    await db.audit({ actorId: ctx.person.id, siteId: ctx.site.id, action: "signoff.failed", detail: "Wrong PIN at sign-off" });
    if (isPinLocked(patch, now)) {
      await db.revokeSessions({ personId: ctx.person.id }, "too many wrong PINs at sign-off");
      (await cookies()).delete(SESSION_COOKIE);
      return { ok: false, error: "Too many wrong PINs. You've been signed out for 15 minutes" };
    }
    return { ok: false, error: "PIN doesn't match" };
  }
  if (ctx.person.pinFailed > 0) await db.updatePerson(ctx.person.id, { pinFailed: 0 });
  const list = await db.checklist(listId);
  if (!list) return { ok: false, error: "Checklist not found" };
  const { date } = londonNow();
  const run = await db.run(listId, date);
  const check = canSignOff(list, run.answers, !!run.signedAt);
  if (!check.allowed) return { ok: false, error: check.reason };
  await db.signRun(listId, date, ctx.person.id);
  await db.audit({ actorId: ctx.person.id, siteId: ctx.site.id, action: "run.sign", detail: `Signed off ${list.name}` });
  revalidatePath("/today");
  revalidatePath(`/run/${listId}`);
  return { ok: true };
}

// ---------- handover notes ----------
/** Who a handover item is for: a person's id (the demo's aren't UUIDs), or null for nobody in particular. */
const AssigneeZ = z.string().min(1).max(64).nullable();
const NoteZ = z.object({
  category: z.enum(NOTE_CATEGORIES),
  body: z.string().trim().min(1, "Write the note first").max(1000, "Keep the note under 1000 characters"),
  needsAction: z.boolean(),
  assignee: AssigneeZ.optional(),
});

/** The person a handover item at this site is being given to, if they can be (canBeGiven). */
async function assigneeAt(siteId: SiteId, to: string | null | undefined): Promise<{ ok: true; person?: Person } | { ok: false; error: string }> {
  if (!to) return { ok: true };
  const person = await store().person(to);
  if (!canBeGiven(person, siteId)) return { ok: false, error: "They don't work here any more. Pick someone else" };
  return { ok: true, person };
}

/** A note for the next shift. Shows straight away on the Handover tab and goes on the next handover report. */
export async function addNote(input: unknown): Promise<ActionResult> {
  const ctx = await requireCtx();
  const n = NoteZ.safeParse(input);
  if (!n.success) return { ok: false, error: n.error.issues[0]?.message ?? "That note couldn't be saved" };
  const { assignee, ...note } = n.data;
  if (assignee && !noteCanBeFor(note)) return { ok: false, error: "A note for info isn't for anyone in particular" };
  const to = await assigneeAt(ctx.site.id, assignee);
  if (!to.ok) return to;
  await store().addHandover({ siteId: ctx.site.id, createdBy: ctx.person.id, ...note, assignedTo: to.person?.id });
  await store().audit({ actorId: ctx.person.id, siteId: ctx.site.id, action: "handover.add",
    detail: `${note.needsAction ? "Needs action" : "For info"} · ${note.category}: ${note.body}${to.person ? ` · for ${to.person.name}` : ""}` });
  revalidatePath("/handover"); revalidatePath("/today"); revalidatePath("/me");
  return { ok: true };
}

const AssignZ = z.object({ kind: z.enum(["prep", "note"]), id: z.string().uuid(), to: AssigneeZ });

/**
 * Gives a prep item from the last handover, or a note that needs doing, to someone at the site, or changes who it's
 * for. Anyone signed in on the tablet can (not on a phone: those are read-only). Every change is in the activity log.
 */
export async function assignHandover(input: unknown): Promise<ActionResult> {
  const ctx = await requireCtx();
  const a = AssignZ.safeParse(input);
  if (!a.success) return { ok: false, error: "That change couldn't be saved" };
  const { kind, id, to } = a.data;
  const db = store();
  let what: string, was: { id?: string; name?: string };
  if (kind === "prep") {
    const { error } = await prepCtx();
    if (error) return { ok: false, error };
    const entry = (await db.prepOutstanding(ctx.site.id)).find((e) => e.id === id);
    if (!entry) return { ok: false, error: "That item isn't waiting any more. It may have just been done" };
    what = (await db.prepItems()).find((i) => i.id === entry.itemId)?.name ?? entry.itemId;
    was = { id: entry.assignedTo, name: entry.assignedToName };
  } else {
    const note = (await db.handover(ctx.site.id)).find((n) => n.id === id);
    if (!note || !noteCanBeFor(note)) return { ok: false, error: "That note isn't waiting any more. It may have just been done" };
    what = `${note.category}: ${note.body.slice(0, 80)}`;
    was = { id: note.assignedTo, name: note.assignedToName };
  }
  if ((was.id ?? null) === to) return { ok: true };
  const person = await assigneeAt(ctx.site.id, to);
  if (!person.ok) return person;
  if (!(await db.assignHandover({ kind, id }, ctx.site.id, to, ctx.person.id))) return { ok: false, error: "Someone has just changed this one. Have a look and try again" };
  await db.audit({ actorId: ctx.person.id, siteId: ctx.site.id, action: "handover.assign",
    detail: `${kind === "prep" ? "Prep: " : ""}${what} · for ${person.person?.name ?? "anyone"}${was.id ? ` (was ${was.name ?? "someone"})` : ""}` });
  revalidatePath("/handover"); revalidatePath("/me");
  return { ok: true };
}

/** Ticks a note done, or puts it back within a few minutes if it was a mis-tap. */
export async function setNoteDone(id: string, done: boolean): Promise<ActionResult> {
  const ctx = await requireCtx();
  const noteId = z.string().uuid().safeParse(id);
  if (!noteId.success) return { ok: false, error: "That note isn't on this site's handover" };
  const db = store();
  const note = (await db.handover(ctx.site.id)).find((h) => h.id === noteId.data);
  if (!note) return { ok: false, error: "That note isn't on this site's handover" };
  if (!z.boolean().parse(done) && !canUndo(note.closedAt, Date.now())) return { ok: false, error: "It's too late to undo this one" };
  const changed = done ? await db.closeHandover(note.id, ctx.site.id, ctx.person.id) : await db.reopenHandover(note.id, ctx.site.id);
  if (!changed) return { ok: false, error: done ? "Someone has already done this one" : "This note has already changed" };
  await db.audit({ actorId: ctx.person.id, siteId: ctx.site.id, action: done ? "handover.close" : "handover.reopen",
    detail: `${done ? "Done" : "Put back"}: ${note.category}: ${note.body.slice(0, 120)}` });
  revalidatePath("/handover"); revalidatePath("/today");
  return { ok: true };
}

// ---------- kitchen prep ----------
const PrepShiftZ = z.enum(["next", "tomorrow_am", "tomorrow_pm"]);
const PrepItemZ = z.string().regex(/^kp-\d{3,}$/);
const UuidZ = z.string().uuid();

/** Anyone working at a site where the prep board is switched on. */
async function prepCtx(): Promise<{ ctx: Awaited<ReturnType<typeof requireCtx>>; error?: string }> {
  const ctx = await requireCtx();
  if (!canUsePrep(ctx.access)) return { ctx, error: "You don't work at this site" };
  if (!(await store().prepEnabledSites()).includes(ctx.site.id)) return { ctx, error: `Kitchen prep isn't switched on at ${ctx.site.name}` };
  return { ctx };
}

/**
 * Draft changes save as staff tap, so a refresh or a second phone sees the same draft. Giving an item to someone (or
 * changing who it's for) also marks it needed, and goes in the activity log.
 */
export async function prepEditDraft(input: unknown): Promise<ActionResult> {
  const { ctx, error } = await prepCtx();
  if (error) return { ok: false, error };
  const c = z.object({
    shift: PrepShiftZ.optional(), itemId: PrepItemZ.optional(), needed: z.boolean().optional(),
    urgent: z.boolean().optional(), note: z.string().trim().max(200).nullable().optional(), assignee: AssigneeZ.optional(),
  }).safeParse(input);
  if (!c.success) return { ok: false, error: "That change couldn't be saved" };
  const db = store();
  const item = c.data.itemId ? (await db.prepItems()).find((i) => i.id === c.data.itemId && i.active) : undefined;
  if (c.data.itemId && !item) return { ok: false, error: "That item isn't on the list any more" };
  if (c.data.assignee === undefined) {
    await db.prepEditDraft(ctx.site.id, ctx.person.id, c.data);
    return { ok: true };
  }
  if (!item || c.data.needed === false) return { ok: false, error: "That change couldn't be saved" };
  const to = await assigneeAt(ctx.site.id, c.data.assignee);
  if (!to.ok) return to;
  const before = (await db.prepDraft(ctx.site.id))?.entries.find((e) => e.itemId === item.id);
  await db.prepEditDraft(ctx.site.id, ctx.person.id, { ...c.data, needed: true });
  if ((before?.assignedTo ?? null) !== c.data.assignee) {
    await db.audit({ actorId: ctx.person.id, siteId: ctx.site.id, action: "handover.assign",
      detail: `Prep (handover not sent yet): ${item.name} · for ${to.person?.name ?? "anyone"}${before?.assignedTo ? ` (was ${before.assignedToName ?? "someone"})` : ""}` });
  }
  return { ok: true };
}

export async function prepSubmit(): Promise<ActionResult & { id?: string }> {
  const { ctx, error } = await prepCtx();
  if (error) return { ok: false, error };
  const db = store();
  // "Nothing needed, all stocked" is a valid handover even if nobody tapped anything first.
  if (!(await db.prepDraft(ctx.site.id))) await db.prepEditDraft(ctx.site.id, ctx.person.id, {});
  const draft = await db.prepDraft(ctx.site.id);
  const res = await db.prepSubmit(ctx.site.id, ctx.person.id, planSubmit);
  if (!res || !draft) return { ok: false, error: "This handover has already been submitted. Open the report to see it" };
  const { plan, handoverId } = res;
  const needed = draft.entries.length + plan.carryIn.length;
  if (plan.missed.length) {
    const names = new Map((await db.prepItems()).map((i) => [i.id, i.name]));
    const list = plan.missed.map((e) => names.get(e.itemId) ?? e.itemId);
    await db.raiseAlert({
      siteId: ctx.site.id, level: "warning", dedupeKey: `prep-missed|${handoverId}`,
      title: `${list.length} prep item${list.length > 1 ? "s" : ""} not done last shift`,
      detail: `${list.slice(0, 8).join(", ")}${list.length > 8 ? ` and ${list.length - 8} more` : ""}. Carried into the new handover.`,
    });
  }
  await db.audit({ actorId: ctx.person.id, siteId: ctx.site.id, action: "prep.submit",
    detail: `Kitchen prep handover for ${shiftLabel(draft.shift).toLowerCase()}: ${needed} needed (${plan.carryIn.length + plan.merge.length} carried over), ${plan.stockedCount} confirmed stocked` });
  revalidatePath("/handover"); revalidatePath("/today");
  return { ok: true, id: handoverId };
}

/** Incoming shift ticks an item done, or puts it back within a few minutes if it was a mistake. */
export async function prepSetDone(handoverId: string, entryId: string, done: boolean): Promise<ActionResult> {
  const { ctx, error } = await prepCtx();
  if (error) return { ok: false, error };
  const db = store();
  const h = await db.prepHandover(UuidZ.parse(handoverId));
  const e = h?.siteId === ctx.site.id ? h.entries.find((x) => x.id === UuidZ.parse(entryId)) : undefined;
  if (!e) return { ok: false, error: "That item isn't on this site's handover" };
  if (!done && !canUndo(e.completedAt, Date.now())) return { ok: false, error: "It's too late to undo this one" };
  if (!(await db.prepSetDone(e.id, ctx.site.id, ctx.person.id, z.boolean().parse(done)))) return { ok: false, error: done ? "Someone has already done this one" : "This item has already changed" };
  if (!done) {
    const name = (await db.prepItems()).find((i) => i.id === e.itemId)?.name ?? e.itemId;
    await db.audit({ actorId: ctx.person.id, siteId: ctx.site.id, action: "prep.undo", detail: `Put "${name}" back to outstanding` });
  }
  revalidatePath("/handover"); revalidatePath("/today");
  return { ok: true };
}

// ---------- the handover master list (Manage → Handover list) ----------
const PrepFieldsZ = z.object({ name: z.string().max(200), kind: z.string().max(10), group: z.string().max(200) });

/** Managers, operations managers and the owner, on the full app. */
async function prepListCtx(): Promise<{ ctx: Ctx; error?: string }> {
  const ctx = await requireCtx();
  return canEditPrepList(ctx.person) ? { ctx } : { ctx, error: "Only managers change the handover list" };
}
const listChanged = () => { revalidatePath("/manage/handover-list"); revalidatePath("/handover/prep"); revalidatePath("/handover"); };

/** Adds an item to the handover list (`id` null), or renames it or moves it to another list or group. */
export async function savePrepItem(id: string | null, input: unknown): Promise<ActionResult & { id?: string }> {
  const { ctx, error } = await prepListCtx();
  if (error) return { ok: false, error };
  const f = PrepFieldsZ.safeParse(input);
  const itemId = id === null ? null : PrepItemZ.safeParse(id);
  if (!f.success || (itemId && !itemId.success)) return { ok: false, error: "That change couldn't be saved" };
  const db = store();
  const items = await db.prepItems();
  const was = itemId ? items.find((i) => i.id === itemId.data) : undefined;
  if (itemId && !was) return { ok: false, error: "That item isn't on the list" };
  if (was && !was.active) return { ok: false, error: "Put it back on the list first" };
  const c = cleanPrepItem(f.data, items, was?.id);
  if (!c.ok) return c;
  const v = c.value;
  if (!was) {
    const newId = await db.addPrepItem(v, ctx.person.id);
    await db.audit({ actorId: ctx.person.id, action: "prep.list.add", detail: `Handover list: added "${v.name}" (${prepKindLabel(v.kind)} · ${v.group})` });
    listChanged();
    return { ok: true, id: newId };
  }
  if (was.name === v.name && was.kind === v.kind && was.group === v.group) return { ok: true, id: was.id };
  await db.updatePrepItem(was.id, v, ctx.person.id);
  await db.audit({ actorId: ctx.person.id, action: "prep.list.edit",
    detail: `Handover list: "${was.name}" (${prepKindLabel(was.kind)} · ${was.group}) is now "${v.name}" (${prepKindLabel(v.kind)} · ${v.group})` });
  listChanged();
  return { ok: true, id: was.id };
}

/** Links a handover item to its recipe sheet (a published prep recipe), or clears the link. */
export async function setPrepItemRecipe(id: string, recipeId: string | null): Promise<ActionResult> {
  const { ctx, error } = await prepListCtx();
  if (error) return { ok: false, error };
  const itemId = PrepItemZ.safeParse(id), docId = z.string().uuid().nullable().safeParse(recipeId);
  if (!itemId.success || !docId.success) return { ok: false, error: "That change couldn't be saved" };
  const db = store();
  const it = (await db.prepItems()).find((i) => i.id === itemId.data);
  if (!it) return { ok: false, error: "That item isn't on the list" };
  let title = "";
  if (docId.data) {
    const doc = await db.libraryDoc(docId.data);
    const can = canLinkRecipe(doc);
    if (!can.ok) return can;
    title = doc!.published!.title;
  }
  if ((it.recipeId ?? null) === docId.data) return { ok: true };
  await db.setPrepItemRecipe(it.id, docId.data, ctx.person.id);
  await db.audit({ actorId: ctx.person.id, action: "prep.list.recipe", detail: docId.data ? `Handover list: "${it.name}" now opens the recipe "${title}"` : `Handover list: "${it.name}" no longer links to a recipe` });
  listChanged();
  return { ok: true };
}

/** Moves an item one place up or down its group. */
export async function movePrepItem(id: string, dir: string): Promise<ActionResult> {
  const { ctx, error } = await prepListCtx();
  if (error) return { ok: false, error };
  const itemId = PrepItemZ.safeParse(id), d = z.enum(["up", "down"]).safeParse(dir);
  if (!itemId.success || !d.success) return { ok: false, error: "That change couldn't be saved" };
  const db = store();
  const items = await db.prepItems();
  const other = moveTarget(items, itemId.data, d.data);
  if (!other) return { ok: true }; // already first or last
  if (!(await db.swapPrepItems(itemId.data, other.id, ctx.person.id))) return { ok: false, error: "The list has just changed. Have a look and try again" };
  const it = items.find((i) => i.id === itemId.data)!;
  await db.audit({ actorId: ctx.person.id, action: "prep.list.move", detail: `Handover list: moved "${it.name}" ${d.data} (${it.group})` });
  listChanged();
  return { ok: true };
}

/** Takes an item off the handover list, or puts it back: the owner and operations managers only. */
export async function setPrepItemActive(id: string, active: boolean): Promise<ActionResult> {
  const ctx = await requireCtx();
  if (!canRetirePrepItem(ctx.person)) return { ok: false, error: "Only the owner or an operations manager takes things off the list" };
  const itemId = PrepItemZ.safeParse(id), on = z.boolean().safeParse(active);
  if (!itemId.success || !on.success) return { ok: false, error: "That change couldn't be saved" };
  const db = store();
  const items = await db.prepItems();
  const it = items.find((i) => i.id === itemId.data);
  if (!it) return { ok: false, error: "That item isn't on the list" };
  if (on.data) {
    const clash = cleanPrepItem({ name: it.name, kind: it.kind, group: it.group }, items, it.id);
    if (!clash.ok) return clash;
  }
  if (!(await db.setPrepItemActive(it.id, on.data, ctx.person.id))) return { ok: true };
  await db.audit({ actorId: ctx.person.id, action: on.data ? "prep.list.reinstate" : "prep.list.retire",
    detail: `Handover list: ${on.data ? "put back" : "took off"} "${it.name}" (${prepKindLabel(it.kind)} · ${it.group})` });
  listChanged();
  return { ok: true };
}

/** Closing and reopening sites and connecting rota sheets stay with the owner. */
async function requireOwner() {
  const ctx = await requireCtx();
  if (!ctx.isOwner) redirect("/shift");
  return ctx;
}

/** Who did it, for the reason a session ended. */
const byWhom = (ctx: { isOwner: boolean }) => (ctx.isOwner ? "owner" : "operations manager");

/** The person whose account an owner or operations manager is changing, if they may. */
async function accountFor(ctx: { person: Person }, personId: string): Promise<{ ok: true; target: Person } | { ok: false; error: string }> {
  const target = await store().person(z.string().max(64).parse(personId));
  if (!target) return { ok: false, error: "Person not found" };
  const can = canManageAccount(ctx.person, target);
  return can.ok ? { ok: true, target } : can;
}

export async function closeSite(siteId: string, typedName: string, reason: string): Promise<ActionResult> {
  const ctx = await requireOwner();
  const db = store();
  const site = await db.site(SiteIdZ.parse(siteId));
  if (!site) return { ok: false, error: "Site not found" };
  if (typedName.trim().toLowerCase() !== site.name.toLowerCase()) return { ok: false, error: `Type ${site.name} exactly to confirm` };
  if (!reason.trim()) return { ok: false, error: "Add a reason" };
  const people = await db.people();
  const open = new Set((await db.sites()).filter((s) => s.status === "open" && s.id !== site.id).map((s) => s.id)) as Set<SiteId>;
  const plan = planSiteClosure(site.id, people, open);
  await db.setSiteStatus(site.id, "closed", reason.trim());
  for (const id of plan.freeze) {
    const p = await db.person(id);
    if (p?.status === "active") await db.updatePerson(id, { status: "frozen", frozenReason: `site:${site.id}` });
  }
  const ended = await db.revokeSessions({ siteId: site.id, exceptPersonIds: plan.untouched }, `site closed: ${reason.trim()}`);
  await db.audit({ actorId: ctx.person.id, siteId: site.id, action: "site.close", detail: `${reason.trim()} · ${plan.freeze.length} frozen · ${plan.endSessionsOnly.length} kept other sites · ${ended} sessions ended` });
  revalidatePath("/owner");
  return { ok: true };
}

/**
 * The owner adds a site: open straight away, with every owner given owner access there so they can work at it. Its
 * team, rota sheet, tablet and checklists are set up afterwards with the existing tools.
 */
export async function createSite(input: { id: string; name: string; kind: string; readyBy?: string; gasBy?: string }): Promise<ActionResult> {
  const ctx = await requireOwner();
  const db = store();
  const parsed = z.object({ id: z.string().max(10), name: z.string().max(60), kind: z.string().max(20), readyBy: z.string().max(5).optional(), gasBy: z.string().max(5).optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the site's details" };
  const clean = cleanNewSite(parsed.data, await db.sites());
  if (!clean.ok) return clean;
  if (!(await db.createSite(clean.value))) return { ok: false, error: `${clean.value.id} is already a site` };
  for (const p of await db.people()) {
    if (p.status === "active" && isOwner(p) && !p.access.some((a) => a.siteId === clean.value.id)) {
      await db.setAccess(p.id, [...p.access, { siteId: clean.value.id, role: "owner", sections: [] }]);
    }
  }
  await db.audit({ actorId: ctx.person.id, siteId: clean.value.id, action: "site.create", detail: `${clean.value.name} (${clean.value.id}) added as a ${clean.value.kind === "production" ? "production kitchen" : "restaurant"}` });
  revalidatePath("/owner");
  return { ok: true };
}

/** The owner sets when a site's kitchen closes ("HH:MM"), or clears it (""): the gas check is due then. */
export async function setKitchenClose(siteId: string, value: string): Promise<ActionResult> {
  const ctx = await requireOwner();
  const db = store();
  const site = await db.site(SiteIdZ.parse(siteId));
  if (!site) return { ok: false, error: "Site not found" };
  const parsed = z.union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)]).safeParse(value.trim());
  if (!parsed.success) return { ok: false, error: "Enter a time like 21:30" };
  const next = parsed.data || null;
  if (next === (site.gasBy ?? null)) return { ok: true };
  await db.setSiteGasBy(site.id, next);
  await db.audit({ actorId: ctx.person.id, siteId: site.id, action: "site.kitchen_close", detail: next ? `Kitchen closes at ${next}${site.gasBy ? ` (was ${site.gasBy})` : " (was the end of the last shift)"}: the gas check is due then` : `Kitchen close time cleared (was ${site.gasBy}): the gas check is due when the last shift ends` });
  revalidatePath("/owner");
  return { ok: true };
}

export async function reopenSite(siteId: string): Promise<ActionResult> {
  const ctx = await requireOwner();
  const db = store();
  const id = SiteIdZ.parse(siteId);
  await db.setSiteStatus(id, "open");
  // Unfreeze only people frozen by this closure; individually frozen accounts stay frozen.
  for (const p of await db.people()) {
    if (p.status === "frozen" && p.frozenReason === `site:${id}`) await db.updatePerson(p.id, { status: "active", frozenReason: undefined });
  }
  await db.audit({ actorId: ctx.person.id, siteId: id, action: "site.reopen", detail: "Site reopened" });
  revalidatePath("/owner");
  return { ok: true };
}

export async function setFrozen(personId: string, frozen: boolean): Promise<ActionResult> {
  const ctx = await requireLead();
  const db = store();
  const found = await accountFor(ctx, personId);
  if (!found.ok) return found;
  const target = found.target;
  if (frozen) {
    const ok = canFreeze(ctx.person, target, await db.people());
    if (!ok.allowed) return { ok: false, error: ok.reason };
    // "owner" means frozen on its own (not by a site closure), whoever did it; the activity log says who.
    await db.updatePerson(target.id, { status: "frozen", frozenReason: "owner" });
    await db.revokeSessions({ personId: target.id }, `account frozen by ${byWhom(ctx)}`);
  } else {
    const ok = canUnfreeze(ctx.person, target);
    if (!ok.ok) return ok;
    await db.updatePerson(target.id, { status: "active", frozenReason: undefined });
  }
  await db.audit({ actorId: ctx.person.id, action: frozen ? "person.freeze" : "person.unfreeze", detail: target.name });
  revalidatePath("/owner");
  return { ok: true };
}

export async function logOutEverywhere(personId: string): Promise<ActionResult> {
  const ctx = await requireLead();
  const db = store();
  const found = await accountFor(ctx, personId);
  if (!found.ok) return found;
  const n = await db.revokeSessions({ personId: found.target.id }, `logged out by ${byWhom(ctx)}`);
  await db.audit({ actorId: ctx.person.id, action: "person.logout", detail: `${found.target.name}: ${n} sessions ended` });
  revalidatePath("/owner");
  return { ok: true };
}

/** A manager of the alert's site says what was done about it. */
export async function resolveAlert(id: string, note: string): Promise<ActionResult> {
  const ctx = await requireCtx();
  if (!note.trim()) return { ok: false, error: "Say what was done" };
  const alertId = z.string().max(64).parse(id);
  const db = store();
  const siteIds = ctx.isOwner ? (await db.sites()).map((s) => s.id) : managedSites(ctx.person);
  const mine = (await Promise.all(siteIds.map((s) => db.alerts(s)))).flat();
  const alert = mine.find((a) => a.id === alertId);
  if (!alert) return { ok: false, error: "Only managers of that site can resolve its alerts" };
  if (alert.resolvedAt) return { ok: false, error: "That alert has already been resolved" };
  await db.resolveAlert(alert.id, ctx.person.id, note.trim().slice(0, 500));
  await db.audit({ actorId: ctx.person.id, siteId: alert.siteId, action: "alert.resolve", detail: `${alert.title}: ${note.trim()}` });
  revalidatePath("/owner"); revalidatePath("/today"); revalidatePath("/manage/tasks");
  return { ok: true };
}

/** Owners and operations managers move their session to another site they have access to. */
export async function switchSite(siteId: string): Promise<void> {
  const ctx = await requireLead();
  const db = store();
  const id = SiteIdZ.parse(siteId);
  const site = await db.site(id);
  if (!site || !canSwitchTo(ctx.person, site)) redirect("/owner");
  await db.revokeSessions({ personId: ctx.person.id, siteId: ctx.site.id }, "switched site");
  const prev = await db.session(ctx.sessionId);
  const s = await db.createSession(ctx.person.id, id, SESSION_TTL_MS, prev?.deviceId);
  (await cookies()).set(SESSION_COOKIE, s.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: SESSION_TTL_MS / 1000, path: "/" });
  redirect("/today");
}

// ---------- staff management (owners; operations managers for staff and managers at their sites) ----------

const AccessZ = z.array(z.object({
  siteId: SiteIdZ,
  role: z.enum(ROLES as [Role, ...Role[]]),
  sections: z.array(z.enum(["FOH", "BOH", "PROD"])).max(3),
})).max(3);
const PersonZ = z.object({ staffCode: z.string().max(20), name: z.string().max(80), access: AccessZ });
const describeAccess = (a: z.infer<typeof AccessZ>) => a.map((x) => `${x.siteId} ${x.role}${x.sections.length ? ` (${x.sections.join("+")})` : ""}`).join(", ");

export async function createPerson(input: unknown, tempPin: string): Promise<ActionResult & { id?: string }> {
  const ctx = await requireLead();
  const db = store();
  const parsed = PersonZ.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Some details are missing" };
  const people = await db.people();
  const checked = validatePersonInput(parsed.data, await db.sites(), people, undefined, (p) => accountsFor(ctx.person, [p]).length > 0);
  if (!checked.ok) return checked;
  const allowed = canGiveAccess(ctx.person, checked.value.access);
  if (!allowed.ok) return allowed;
  if (!isValidPin(tempPin)) return { ok: false, error: `Temporary PIN: ${PIN_RULE}` };
  const id = await db.createPerson({ ...checked.value, pinHash: hashPin(tempPin), pinMustChange: true });
  await db.audit({ actorId: ctx.person.id, action: "person.create", detail: `Added ${checked.value.name} (${checked.value.staffCode}): ${describeAccess(checked.value.access)}` });
  revalidatePath("/owner");
  return { ok: true, id };
}

export async function updatePerson(personId: string, input: unknown): Promise<ActionResult> {
  const ctx = await requireLead();
  const db = store();
  const found = await accountFor(ctx, personId);
  if (!found.ok) return found;
  const target = found.target;
  const parsed = PersonZ.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Some details are missing" };
  const people = await db.people();
  const checked = validatePersonInput(parsed.data, await db.sites(), people, target.id, (p) => accountsFor(ctx.person, [p]).length > 0);
  if (!checked.ok) return checked;
  const given = canGiveAccess(ctx.person, checked.value.access);
  if (!given.ok) return given;
  const allowed = canChangeAccess(ctx.person, target, checked.value.access, people);
  if (!allowed.ok) return allowed;
  const accessChanged = describeAccess(target.access) !== describeAccess(checked.value.access);
  await db.updatePerson(target.id, { name: checked.value.name, staffCode: checked.value.staffCode });
  if (accessChanged) {
    await db.setAccess(target.id, checked.value.access);
    // New access takes effect on next sign-in (never for the owner making the change, so they aren't thrown out).
    if (target.id !== ctx.person.id) await db.revokeSessions({ personId: target.id }, "access changed");
  }
  await db.audit({ actorId: ctx.person.id, action: "person.update", detail: `${checked.value.name} (${checked.value.staffCode})${accessChanged ? `: ${describeAccess(checked.value.access)}` : ": details updated"}` });
  revalidatePath("/owner");
  revalidatePath(`/staff/${target.id}`);
  return { ok: true };
}

export async function resetPin(personId: string, tempPin: string): Promise<ActionResult> {
  const ctx = await requireLead();
  const db = store();
  if (z.string().max(64).parse(personId) === ctx.person.id) return { ok: false, error: "Change your own PIN from \"My PIN\" instead" };
  const found = await accountFor(ctx, personId);
  if (!found.ok) return found;
  const target = found.target;
  if (!isValidPin(tempPin)) return { ok: false, error: `Temporary PIN: ${PIN_RULE}` };
  await db.updatePerson(target.id, { pinHash: hashPin(tempPin), pinMustChange: true, pinFailed: 0, pinLockedUntil: undefined });
  await db.revokeSessions({ personId: target.id }, `PIN reset by ${byWhom(ctx)}`);
  await db.audit({ actorId: ctx.person.id, action: "person.pin_reset", detail: `Temporary PIN set for ${target.name}` });
  revalidatePath(`/staff/${target.id}`);
  return { ok: true };
}

export async function setLeft(personId: string, left: boolean): Promise<ActionResult> {
  const ctx = await requireLead();
  const db = store();
  const found = await accountFor(ctx, personId);
  if (!found.ok) return found;
  const target = found.target;
  if (left) {
    const allowed = canMarkLeft(ctx.person, target, await db.people());
    if (!allowed.ok) return allowed;
    await db.updatePerson(target.id, { status: "left", frozenReason: undefined });
    await db.revokeSessions({ personId: target.id }, "marked as left");
  } else {
    const ok = canRejoin(target);
    if (!ok.ok) return ok;
    await db.updatePerson(target.id, { status: "active", frozenReason: undefined });
  }
  await db.audit({ actorId: ctx.person.id, action: left ? "person.left" : "person.rejoined", detail: target.name });
  revalidatePath("/owner");
  revalidatePath(`/staff/${target.id}`);
  return { ok: true };
}

// ---------- my PIN (everyone) ----------

export async function changeMyPin(currentPin: string, nextPin: string, confirmPin: string): Promise<ActionResult> {
  const ctx = await current();
  if (!ctx) redirect("/login");
  const db = store();
  const now = Date.now();
  if (isPinLocked(ctx.person, now)) return { ok: false, error: "Too many wrong PINs. Try again in a few minutes or ask a manager" };
  if (!verifyPin(currentPin, ctx.person.pinHash)) {
    const patch = registerPinFailure(ctx.person, now);
    await db.updatePerson(ctx.person.id, patch);
    await db.audit({ actorId: ctx.person.id, siteId: ctx.site.id, action: "pin_change.failed", detail: "Wrong current PIN" });
    if (isPinLocked(patch, now)) {
      await db.revokeSessions({ personId: ctx.person.id }, "too many wrong PINs");
      (await cookies()).delete(SESSION_COOKIE);
      return { ok: false, error: "Too many wrong PINs. You've been signed out for 15 minutes" };
    }
    return { ok: false, error: ctx.person.pinMustChange ? "That isn't the temporary PIN you were given" : "Your current PIN doesn't match" };
  }
  if (!isValidPin(nextPin)) return { ok: false, error: PIN_RULE };
  if (nextPin === currentPin) return { ok: false, error: "Choose a PIN that's different from the current one" };
  if (nextPin !== confirmPin) return { ok: false, error: "The two new PINs don't match" };
  await db.updatePerson(ctx.person.id, { pinHash: hashPin(nextPin), pinMustChange: false, pinFailed: 0, pinLockedUntil: undefined });
  // Sign out other devices that might know the old PIN's session; keep this one.
  await db.revokeSessions({ personId: ctx.person.id, exceptSessionId: ctx.sessionId }, "PIN changed");
  await db.audit({ actorId: ctx.person.id, siteId: ctx.site.id, action: "pin_change", detail: "Changed their PIN" });
  return { ok: true };
}

// ---------- site devices (owners; operations managers at their sites) ----------

export async function createPairingCode(siteId: string, label: string): Promise<ActionResult & { code?: string; expiresAt?: number }> {
  const ctx = await requireLead();
  const db = store();
  const site = await db.site(SiteIdZ.parse(siteId));
  if (!site) return { ok: false, error: "Site not found" };
  if (!ctx.leads.includes(site.id)) return { ok: false, error: "You can only set up tablets at sites you run" };
  const name = z.string().max(80).parse(label).trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "Give the device a name, e.g. Eastcote kitchen tablet" };
  if (name.length > 40) return { ok: false, error: "Keep the name under 40 characters" };
  const code = makePairCode(() => randomInt(0, 1_000_000_000) / 1_000_000_000);
  const expiresAt = Date.now() + PAIR_TTL_MINUTES * 60_000;
  await db.createPairing({ codeHash: sha256(code), siteId: site.id, label: name, createdBy: ctx.person.id, expiresAt });
  await db.audit({ actorId: ctx.person.id, siteId: site.id, action: "device.code", detail: `Set-up code created for ${name}` });
  return { ok: true, code: formatPairCode(code), expiresAt };
}

export async function removeDevice(deviceId: string): Promise<ActionResult> {
  const ctx = await requireLead();
  const db = store();
  const device = await db.device(z.string().max(64).parse(deviceId));
  if (!device) return { ok: false, error: "Device not found" };
  if (!ctx.leads.includes(device.siteId)) return { ok: false, error: "You can only remove tablets at sites you run" };
  await db.setDeviceStatus(device.id, "locked");
  const ended = await db.revokeSessions({ deviceId: device.id }, "device removed");
  await db.audit({ actorId: ctx.person.id, siteId: device.siteId, action: "device.removed", detail: `${device.label} removed · ${ended} sessions ended` });
  revalidatePath("/owner");
  return { ok: true };
}

// ---------- rota sheet connection (owners) ----------

/** Creates (or replaces) the token a site's rota sheet uses, and returns the ready-to-paste script. Shown once. */
export async function connectRotaSheet(siteId: string): Promise<ActionResult & { script?: string }> {
  const ctx = await requireOwner();
  const db = store();
  const site = await db.site(SiteIdZ.parse(siteId));
  if (!site) return { ok: false, error: "Site not found" };
  const token = newDeviceToken();
  await db.setRotaToken(site.id, sha256(token), ctx.person.id);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "phoco-ops-hub.vercel.app";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  await db.audit({ actorId: ctx.person.id, siteId: site.id, action: "rota.connect", detail: `Rota sheet connection created for ${site.name} (any older connection stops working)` });
  revalidatePath("/owner");
  return { ok: true, script: rotaScript(`${proto}://${host}/api/rota/import`, token, site.name) };
}

// ---------- reminders on a personal phone ----------

const PushSubZ = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) });

/** Saves this phone's push subscription and sends a test message. Not allowed on shared site tablets. */
export async function enableReminders(sub: unknown): Promise<ActionResult> {
  const ctx = await current();
  if (!ctx) return { ok: false, error: "Sign in again" };
  if (ctx.person.pinMustChange) return { ok: false, error: MUST_CHANGE_PIN };
  const db = store();
  const session = await db.session(ctx.sessionId);
  if (session?.deviceId) return { ok: false, error: "Turn reminders on from your own phone, not the shared tablet" };
  const parsed = PushSubZ.safeParse(sub);
  if (!parsed.success) return { ok: false, error: "This phone didn't give a usable notification address" };
  await db.savePushSub({ personId: ctx.person.id, endpoint: parsed.data.endpoint, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth });
  await db.audit({ actorId: ctx.person.id, action: "reminders.on", detail: "Turned on rota reminders on a phone" });
  await pushToPerson(ctx.person.id, { title: "Reminders are on", body: "You'll get a message 2 hours before each shift, the evening before, and when your rota changes.", url: "/me" });
  return { ok: true };
}

export async function disableReminders(endpoint: string): Promise<ActionResult> {
  const ctx = await current();
  if (!ctx) return { ok: false, error: "Sign in again" };
  if (ctx.person.pinMustChange) return { ok: false, error: MUST_CHANGE_PIN };
  const db = store();
  const mine = await db.pushSubs(ctx.person.id);
  if (mine.some((s) => s.endpoint === endpoint)) await db.dropPushSub(endpoint);
  return { ok: true };
}

// ---------- shift reminders and replies ----------

/**
 * "Send reminders now" on the overview: everyone starting later today who hasn't had their reminder gets it now.
 * An operations manager sends them for the sites they run.
 */
export async function sendShiftRemindersNow(): Promise<ActionResult & { sent?: number; phones?: number }> {
  const ctx = await requireLead();
  const db = store();
  const now = Date.now();
  const told = await queueShiftReminders(now, db, "now", ctx.leads);
  const phones = told.length ? await deliverDue(now, told) : 0;
  await db.audit({ actorId: ctx.person.id, action: "reminders.send", detail: `Sent shift reminders now to ${told.length} ${told.length === 1 ? "person" : "people"} (${phones} ${phones === 1 ? "phone" : "phones"})` });
  revalidatePath("/owner"); revalidatePath("/today");
  return { ok: true, sent: told.length, phones };
}

const ReplyZ = z.object({
  shiftId: z.string().uuid(),
  kind: z.enum(["on_my_way", "late", "cant_make_it"]),
  lateMinutes: z.union([z.literal(15), z.literal(30), z.literal(45)]).optional(),
}).refine((r) => (r.kind === "late") === (r.lateMinutes !== undefined), "Choose how late you'll be");

/** A person answers their own shift's reminder: on my way, running late, or can't make it. Managers are told about the last two. */
export async function replyToShift(input: unknown): Promise<ActionResult> {
  const ctx = await current();
  if (!ctx) return { ok: false, error: "Sign in again" };
  if (ctx.person.pinMustChange) return { ok: false, error: MUST_CHANGE_PIN };
  const r = ReplyZ.safeParse(input);
  if (!r.success) return { ok: false, error: r.error.issues[0]?.message ?? "That reply couldn't be sent" };
  const db = store();
  const shift = await db.shift(r.data.shiftId);
  if (!shift) return { ok: false, error: "That shift isn't on the rota any more" };
  const now = Date.now();
  const check = canReply(shift, ctx.person.id, now);
  if (!check.ok) return check;
  const reply = { kind: r.data.kind, lateMinutes: r.data.lateMinutes as LateMinutes | undefined };
  // A repeat (second tap, or a retry after something failed) adds nothing, but its messages are queued again below:
  // their keys mean managers are told once, and a retry still reaches them if the first try stopped half way.
  const saved = await db.addShiftReply({ shiftId: shift.id, personId: ctx.person.id, siteId: shift.siteId, ...reply }, (latest) => sameReply(latest, reply));
  const today = londonDate(now);
  const told: string[] = [];
  for (const m of replyMessages(saved.reply, saved.previous, shift, ctx.person.name, await db.people(), today)) {
    if (await db.queueNotice({ personId: m.personId, kind: "reply", title: m.title, body: m.body, dedupeKey: m.dedupeKey, sendAfter: replySendAfter(now, shift), url: m.url })) told.push(m.personId);
  }
  if (told.length) await deliverDue(now, told);
  if (saved.added) await db.audit({ actorId: ctx.person.id, siteId: shift.siteId, action: "shift.reply", detail: `${replyText(reply)}: ${shift.date === today ? "today" : dayMonthYear(shift.date)} ${shift.start}–${shift.end} (${shift.section})` });
  revalidatePath("/me"); revalidatePath("/today"); revalidatePath("/owner");
  return { ok: true };
}

// ---------- gas off at close ----------

/**
 * "All gas is off", from 15 minutes before the last shift ends. On the shop tablet: anyone signed in there, for that
 * site, with their PIN (the record is permanent, so it must be the right name). On their own phone: the closing team,
 * or a manager of the site. The first tap of the day counts; who, when and which kind of device are kept. If managers
 * were already alerted that nobody had checked, they hear it's done.
 */
export async function confirmGasOff(siteId: string, pin?: string): Promise<ActionResult> {
  const ctx = await current();
  if (!ctx) return { ok: false, error: "Sign in again" };
  if (ctx.person.pinMustChange) return { ok: false, error: MUST_CHANGE_PIN };
  const input = z.object({ siteId: SiteIdZ, pin: z.string().max(10).optional() }).safeParse({ siteId, pin });
  if (!input.success) return { ok: false, error: "Choose a site" };
  const db = store();
  const site = await db.site(input.data.siteId);
  if (!site || ctx.person.status !== "active" || !ctx.person.access.some((a) => a.siteId === site.id)) return { ok: false, error: "You can only do the gas check at your own site" };
  const now = Date.now();
  const onTablet = !!(await db.session(ctx.sessionId))?.deviceId;
  if (onTablet) {
    if (ctx.site.id !== site.id) return { ok: false, error: "Do the gas check on that site's tablet" };
    if (isPinLocked(ctx.person, now)) return { ok: false, error: "Too many wrong PINs. Try again in a few minutes or ask a manager" };
    if (!verifyPin(input.data.pin ?? "", ctx.person.pinHash)) {
      const patch = registerPinFailure(ctx.person, now);
      await db.updatePerson(ctx.person.id, patch);
      await db.audit({ actorId: ctx.person.id, siteId: site.id, action: "gas.failed", detail: "Wrong PIN at the gas check" });
      if (isPinLocked(patch, now)) {
        await db.revokeSessions({ personId: ctx.person.id }, "too many wrong PINs at the gas check");
        (await cookies()).delete(SESSION_COOKIE);
        return { ok: false, error: "Too many wrong PINs. You've been signed out for 15 minutes" };
      }
      return { ok: false, error: "PIN doesn't match" };
    }
    if (ctx.person.pinFailed > 0) await db.updatePerson(ctx.person.id, { pinFailed: 0 });
  }
  const g = await gasFor(site, now, db);
  if (!g) return { ok: false, error: "There's no gas check to do right now" };
  if (g.check) return { ok: true }; // already done
  if (!onTablet && !g.day.closers.includes(ctx.person.id) && !canManage(ctx.person, site.id)) return { ok: false, error: "The closing team or a manager does the gas check" };
  if (!(await db.addGasCheck({ siteId: site.id, date: g.day.date, personId: ctx.person.id, onTablet }))) return { ok: true }; // someone has just done it
  const managers = siteManagers(await db.people(), site.id);
  const sentAlert = await db.noticeKeys(managers.map((p) => `gasalert|${site.id}|${g.day.date}|${p.id}`));
  const alerted = managers.filter((p) => sentAlert.has(`gasalert|${site.id}|${g.day.date}|${p.id}`)).map((p) => p.id);
  const told: string[] = [];
  for (const m of gasConfirmedMessages(site, g.day, ctx.person.name, onTablet, now, alerted)) {
    if (await db.queueNotice({ personId: m.personId, kind: "gas", title: m.title, body: m.body, dedupeKey: m.dedupeKey, sendAfter: now, url: m.url })) told.push(m.personId);
  }
  if (told.length) await deliverDue(now, told);
  await db.audit({ actorId: ctx.person.id, siteId: site.id, action: "gas.off", detail: `All gas off at close (${dayMonthYear(g.day.date)}), ${onTablet ? "on the tablet" : "on their own phone"}` });
  revalidatePath("/today"); revalidatePath("/me"); revalidatePath("/owner");
  return { ok: true };
}

// ---------- shift cover ----------

/** Queues cover messages and sends them now (they wait out quiet hours unless the shift is within 12 hours). */
async function sendCover(messages: CoverMessage[], sendAfter: number) {
  const db = store();
  const told: string[] = [];
  for (const m of messages) {
    if (await db.queueNotice({ personId: m.personId, kind: "cover", title: m.title, body: m.body, dedupeKey: m.dedupeKey, sendAfter, url: m.url })) told.push(m.personId);
  }
  if (told.length) await deliverDue(Date.now(), told);
}
const coverPaths = () => { revalidatePath("/me"); revalidatePath("/manage/cover"); revalidatePath("/owner"); revalidatePath("/manage"); };
const shiftText = (r: { date: string; start: string; end: string; section: string }) => `${dayMonthYear(r.date)} ${r.start}–${r.end} (${r.section})`;
const RequestIdZ = z.string().uuid();

/** Ask for cover on one of your own published shifts that hasn't started. Colleagues who could cover are asked; managers are told. */
export async function askCover(shiftId: string, note: string): Promise<ActionResult> {
  const ctx = await current();
  if (!ctx) return { ok: false, error: "Sign in again" };
  if (ctx.person.pinMustChange) return { ok: false, error: MUST_CHANGE_PIN };
  const input = z.object({ shiftId: z.string().uuid(), note: z.string().trim().max(NOTE_MAX, `Keep the note under ${NOTE_MAX} characters`) }).safeParse({ shiftId, note });
  if (!input.success) return { ok: false, error: input.error.issues[0]?.message ?? "That couldn't be sent" };
  const db = store();
  const shift = await db.shift(input.data.shiftId);
  if (!shift) return { ok: false, error: "That shift isn't on the rota any more" };
  const now = Date.now();
  const check = canAskCover(shift, ctx.person.id, await db.coverRequests({ personId: ctx.person.id, live: true }), now);
  if (!check.ok) return check;
  const id = await db.addCoverRequest({ shiftId: shift.id, siteId: shift.siteId, personId: ctx.person.id, section: shift.section, note: input.data.note || undefined });
  if (!id) return { ok: false, error: "You've already asked for cover for this shift" };
  const r = (await db.coverRequest(id))!;
  const candidates = (await coverCandidates(r, now, db)).map((p) => p.id);
  await sendCover(askMessages(r, candidates, await db.people()), coverSendAfter(now, r));
  await db.audit({ actorId: ctx.person.id, siteId: shift.siteId, action: "cover.ask", detail: `Asked for cover: ${shiftText(r)}${r.note ? ` · "${r.note}"` : ""} · ${candidates.length} could cover` });
  coverPaths();
  return { ok: true };
}

/** The person asking takes it back, while it's still open and before the shift starts. */
export async function withdrawCover(requestId: string): Promise<ActionResult> {
  const ctx = await current();
  if (!ctx) return { ok: false, error: "Sign in again" };
  if (ctx.person.pinMustChange) return { ok: false, error: MUST_CHANGE_PIN };
  const id = RequestIdZ.safeParse(requestId);
  if (!id.success) return { ok: false, error: "That request isn't there any more" };
  const db = store();
  const r = await db.coverRequest(id.data);
  if (!r) return { ok: false, error: "That request isn't there any more" };
  const check = canWithdraw(r, ctx.person.id, Date.now());
  if (!check.ok) return check;
  if (!(await db.decideCover(r.id, { status: "withdrawn", personId: ctx.person.id }))) return { ok: false, error: "It has just been decided" };
  await sendCover(withdrawMessages(r, await db.people()), coverSendAfter(Date.now(), r));
  await db.audit({ actorId: ctx.person.id, siteId: r.siteId, action: "cover.withdraw", detail: `Withdrew the cover request: ${shiftText(r)}` });
  coverPaths();
  return { ok: true };
}

/** "I can cover": someone at the same site and section, not working or covering then, not off. Managers and the person asking are told. */
export async function offerCover(requestId: string): Promise<ActionResult> {
  const ctx = await current();
  if (!ctx) return { ok: false, error: "Sign in again" };
  if (ctx.person.pinMustChange) return { ok: false, error: MUST_CHANGE_PIN };
  const rid = RequestIdZ.safeParse(requestId);
  if (!rid.success) return { ok: false, error: "That request isn't there any more" };
  const db = store();
  const r = await db.coverRequest(rid.data);
  if (!r) return { ok: false, error: "That request isn't there any more" };
  const now = Date.now();
  const open = canOffer(r, ctx.person.id, now);
  if (!open.ok) return open;
  const fits = await canCoverNow(ctx.person, r, now, db);
  if (!fits.ok) return fits;
  const id = await db.addCoverOffer(r.id, ctx.person.id);
  if (!id) return { ok: false, error: "You've already offered, or it has just been decided" };
  await sendCover(offerMessages(r, id, { id: ctx.person.id, name: ctx.person.name }, await db.people()), coverSendAfter(now, r));
  await db.audit({ actorId: ctx.person.id, siteId: r.siteId, action: "cover.offer", detail: `Offered to cover ${r.personName}: ${shiftText(r)}` });
  coverPaths();
  return { ok: true };
}

/** Take back an offer while the request is still open. The managers and the person asking are told. */
export async function withdrawOffer(requestId: string): Promise<ActionResult> {
  const ctx = await current();
  if (!ctx) return { ok: false, error: "Sign in again" };
  if (ctx.person.pinMustChange) return { ok: false, error: MUST_CHANGE_PIN };
  const rid = RequestIdZ.safeParse(requestId);
  if (!rid.success) return { ok: false, error: "That request isn't there any more" };
  const db = store();
  const r = await db.coverRequest(rid.data);
  if (!r) return { ok: false, error: "That request isn't there any more" };
  const offerId = await db.withdrawCoverOffer(r.id, ctx.person.id);
  if (!offerId) return { ok: false, error: r.status === "open" ? "You haven't offered on this one" : "It has already been decided" };
  await sendCover(offerWithdrawnMessages(r, offerId, { id: ctx.person.id, name: ctx.person.name }, await db.people()), coverSendAfter(Date.now(), r));
  await db.audit({ actorId: ctx.person.id, siteId: r.siteId, action: "cover.unoffer", detail: `Took back the offer to cover ${r.personName}: ${shiftText(r)}` });
  coverPaths();
  return { ok: true };
}

const CoverDecisionZ = z.object({
  requestId: z.string().uuid(),
  decision: z.enum(["approved", "declined"]),
  coveredBy: z.string().uuid().optional(),
  note: z.string().trim().max(NOTE_MAX, `Keep the note under ${NOTE_MAX} characters`).optional(),
}).refine((d) => (d.decision === "approved") === !!d.coveredBy, "Choose who covers");

/** A manager of the site approves one offer, or declines. The rota sheet is then changed by the manager, not the app. */
export async function decideCover(input: unknown): Promise<ActionResult> {
  const ctx = await requireCtx();
  const d = CoverDecisionZ.safeParse(input);
  if (!d.success) return { ok: false, error: d.error.issues[0]?.message ?? "That couldn't be saved" };
  const db = store();
  const r = await db.coverRequest(d.data.requestId);
  if (!r) return { ok: false, error: "That request isn't there any more" };
  const now = Date.now();
  const check = canDecideCover(ctx.person, r, d.data.coveredBy, now);
  if (!check.ok) return check;
  const coverer = d.data.coveredBy ? await db.person(d.data.coveredBy) : undefined;
  if (d.data.decision === "approved") {
    if (!coverer) return { ok: false, error: "That person isn't on the system any more" };
    const fits = await canCoverNow(coverer, r, now, db, coverer.name);
    if (!fits.ok) return { ok: false, error: `${fits.error}. They can't cover it now` };
  }
  if (!(await db.decideCover(r.id, { status: d.data.decision, personId: ctx.person.id, coveredBy: coverer?.id, note: d.data.note || undefined }))) {
    return { ok: false, error: "It has just been decided, withdrawn or the offer was taken back" };
  }
  await sendCover(decisionMessages(r, d.data.decision, coverer && { id: coverer.id, name: coverer.name }, ctx.person.name, d.data.note || undefined), coverSendAfter(now, r));
  await db.audit({ actorId: ctx.person.id, siteId: r.siteId, action: d.data.decision === "approved" ? "cover.approve" : "cover.decline",
    detail: d.data.decision === "approved" ? `Approved: ${coverer!.name} covers ${r.personName}, ${shiftText(r)}. Rota sheet to update` : `Declined ${r.personName}'s cover request: ${shiftText(r)}${d.data.note ? ` · "${d.data.note}"` : ""}` });
  coverPaths();
  return { ok: true };
}

/** A manager cancels an approved cover (the person covering drops out, plans change): the shift goes back to the person who asked. */
export async function cancelCover(requestId: string, note: string): Promise<ActionResult> {
  const ctx = await requireCtx();
  const input = z.object({ requestId: z.string().uuid(), note: z.string().trim().max(NOTE_MAX, `Keep the note under ${NOTE_MAX} characters`) }).safeParse({ requestId, note });
  if (!input.success) return { ok: false, error: input.error.issues[0]?.message ?? "That couldn't be saved" };
  const db = store();
  const r = await db.coverRequest(input.data.requestId);
  if (!r) return { ok: false, error: "That request isn't there any more" };
  const now = Date.now();
  const check = canCancelCover(ctx.person, r, now);
  if (!check.ok) return check;
  if (!(await db.decideCover(r.id, { status: "cancelled", personId: ctx.person.id, note: input.data.note || undefined }))) return { ok: false, error: "It has just changed. Reload and try again" };
  await sendCover(cancelMessages(r, ctx.person.name, input.data.note || undefined), coverSendAfter(now, r));
  await db.audit({ actorId: ctx.person.id, siteId: r.siteId, action: "cover.cancel", detail: `Cancelled ${r.coveredByName}'s cover of ${r.personName}: ${shiftText(r)}${input.data.note ? ` · "${input.data.note}"` : ""}` });
  coverPaths();
  return { ok: true };
}

// ---------- team notices ----------
const NoticeZ = z.object({
  siteId: SiteIdZ.nullable(),
  sections: z.array(z.enum(["FOH", "BOH", "PROD"])).max(3),
  title: z.string().trim().min(1, "Give the notice a title").max(NOTICE_TITLE_MAX, `Keep the title under ${NOTICE_TITLE_MAX} characters`),
  body: z.string().trim().min(1, "Write the notice").max(NOTICE_BODY_MAX, `Keep the notice under ${NOTICE_BODY_MAX} characters`),
  important: z.boolean(),
  showUntil: z.string().refine(isIsoDate, "Choose a real date").nullable(),
});

/** An owner or manager posts a notice. Important ones also go to the phones of people it's for. */
export async function postNotice(input: unknown): Promise<ActionResult & { sentTo?: number }> {
  const ctx = await requireCtx();
  const managed = managedSites(ctx.person);
  if (!managed.length) return { ok: false, error: "Only owners and managers can post notices" };
  const n = NoticeZ.safeParse(input);
  if (!n.success) return { ok: false, error: n.error.issues[0]?.message ?? "That notice couldn't be posted" };
  const db = store();
  const allSites = (await db.sites()).map((s) => s.id);
  const siteId = n.data.siteId ?? undefined;
  if (!canPostTo(managed, allSites, siteId)) return { ok: false, error: "You can only post to sites you manage" };
  const now = Date.now();
  if (n.data.showUntil && n.data.showUntil < londonDate(now)) return { ok: false, error: "The last day to show it is already past" };
  const id = await db.addTeamNotice({ siteId, sections: n.data.sections, title: n.data.title, body: n.data.body, important: n.data.important, createdBy: ctx.person.id, showUntil: n.data.showUntil ?? undefined });
  await db.readTeamNotice(id, ctx.person.id); // the person posting it has read it
  let sentTo = 0;
  if (n.data.important) {
    const sendAfter = afterQuietHours(now);
    const told: string[] = [];
    for (const p of (await db.people()).filter((p) => p.id !== ctx.person.id && p.status === "active" && inAudience({ siteId, sections: n.data.sections }, p))) {
      if (!(await db.pushSubs(p.id)).length) continue;
      if (await db.queueNotice({ personId: p.id, kind: "notice", title: `Notice: ${n.data.title}`, body: n.data.body.slice(0, 180), dedupeKey: `notice|${id}|${p.id}`, sendAfter })) { sentTo++; told.push(p.id); }
    }
    if (told.length) await deliverDue(now, told);
  }
  await db.audit({ actorId: ctx.person.id, siteId, action: "notice.post", detail: `${n.data.important ? "Important notice" : "Notice"}: ${n.data.title}` });
  revalidatePath("/manage/notices"); revalidatePath("/today"); revalidatePath("/me");
  return { ok: true, sentTo };
}

export async function endNotice(id: string): Promise<ActionResult> {
  const ctx = await requireCtx();
  const db = store();
  const n = (await db.teamNotices()).find((x) => x.id === id);
  if (!n) return { ok: false, error: "That notice isn't there any more" };
  const allSites = (await db.sites()).map((s) => s.id);
  if (!canPostTo(managedSites(ctx.person), allSites, n.siteId)) return { ok: false, error: "Only a manager of that site can take it down" };
  if (!(await db.endTeamNotice(n.id, ctx.person.id))) return { ok: false, error: "It has already been taken down" };
  await db.audit({ actorId: ctx.person.id, siteId: n.siteId, action: "notice.end", detail: `Took down notice: ${n.title}` });
  revalidatePath("/manage/notices"); revalidatePath("/today"); revalidatePath("/me");
  return { ok: true };
}

/** "Got it": works on the shop tablet and on a staff member's own phone. */
export async function readNotice(id: string): Promise<ActionResult> {
  const ctx = await current();
  if (!ctx) return { ok: false, error: "Sign in again" };
  if (ctx.person.pinMustChange) return { ok: false, error: MUST_CHANGE_PIN };
  const db = store();
  const n = (await db.teamNotices()).find((x) => x.id === id);
  if (!n || !inAudience(n, ctx.person)) return { ok: false, error: "That notice isn't for you" };
  await db.readTeamNotice(n.id, ctx.person.id);
  revalidatePath("/today"); revalidatePath("/me"); revalidatePath("/manage/notices");
  return { ok: true };
}

// ---------- time off ----------
const IsoDateZ = z.string().refine(isIsoDate, "Choose a real date");
const TimeOffZ = z.object({
  startsOn: IsoDateZ, endsOn: IsoDateZ,
  kind: z.enum(["holiday", "unpaid", "other"]),
  note: z.string().trim().max(300, "Keep the note under 300 characters").optional(),
});

/**
 * Messages whoever could decide someone's time off at a site (the site's managers, or the owners for an operations
 * manager), never the person themself. Pushed if they have notifications on.
 */
async function tellDeciders(requester: Person, siteId: SiteId, title: string, body: string, dedupeKey: string) {
  const db = store();
  const now = Date.now();
  const told: string[] = [];
  for (const p of timeOffDeciders(await db.people(), requester, siteId)) {
    if (await db.queueNotice({ personId: p.id, kind: "leave", title, body, dedupeKey: `${dedupeKey}|${p.id}`, sendAfter: afterQuietHours(now), url: "/manage/time-off" })) told.push(p.id);
  }
  if (told.length) await deliverDue(now, told);
}

/** Staff ask for time off, from their own phone or the shop tablet. */
export async function requestTimeOff(input: unknown): Promise<ActionResult> {
  const ctx = await current();
  if (!ctx) return { ok: false, error: "Sign in again" };
  if (ctx.person.pinMustChange) return { ok: false, error: MUST_CHANGE_PIN };
  const t = TimeOffZ.safeParse(input);
  if (!t.success) return { ok: false, error: t.error.issues[0]?.message ?? "That request couldn't be sent" };
  const db = store();
  const today = londonDate(Date.now());
  const check = validateRequest(t.data, today, await db.timeOff({ personId: ctx.person.id }));
  if (!check.ok) return check;
  const id = await db.requestTimeOff({ personId: ctx.person.id, siteId: ctx.site.id, ...t.data, note: t.data.note || undefined });
  const onRota = clashes(t.data, (await db.shiftsForPerson(ctx.person.id, t.data.startsOn, t.data.endsOn)).filter((s) => !s.cancelled));
  await tellDeciders(ctx.person, ctx.site.id, `Time off request: ${ctx.person.name}`,
    `${rangeLabel(t.data)} · ${kindLabel(t.data.kind)}${onRota.length ? ` · ${onRota.length} rota shift${onRota.length > 1 ? "s" : ""} on those days` : ""}${t.data.note ? `\n"${t.data.note}"` : ""}`, `timeoff|${id}`);
  await db.audit({ actorId: ctx.person.id, siteId: ctx.site.id, action: "timeoff.request", detail: `Asked for ${rangeLabel(t.data)} (${kindLabel(t.data.kind)})` });
  revalidatePath("/me"); revalidatePath("/manage/time-off");
  return { ok: true };
}

/** A manager approves or declines. The person is told either way. */
export async function decideTimeOff(id: string, decision: "approved" | "declined", note: string): Promise<ActionResult> {
  const ctx = await requireCtx();
  const db = store();
  const t = (await db.timeOff({ siteIds: managedSites(ctx.person) })).find((x) => x.id === id);
  if (!t) return { ok: false, error: "That request isn't there any more" };
  const requester = await db.person(t.personId);
  if (!requester) return { ok: false, error: "That request isn't there any more" };
  const ok = canDecide(ctx.person, t, requester);
  if (!ok.ok) return ok;
  const d = z.enum(["approved", "declined"]).parse(decision);
  const why = z.string().trim().max(300).parse(note ?? "");
  if (!(await db.decideTimeOff(t.id, d, ctx.person.id, why || undefined))) return { ok: false, error: "Someone else has just decided this one" };
  const now = Date.now();
  await db.queueNotice({ personId: t.personId, kind: "leave", title: `Time off ${d === "approved" ? "approved" : "declined"}`,
    body: `${rangeLabel(t)} · ${kindLabel(t.kind)}${why ? `\n${ctx.person.name}: "${why}"` : `\nDecided by ${ctx.person.name}`}`, dedupeKey: `timeoff-decided|${t.id}`, sendAfter: afterQuietHours(now) });
  await deliverDue(now, [t.personId]);
  await db.audit({ actorId: ctx.person.id, siteId: t.siteId, action: `timeoff.${d === "approved" ? "approve" : "decline"}`, detail: `${d === "approved" ? "Approved" : "Declined"} ${t.personName}: ${rangeLabel(t)}${why ? ` (${why})` : ""}` });
  revalidatePath("/manage/time-off"); revalidatePath("/rota"); revalidatePath("/me");
  return { ok: true };
}

/** Staff withdraw a request that's waiting, or approved time off that hasn't started. */
export async function cancelTimeOff(id: string): Promise<ActionResult> {
  const ctx = await current();
  if (!ctx) return { ok: false, error: "Sign in again" };
  if (ctx.person.pinMustChange) return { ok: false, error: MUST_CHANGE_PIN };
  const db = store();
  const t = (await db.timeOff({ personId: ctx.person.id })).find((x) => x.id === id);
  if (!t) return { ok: false, error: "That request isn't there any more" };
  if (!canCancel(t, londonDate(Date.now()))) return { ok: false, error: "This can't be withdrawn now. Speak to your manager" };
  if (t.status !== "pending" && t.status !== "approved") return { ok: false, error: "It has already changed" };
  if (!(await db.cancelTimeOff(t.id, t.status))) return { ok: false, error: "It has just changed. Check it again" };
  if (t.status === "approved") await tellDeciders(ctx.person, t.siteId, `Time off withdrawn: ${ctx.person.name}`, `${rangeLabel(t)} is no longer needed`, `timeoff-withdrawn|${t.id}`);
  await db.audit({ actorId: ctx.person.id, siteId: t.siteId, action: "timeoff.cancel", detail: `Withdrew ${rangeLabel(t)}` });
  revalidatePath("/me"); revalidatePath("/manage/time-off"); revalidatePath("/rota");
  return { ok: true };
}

// ---------- staff certificates ----------
const CertZ = z.object({
  personId: z.string().min(1).max(64),
  kind: z.enum(CERT_KINDS as [CertKind, ...CertKind[]]),
  issuedOn: IsoDateZ,
  expiresOn: z.union([IsoDateZ, z.literal("")]).optional(),
  provider: z.string().trim().max(120, "Keep the provider under 120 characters").optional(),
  reference: z.string().trim().max(120, "Keep the certificate number under 120 characters").optional(),
  note: z.string().trim().max(300, "Keep the note under 300 characters").optional(),
});

/** An owner or a manager of the person's site records a certificate or check. Right to work: owners only. */
export async function addCertificate(input: unknown): Promise<ActionResult> {
  const ctx = await requireCtx();
  const c = CertZ.safeParse(input);
  if (!c.success) return { ok: false, error: c.error.issues[0]?.message ?? "That record couldn't be saved" };
  const db = store();
  const target = await db.person(c.data.personId);
  if (!target) return { ok: false, error: "That person isn't there any more" };
  const can = canEditCerts(ctx.person, target, c.data.kind);
  if (!can.ok) return can;
  const t = certType(c.data.kind);
  const rec = {
    personId: target.id, kind: c.data.kind, issuedOn: c.data.issuedOn, expiresOn: c.data.expiresOn || undefined,
    provider: c.data.provider || undefined, reference: t.noReference ? undefined : c.data.reference || undefined, note: c.data.note || undefined,
  };
  const check = validateCert(rec, londonDate(Date.now()));
  if (!check.ok) return check;
  await db.addCertificate({ ...rec, createdBy: ctx.person.id });
  await db.audit({ actorId: ctx.person.id, siteId: target.access[0]?.siteId, action: "cert.add",
    detail: `${t.label} recorded for ${target.name}${rec.expiresOn && !t.restricted ? ` (runs out ${dayMonthYear(rec.expiresOn)})` : ""}` });
  revalidatePath("/manage/certificates"); revalidatePath(`/manage/certificates/${target.id}`); revalidatePath("/me");
  return { ok: true };
}

/** Takes off a record added by mistake. It stays in the database, marked removed. */
export async function removeCertificate(id: string): Promise<ActionResult> {
  const ctx = await requireCtx();
  const db = store();
  const cert = await db.certificate(String(id ?? "").slice(0, 64));
  if (!cert) return { ok: false, error: "That record isn't there any more" };
  const target = await db.person(cert.personId);
  if (!target) return { ok: false, error: "That person isn't there any more" };
  const can = canEditCerts(ctx.person, target, cert.kind);
  if (!can.ok) return can;
  if (!(await db.removeCertificate(cert.id, ctx.person.id))) return { ok: false, error: "It has already been removed" };
  await db.audit({ actorId: ctx.person.id, siteId: target.access[0]?.siteId, action: "cert.remove", detail: `Removed a ${certType(cert.kind).label} record for ${target.name}` });
  revalidatePath("/manage/certificates"); revalidatePath(`/manage/certificates/${target.id}`); revalidatePath("/me");
  return { ok: true };
}

// ---------- equipment ----------
const opt = (v?: string | null) => (v && v.trim() ? v.trim() : undefined);
const EquipmentZ = z.object({
  name: z.string().trim().min(1, "Give it a name, e.g. Walk-in fridge").max(NAME_MAX, `Keep the name under ${NAME_MAX} characters`),
  kind: z.enum(EQUIPMENT_KINDS.map((k) => k.id) as [EquipmentKind, ...EquipmentKind[]], { errorMap: () => ({ message: "Choose what kind of equipment it is" }) }),
  location: z.string().max(60, "Keep the location under 60 characters").optional(),
  makeModel: z.string().max(80, "Keep the make and model under 80 characters").optional(),
  serial: z.string().max(60, "Keep the serial number under 60 characters").optional(),
  serviceEveryMonths: z.number().int().min(1, "Service every 1 to 60 months, or leave it blank").max(60, "Service every 1 to 60 months, or leave it blank").nullable().optional(),
  serviceContact: z.string().max(200, "Keep the contact under 200 characters").optional(),
  instructions: z.string().max(INSTRUCTIONS_MAX, `Keep the instructions under ${INSTRUCTIONS_MAX} characters`).optional(),
});
const equipmentData = (d: z.infer<typeof EquipmentZ>) => ({
  name: d.name, kind: d.kind, location: opt(d.location), makeModel: opt(d.makeModel), serial: opt(d.serial),
  serviceEveryMonths: d.serviceEveryMonths ?? undefined, serviceContact: opt(d.serviceContact), instructions: opt(d.instructions),
});
const TextZ = (what: string) => z.string().trim().min(1, what).max(TEXT_MAX, `Keep it under ${TEXT_MAX} characters`);
const equipmentPaths = (id?: string) => { revalidatePath("/manage/equipment"); revalidatePath("/equipment"); if (id) revalidatePath(`/equipment/${id}`); revalidatePath("/today"); revalidatePath("/handover"); };

/** A manager adds a piece of kit to their site's register, optionally with the date of its last service. */
export async function addEquipment(siteId: string, input: unknown, lastServicedOn?: string): Promise<ActionResult & { id?: string }> {
  const ctx = await requireCtx();
  const site = SiteIdZ.safeParse(siteId);
  if (!site.success || !canManageEquipment(ctx.person, site.data)) return { ok: false, error: "Only a manager of that site can add equipment" };
  const e = EquipmentZ.safeParse(input);
  if (!e.success) return { ok: false, error: e.error.issues[0]?.message ?? "That couldn't be saved" };
  const data = equipmentData(e.data);
  const check = validateEquipment(data);
  if (!check.ok) return check;
  const today = londonDate(Date.now());
  if (lastServicedOn) { const s = validateService(lastServicedOn, today); if (!s.ok) return { ok: false, error: `Last service: ${s.error.toLowerCase()}` }; }
  const db = store();
  const id = await db.addEquipment({ ...data, siteId: site.data, createdBy: ctx.person.id });
  if (lastServicedOn) await db.addEquipmentEvent({ equipmentId: id, siteId: site.data, kind: "service", body: "Last service, recorded when the equipment was added", doneOn: lastServicedOn, createdBy: ctx.person.id });
  await db.audit({ actorId: ctx.person.id, siteId: site.data, action: "equipment.add", detail: `Added ${data.name} to the equipment register` });
  equipmentPaths(id);
  return { ok: true, id };
}

export async function updateEquipment(id: string, input: unknown): Promise<ActionResult> {
  const ctx = await requireCtx();
  const db = store();
  const eq = await db.equipmentItem(String(id ?? "").slice(0, 64));
  if (!eq || eq.retiredAt) return { ok: false, error: "That equipment isn't on the register any more" };
  if (!canManageEquipment(ctx.person, eq.siteId)) return { ok: false, error: "Only a manager of that site can change it" };
  const e = EquipmentZ.safeParse(input);
  if (!e.success) return { ok: false, error: e.error.issues[0]?.message ?? "That couldn't be saved" };
  const data = equipmentData(e.data);
  const check = validateEquipment(data);
  if (!check.ok) return check;
  await db.updateEquipment(eq.id, data);
  await db.audit({ actorId: ctx.person.id, siteId: eq.siteId, action: "equipment.edit", detail: `Updated the details of ${data.name}${data.name !== eq.name ? ` (was ${eq.name})` : ""}` });
  equipmentPaths(eq.id);
  return { ok: true };
}

/** Takes kit off the register (sold, replaced, broken for good). Its history is kept. */
export async function retireEquipment(id: string): Promise<ActionResult> {
  const ctx = await requireCtx();
  const db = store();
  const eq = await db.equipmentItem(String(id ?? "").slice(0, 64));
  if (!eq || eq.retiredAt) return { ok: false, error: "That equipment isn't on the register any more" };
  if (!canManageEquipment(ctx.person, eq.siteId)) return { ok: false, error: "Only a manager of that site can do that" };
  await db.retireEquipment(eq.id, ctx.person.id);
  await db.audit({ actorId: ctx.person.id, siteId: eq.siteId, action: "equipment.retire", detail: `Took ${eq.name} off the equipment register` });
  equipmentPaths(eq.id);
  return { ok: true };
}

const FaultZ = z.object({ severity: z.enum(["down", "attention"]), body: TextZ("Say what's wrong") });

/** Anyone working at the site reports a problem: on the shop tablet, their own phone, or by scanning the label. Managers are told. */
export async function reportFault(equipmentId: string, input: unknown): Promise<ActionResult> {
  const ctx = await current();
  if (!ctx) return { ok: false, error: "Sign in again" };
  if (ctx.person.pinMustChange) return { ok: false, error: MUST_CHANGE_PIN };
  const db = store();
  const eq = await db.equipmentItem(String(equipmentId ?? "").slice(0, 64));
  if (!eq || eq.retiredAt) return { ok: false, error: "That equipment isn't on the register any more" };
  if (!canUseEquipment(ctx.person, eq.siteId)) return { ok: false, error: "You can only report problems at your own site" };
  const f = FaultZ.safeParse(input);
  if (!f.success) return { ok: false, error: f.error.issues[0]?.message ?? "That couldn't be sent" };
  const id = await db.addEquipmentEvent({ equipmentId: eq.id, siteId: eq.siteId, kind: "fault", severity: f.data.severity, body: f.data.body, createdBy: ctx.person.id });
  const now = Date.now();
  const told: string[] = [];
  for (const m of faultReportedMessages(eq, { id: id!, severity: f.data.severity, body: f.data.body }, ctx.person.id, ctx.person.name, await db.people())) {
    // "Not working" is urgent: it still goes out until midnight.
    if (await db.queueNotice({ personId: m.personId, kind: "fault", title: m.title, body: m.body, dedupeKey: m.dedupeKey, sendAfter: afterQuietHours(now, f.data.severity === "down"), url: m.url })) told.push(m.personId);
  }
  if (told.length) await deliverDue(now, told);
  await db.audit({ actorId: ctx.person.id, siteId: eq.siteId, action: "equipment.fault", detail: `${SEVERITY_LABEL[f.data.severity]}: ${eq.name}: ${f.data.body}` });
  equipmentPaths(eq.id);
  return { ok: true };
}

const FaultUpdateZ = z.object({ body: TextZ("Write what happened"), fixed: z.boolean() });

/** An update on a fault ("engineer booked for Tuesday"), or marking it fixed. On the shop tablet or an owner's device. */
export async function updateFault(equipmentId: string, faultId: string, input: unknown): Promise<ActionResult> {
  const ctx = await requireCtx();
  const db = store();
  const eq = await db.equipmentItem(String(equipmentId ?? "").slice(0, 64));
  if (!eq) return { ok: false, error: "That equipment isn't on the register any more" };
  if (!canUseEquipment(ctx.person, eq.siteId)) return { ok: false, error: "You can only update problems at your own site" };
  const u = FaultUpdateZ.safeParse(input);
  if (!u.success) return { ok: false, error: u.error.issues[0]?.message ?? "That couldn't be saved" };
  const f = faultsOf(await db.equipmentEvents({ equipmentId: eq.id })).find((x) => x.fault.id === faultId);
  if (!f) return { ok: false, error: "That problem isn't there any more" };
  if (f.fixed) return { ok: false, error: "It has already been marked fixed" };
  const id = await db.addEquipmentEvent({ equipmentId: eq.id, siteId: eq.siteId, kind: u.data.fixed ? "fixed" : "update", faultId: f.fault.id, body: u.data.body, createdBy: ctx.person.id });
  if (!id) return { ok: false, error: "Someone has just marked it fixed" };
  if (u.data.fixed && f.fault.severity === "down") {
    const now = Date.now();
    const managers = siteManagers(await db.people(), eq.siteId, ctx.person.id);
    for (const p of managers) {
      await db.queueNotice({ personId: p.id, kind: "fault", title: `Working again: ${eq.name}`, body: `${u.data.body}\nMarked fixed by ${ctx.person.name}`, dedupeKey: `fixed|${f.fault.id}|${p.id}`, sendAfter: afterQuietHours(now), url: `/equipment/${eq.id}` });
    }
    await deliverDue(now, managers.map((p) => p.id));
  }
  await db.audit({ actorId: ctx.person.id, siteId: eq.siteId, action: u.data.fixed ? "equipment.fixed" : "equipment.update", detail: `${eq.name}: ${u.data.fixed ? "fixed" : "update"}: ${u.data.body}` });
  equipmentPaths(eq.id);
  return { ok: true };
}

const ServiceZ = z.object({ doneOn: IsoDateZ, body: TextZ("Say who serviced it and what was done") });

/** A manager logs a service visit; the next one is due the set number of months later. */
export async function logService(equipmentId: string, input: unknown): Promise<ActionResult> {
  const ctx = await requireCtx();
  const db = store();
  const eq = await db.equipmentItem(String(equipmentId ?? "").slice(0, 64));
  if (!eq || eq.retiredAt) return { ok: false, error: "That equipment isn't on the register any more" };
  if (!canManageEquipment(ctx.person, eq.siteId)) return { ok: false, error: "Only a manager of that site can log a service" };
  const s = ServiceZ.safeParse(input);
  if (!s.success) return { ok: false, error: s.error.issues[0]?.message ?? "That couldn't be saved" };
  const check = validateService(s.data.doneOn, londonDate(Date.now()));
  if (!check.ok) return check;
  await db.addEquipmentEvent({ equipmentId: eq.id, siteId: eq.siteId, kind: "service", body: s.data.body, doneOn: s.data.doneOn, createdBy: ctx.person.id });
  await db.audit({ actorId: ctx.person.id, siteId: eq.siteId, action: "equipment.service", detail: `${eq.name} serviced on ${s.data.doneOn}: ${s.data.body}` });
  equipmentPaths(eq.id);
  return { ok: true };
}

// ---------- tasks ----------
const TaskZ = z.object({
  title: z.string().trim().min(1, "Say what needs doing").max(120, "Keep the task under 120 characters"),
  detail: z.string().trim().max(1000, "Keep the details under 1000 characters").optional(),
  priority: z.number().int().min(1).max(4),
  category: z.enum(TASK_CATEGORIES.map((c) => c.id) as [TaskCategory, ...TaskCategory[]]),
  assigneeId: z.string().max(64).optional(),
  section: z.enum(["FOH", "BOH", "PROD"]).optional(),
  dueOn: z.union([IsoDateZ, z.literal("")]).optional(),
});

/** A manager gives a job to a person, a section or everyone at a site. A named person is told; for a P1, everyone it's for is. */
export async function addTask(siteId: string, input: unknown): Promise<ActionResult> {
  const ctx = await requireCtx();
  const site = SiteIdZ.safeParse(siteId);
  if (!site.success || !canManage(ctx.person, site.data)) return { ok: false, error: "Only a manager of that site can add tasks" };
  const t = TaskZ.safeParse(input);
  if (!t.success) return { ok: false, error: t.error.issues[0]?.message ?? "That task couldn't be saved" };
  const db = store();
  const siteRow = await db.site(site.data);
  if (!siteRow) return { ok: false, error: "Unknown site" };
  const data = { title: t.data.title, detail: t.data.detail || undefined, priority: t.data.priority as Priority, category: t.data.category,
    assigneeId: t.data.assigneeId || undefined, section: t.data.section, dueOn: t.data.dueOn || undefined };
  const now = Date.now();
  const check = validateTask(data, londonDate(now));
  if (!check.ok) return check;
  if (data.section && !sectionsFor(siteRow.kind).includes(data.section)) return { ok: false, error: `${siteRow.name} has no ${data.section} section` };
  const people = await db.people();
  const assignee = data.assigneeId ? people.find((p) => p.id === data.assigneeId) : undefined;
  if (data.assigneeId && (!assignee || assignee.status !== "active" || !assignee.access.some((a) => a.siteId === site.data))) return { ok: false, error: "Choose someone who works at that site" };
  const id = await db.addTask({ ...data, siteId: site.data, createdBy: ctx.person.id });
  const due = data.dueOn ? ` · due ${data.dueOn === londonDate(now) ? "today" : data.dueOn}` : "";
  const audience = assignee ? [assignee] : data.priority === 1 ? people.filter((p) => p.id !== ctx.person.id && isForPerson({ siteId: site.data, section: data.section }, p)) : [];
  for (const p of audience) {
    await db.queueNotice({ personId: p.id, kind: "task", title: `New task (${priorityCode(data.priority)}): ${data.title}`,
      body: `${categoryLabel(data.category)}${due}${data.detail ? `\n${data.detail.slice(0, 160)}` : ""}\nFrom ${ctx.person.name}`, dedupeKey: `task|${id}|${p.id}`, sendAfter: afterQuietHours(now, data.priority === 1) });
  }
  if (audience.length) await deliverDue(now, audience.map((p) => p.id));
  await db.audit({ actorId: ctx.person.id, siteId: site.data, action: "task.add", detail: `${priorityCode(data.priority)} task: ${data.title}${assignee ? ` (for ${assignee.name})` : data.section ? ` (for ${data.section})` : ""}` });
  revalidatePath("/manage/tasks"); revalidatePath("/today"); revalidatePath("/me");
  return { ok: true };
}

/** Tick a task done, with an optional note. The people it's for, or a manager of the site. */
export async function completeTask(id: string, note: string): Promise<ActionResult> {
  const ctx = await current();
  if (!ctx) return { ok: false, error: "Sign in again" };
  if (ctx.person.pinMustChange) return { ok: false, error: MUST_CHANGE_PIN };
  const db = store();
  const t = await db.task(String(id ?? "").slice(0, 64));
  if (!t || t.status !== "open") return { ok: false, error: "That task has already been done or taken off" };
  if (!canComplete(t, ctx.person)) return { ok: false, error: "That task isn't yours" };
  const why = z.string().trim().max(300, "Keep the note under 300 characters").safeParse(note ?? "");
  if (!why.success) return { ok: false, error: why.error.issues[0]?.message ?? "Check the note" };
  if (!(await db.completeTask(t.id, ctx.person.id, why.data || undefined))) return { ok: false, error: "Someone has just done it" };
  await db.audit({ actorId: ctx.person.id, siteId: t.siteId, action: "task.done", detail: `Done: ${t.title}${why.data ? ` (${why.data})` : ""}` });
  revalidatePath("/manage/tasks"); revalidatePath("/today"); revalidatePath("/me");
  return { ok: true };
}

/** Undo a mis-tap: only the person who ticked it, within 10 minutes. */
export async function reopenTask(id: string): Promise<ActionResult> {
  const ctx = await current();
  if (!ctx) return { ok: false, error: "Sign in again" };
  if (ctx.person.pinMustChange) return { ok: false, error: MUST_CHANGE_PIN };
  const db = store();
  const t = await db.task(String(id ?? "").slice(0, 64));
  if (!t || t.status !== "done" || t.doneBy !== ctx.person.id || !t.doneAt || Date.now() - t.doneAt > 10 * 60_000) return { ok: false, error: "That can't be undone now" };
  if (!(await db.reopenTask(t.id, ctx.person.id))) return { ok: false, error: "That can't be undone now" };
  await db.audit({ actorId: ctx.person.id, siteId: t.siteId, action: "task.undo", detail: `Undid done: ${t.title}` });
  revalidatePath("/manage/tasks"); revalidatePath("/today"); revalidatePath("/me");
  return { ok: true };
}

/** A manager takes a task off (not needed any more). It's kept, marked cancelled. */
export async function cancelTask(id: string): Promise<ActionResult> {
  const ctx = await requireCtx();
  const db = store();
  const t = await db.task(String(id ?? "").slice(0, 64));
  if (!t || t.status !== "open") return { ok: false, error: "That task has already been done or taken off" };
  if (!canManage(ctx.person, t.siteId)) return { ok: false, error: "Only a manager of that site can take a task off" };
  if (!(await db.cancelTask(t.id, ctx.person.id))) return { ok: false, error: "It has just changed" };
  await db.audit({ actorId: ctx.person.id, siteId: t.siteId, action: "task.cancel", detail: `Took off: ${t.title}` });
  revalidatePath("/manage/tasks"); revalidatePath("/today"); revalidatePath("/me");
  return { ok: true };
}

// ---------- library: SOPs, prep recipes and dishes ----------
const PhotoZ = z.object({ id: z.string().uuid(), w: z.number().int().min(1).max(10_000), h: z.number().int().min(1).max(10_000) });
const StepZ = z.object({ text: z.string().max(3000), warning: z.string().max(1500).optional(), photo: PhotoZ.optional() });
const SopZ = z.object({
  title: z.string().max(300),
  sections: z.array(z.string().max(10)).max(3),
  purpose: z.string().max(3000),
  steps: z.array(StepZ).max(60),
});
const RecipeZ = z.object({
  title: z.string().max(300),
  sections: z.array(z.string().max(10)).max(3),
  category: z.string().max(200),
  items: z.array(z.object({ qty: z.number().finite().nullable(), unit: z.string().max(40), name: z.string().max(300), note: z.string().max(400),
    prep: z.string().max(64).nullable().optional(), photo: PhotoZ.nullable().optional() })).max(120),
  steps: z.array(StepZ).max(60),
  photo: PhotoZ.nullable().optional(),
  allergens: z.record(z.string().max(20), z.string().max(20)).refine((r) => Object.keys(r).length <= 20),
  makes: z.object({ qty: z.number().finite().nullable(), unit: z.string().max(40) }).nullable().optional(),
  storage: z.string().max(1000).optional(),
  shelfLife: z.object({ qty: z.number().finite().nullable(), unit: z.string().max(10) }).nullable().optional(),
  notes: z.string().max(3000).optional(),
  callouts: z.array(z.object({ x: z.number().finite(), y: z.number().finite(), text: z.string().max(200) })).max(20).optional(),
  standards: z.array(z.string().max(400)).max(20).optional(),
  modifications: z.string().max(3000).optional(),
  dietary: z.array(z.string().max(20)).max(5).optional(),
});
const KindZ = z.enum(["sop", "prep", "dish"]);
const LibIdZ = z.string().max(64);
/** The revision of a version the person was shown: every change names it, so nobody acts on one they haven't seen. */
const RevZ = z.number().int().min(1).max(1_000_000_000);
const STALE = "Someone has changed it since you opened it. Open it again to see the latest";
/** Refused because it changed meanwhile: the page offers to load the latest. */
const stale = () => ({ ok: false as const, error: STALE, stale: true as const });
type LibResult = ActionResult & { stale?: boolean };

/** Writing in the library: managers, operations managers and owners, on the full app. */
async function requireDrafter() {
  const ctx = await requireCtx();
  if (!canDraft(ctx.person)) redirect("/library");
  return ctx;
}

/**
 * Like requireDrafter, for saving what someone has written: a session that has ended (timed out, or signed out on
 * another device) is an error the editor shows, not a jump to the sign-in page that would lose the text.
 */
async function drafterForSave(): Promise<{ ok: true; ctx: Ctx } | { ok: false; error: string }> {
  const ctx = await current();
  if (!ctx || ctx.person.pinMustChange || ctx.scope !== "full") return { ok: false, error: "You've been signed out, so this wasn't saved. Copy what you wrote, then sign in again" };
  if (!canDraft(ctx.person)) return { ok: false, error: "Only managers can write in the library" };
  return { ok: true, ctx };
}

/** Ready to send for approval or publish, by kind. */
const readyFor = (kind: LibraryKind, body: LibraryBody) => (kind === "sop" ? readyForReview(body as SopBody) : recipeReady(kind, body as PrepBody | DishBody));
const kindWord = (kind: LibraryKind) => (kind === "sop" ? "SOP" : kind === "prep" ? "prep recipe" : "dish");

/**
 * Cleans what an editor sends, by kind, and checks its photos were uploaded and a dish's links are prep recipes. A
 * photo the owner has erased since (say, in a draft copied from an older version) is left out; its step keeps its words.
 */
async function contentFrom(kind: LibraryKind, input: unknown): Promise<{ ok: true; value: { title: string; body: LibraryBody } } | { ok: false; error: string }> {
  let c: { ok: true; value: { title: string; body: LibraryBody } } | { ok: false; error: string };
  if (kind === "sop") {
    const parsed = SopZ.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Some details are missing" };
    c = cleanSop(parsed.data);
  } else {
    const parsed = RecipeZ.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Some details are missing" };
    c = cleanRecipe(kind, parsed.data);
  }
  if (!c.ok) return c;
  const db = store();
  if (kind === "dish") {
    for (const id of new Set((c.value.body as DishBody).components.flatMap((x) => (x.prep ? [x.prep] : [])))) {
      const linked = await db.libraryDoc(id);
      if (!linked || linked.kind !== "prep") return { ok: false, error: "A linked prep recipe isn't there any more. Link it again" };
    }
  }
  const ids = photoIds(c.value.body as SopBody | PrepBody);
  if (!ids.length) return c;
  const found = await db.mediaStatus(ids);
  if (ids.some((id) => !found.has(id))) return { ok: false, error: "A photo didn't upload properly. Add it again" };
  const erased = new Set(ids.filter((id) => found.get(id)?.erased));
  return erased.size ? { ok: true, value: { title: c.value.title, body: dropPhotos(c.value.body as SopBody | PrepBody, erased) } } : c;
}

/** A new SOP, prep recipe or dish: its first draft. The code (SOP-BOH-012, PREP-PROD-003) comes from who it's for and never changes. */
export async function createDraft(kind: string, input: unknown): Promise<ActionResult & { id?: string; versionId?: string }> {
  const who = await drafterForSave();
  if (!who.ok) return who;
  const { ctx } = who;
  const k = KindZ.safeParse(kind);
  if (!k.success) return { ok: false, error: "Unknown kind" };
  const c = await contentFrom(k.data, input);
  if (!c.ok) return c;
  const db = store();
  const { docId, versionId, code } = await db.createLibraryDoc({ kind: k.data, prefix: codePrefix(k.data, c.value.body.sections), title: c.value.title, body: c.value.body, authorId: ctx.person.id });
  await db.audit({ actorId: ctx.person.id, action: "library.create", detail: `Started ${code}: ${c.value.title}` });
  revalidatePath("/library"); revalidatePath("/library/recipes");
  return { ok: true, id: docId, versionId };
}

/**
 * Saves a draft and returns its new revision and what was saved (cleaned: empty lines and steps dropped), for the
 * editor to carry on from. Whoever started it saving isn't audited (drafts change often); someone else changing it
 * is, and they can't then approve it. Nothing else on screen changes, so the page isn't refreshed.
 */
export async function saveDraft(versionId: string, rev: number, input: unknown): Promise<LibResult & { rev?: number; saved?: { title: string; body: LibraryBody } }> {
  const who = await drafterForSave();
  if (!who.ok) return who;
  const { ctx } = who;
  const db = store();
  const v = await db.libraryVersion(LibIdZ.parse(versionId));
  const doc = v && (await db.libraryDoc(v.docId));
  if (!v || !doc) return { ok: false, error: "That draft isn't there any more" };
  const can = canEditDraft(ctx.person, v);
  if (!can.ok) return can;
  const seen = RevZ.safeParse(rev);
  if (!seen.success) return stale();
  const c = await contentFrom(doc.kind, input);
  if (!c.ok) return c;
  const next = await db.saveLibraryDraft(v.id, seen.data, c.value, ctx.person.id);
  if (!next) return stale();
  if (ctx.person.id !== v.authorId) {
    await db.audit({ actorId: ctx.person.id, action: "library.edit", detail: `Changed ${v.authorName}'s draft of ${doc.code}: ${c.value.title}` });
  }
  return { ok: true, rev: next, saved: c.value };
}

/** A new version of a published SOP or recipe starts as a copy of it. If a draft is already open, that's the one to carry on with. */
export async function startDraft(docId: string): Promise<ActionResult> {
  const ctx = await requireDrafter();
  const db = store();
  const doc = await db.libraryDoc(LibIdZ.parse(docId));
  if (!doc) return { ok: false, error: "That isn't there any more" };
  if (doc.open) return { ok: true };
  if (doc.retiredAt) return { ok: false, error: "It's retired. Bring it back first" };
  if (!(await db.startLibraryDraft(doc.id, ctx.person.id))) return { ok: false, error: STALE };
  await db.audit({ actorId: ctx.person.id, action: "library.draft", detail: `Started a new version of ${doc.code}: ${doc.published?.title ?? ""}` });
  revalidatePath(`/library/${doc.id}`); revalidatePath("/library"); revalidatePath("/library/recipes");
  return { ok: true };
}

const MOVE_AUDIT = { submit: "Sent for approval", withdraw: "Took back from approval", send_back: "Sent back", discard: "Discarded a draft of" } as const;

/** Send for approval, take back, send back (approvers, with a note), or discard a draft. `rev`: the revision shown. */
export async function moveDraft(versionId: string, move: string, rev: number, note?: string): Promise<LibResult> {
  const ctx = await requireCtx();
  const m = z.enum(["submit", "withdraw", "send_back", "discard"]).parse(move);
  const db = store();
  const v = await db.libraryVersion(LibIdZ.parse(versionId));
  const doc = v && (await db.libraryDoc(v.docId));
  if (!v || !doc) return { ok: false, error: "That version isn't there any more" };
  const seen = RevZ.safeParse(rev);
  if (!seen.success) return stale();
  const why = z.string().trim().max(500, "Keep the note under 500 characters").safeParse(note ?? "");
  if (!why.success) return { ok: false, error: why.error.issues[0]?.message ?? "Check the note" };
  const reach = docReach(doc, await db.sites());
  const can = m === "submit" ? canEditDraft(ctx.person, v)
    : m === "withdraw" ? canTakeBack(ctx.person, v, reach, doc.kind)
    : m === "send_back" ? canReview(ctx.person, v, reach, doc.kind)
    : canDiscard(ctx.person, v, reach, doc.kind);
  if (!can.ok) return can;
  if (m === "submit") {
    const ready = readyFor(doc.kind, v.body);
    if (!ready.ok) return ready;
  }
  if (m === "send_back" && !why.data) return { ok: false, error: "Say what needs changing" };
  if (!(await db.moveLibraryVersion(v.id, m, ctx.person.id, seen.data, m === "send_back" ? why.data : undefined))) return stale();
  await db.audit({ actorId: ctx.person.id, action: `library.${m}`, detail: `${MOVE_AUDIT[m]} ${doc.code}: ${v.title}${m === "send_back" ? ` (${why.data})` : ""}` });
  revalidatePath(`/library/${doc.id}`); revalidatePath("/library"); revalidatePath("/library/recipes"); revalidatePath("/owner"); revalidatePath("/manage");
  return { ok: true };
}

/**
 * An owner, or an operations manager who runs every site it covers (before and after) and didn't write or change this
 * version, approves and publishes the revision they were shown. Everyone an SOP is for reads it (again, for a change);
 * when a dish's allergens change, everyone at its sites confirms they've seen it.
 */
export async function publishVersion(versionId: string, input: unknown): Promise<LibResult & { version?: number }> {
  const ctx = await requireCtx();
  const p = z.object({ rev: RevZ, change: z.string().max(10).optional(), reviewBy: z.string().max(10) }).safeParse(input);
  if (!p.success) return { ok: false, error: "Choose a review date" };
  const db = store();
  const v = await db.libraryVersion(LibIdZ.parse(versionId));
  const doc = v && (await db.libraryDoc(v.docId));
  if (!v || !doc) return { ok: false, error: "That version isn't there any more" };
  const can = canReview(ctx.person, v, docReach(doc, await db.sites()), doc.kind);
  if (!can.ok) return can;
  if (doc.retiredAt) return { ok: false, error: "It's retired. Bring it back first" };
  const ready = readyFor(doc.kind, v.body);
  if (!ready.ok) return ready;
  const change = changeFor(!!doc.published, p.data.change);
  if (!change.ok) return change;
  const review = validReviewBy(p.data.reviewBy, londonDate(Date.now()));
  if (!review.ok) return review;
  const alert = isKind(doc, "dish") ? allergenAlert(doc.published?.body, v.body as DishBody) : "none";
  const n = await db.publishLibraryVersion(v.id, p.data.rev, { approverId: ctx.person.id, change: change.value, reviewBy: p.data.reviewBy, ownerApproving: ctx.isOwner,
    ...(alert !== "none" ? { allergens: alert } : {}) });
  if (!n) return stale();
  await db.audit({ actorId: ctx.person.id, action: "library.publish",
    detail: `Published ${doc.code} version ${n} (${CHANGE_TEXT[change.value]}${alert === "changed" ? ", allergens changed" : ""}): ${v.title}` });
  revalidatePath(`/library/${doc.id}`); revalidatePath("/library"); revalidatePath("/library/recipes"); revalidatePath("/library/allergens");
  revalidatePath("/today"); revalidatePath("/me"); revalidatePath("/owner"); revalidatePath("/manage");
  return { ok: true, version: n };
}

/** Takes a published SOP or recipe out of use (kept, with its history; a draft in progress is discarded). It can be brought back. */
export async function retireDoc(docId: string, note: string): Promise<ActionResult> {
  const ctx = await requireCtx();
  const db = store();
  const doc = await db.libraryDoc(LibIdZ.parse(docId));
  if (!doc) return { ok: false, error: "That isn't there any more" };
  const can = canRetire(ctx.person, doc, docReach(doc, await db.sites()));
  if (!can.ok) return can;
  const why = z.string().trim().min(1, "Say why it's being retired").max(300, "Keep the reason under 300 characters").safeParse(note ?? "");
  if (!why.success) return { ok: false, error: why.error.issues[0]?.message ?? "Say why" };
  if (!(await db.retireLibraryDoc(doc.id, ctx.person.id, why.data))) return { ok: false, error: STALE };
  await db.audit({ actorId: ctx.person.id, action: "library.retire", detail: `Retired ${doc.code}: ${doc.published?.title ?? ""} (${why.data})${doc.open ? ". Its draft was discarded" : ""}` });
  revalidatePath(`/library/${doc.id}`); revalidatePath("/library"); revalidatePath("/library/recipes"); revalidatePath("/library/allergens");
  revalidatePath("/today"); revalidatePath("/me"); revalidatePath("/owner"); revalidatePath("/manage");
  return { ok: true };
}

export async function reinstateDoc(docId: string): Promise<ActionResult> {
  const ctx = await requireCtx();
  const db = store();
  const doc = await db.libraryDoc(LibIdZ.parse(docId));
  if (!doc) return { ok: false, error: "That isn't there any more" };
  const can = canReinstate(ctx.person, doc, docReach(doc, await db.sites()));
  if (!can.ok) return can;
  if (!(await db.reinstateLibraryDoc(doc.id))) return { ok: false, error: STALE };
  await db.audit({ actorId: ctx.person.id, action: "library.reinstate", detail: `Brought back ${doc.code}: ${doc.published?.title ?? ""}` });
  revalidatePath(`/library/${doc.id}`); revalidatePath("/library"); revalidatePath("/library/recipes"); revalidatePath("/library/allergens");
  revalidatePath("/today"); revalidatePath("/me");
  return { ok: true };
}

/**
 * The owner erases a photo for good (privacy: it shows someone, say). Every version using it shows "Photo removed"
 * instead; the versions themselves don't change. Can't be undone.
 */
export async function erasePhoto(docId: string, mediaId: string, reason: string): Promise<ActionResult> {
  const ctx = await requireCtx();
  if (!ctx.isOwner) return { ok: false, error: "Only the owner can erase a photo" };
  const why = z.string().trim().min(1, "Say why it's being erased").max(200, "Keep the reason under 200 characters").safeParse(reason ?? "");
  if (!why.success) return { ok: false, error: why.error.issues[0]?.message ?? "Say why" };
  const id = z.string().uuid().safeParse(mediaId);
  const db = store();
  const doc = await db.libraryDoc(LibIdZ.parse(docId));
  if (!doc || !id.success) return { ok: false, error: "That photo isn't there any more" };
  const versions = await db.libraryVersions(doc.id);
  if (!versions.some((v) => photoIds(v.body as SopBody | PrepBody).includes(id.data))) return { ok: false, error: `That photo isn't in this ${kindWord(doc.kind)}` };
  if (!(await db.eraseMedia(id.data, ctx.person.id))) return { ok: false, error: "It has already been erased" };
  // An ingredient picture can be reused in other recipes: it's gone from those too, so the log names them.
  const others = doc.kind === "sop" ? [] : (await Promise.all([db.libraryDocs("prep"), db.libraryDocs("dish")])).flat()
    .filter((d) => d.id !== doc.id && [d.published, d.open].some((v) => v && photoIds(v.body as PrepBody).includes(id.data))).map((d) => d.code);
  await db.audit({ actorId: ctx.person.id, action: "library.photo_erase",
    detail: `Erased a photo in ${doc.code}${others.length ? ` (also used in ${others.join(", ")})` : ""} (${why.data})` });
  revalidatePath(`/library/${doc.id}`); revalidatePath(`/library/${doc.id}/draft`);
  return { ok: true };
}

/**
 * On the shop tablet or their own phone: "I've read and understood it" for a published SOP that's for them, or "I've
 * seen the change" for a dish whose allergens changed, from anyone at its sites.
 */
export async function ackVersion(versionId: string): Promise<ActionResult> {
  const ctx = await current();
  if (!ctx) return { ok: false, error: "Sign in again" };
  if (ctx.person.pinMustChange) return { ok: false, error: MUST_CHANGE_PIN };
  const db = store();
  const v = await db.libraryVersion(LibIdZ.parse(versionId));
  const doc = v && (await db.libraryDoc(v.docId));
  if (!v || !doc || v.status !== "published" || doc.retiredAt) return { ok: false, error: "This version has been replaced. Open it again" };
  const sites = await db.sites();
  if (doc.kind === "sop" && !readsAny(v.body.sections, ctx.person, sites)) return { ok: false, error: "This SOP isn't one you need to confirm" };
  if (doc.kind === "dish" && (!v.allergensChangedAt || !alertedAt(ctx.person, v.body.sections, sites).length)) return { ok: false, error: "There's no allergen change here for you to confirm" };
  if (doc.kind === "prep") return { ok: false, error: "Recipes don't need confirming" };
  if (!(await db.ackLibraryVersion(v.id, ctx.person.id))) {
    // Already confirmed (another tab), or replaced a moment ago.
    if (!(await db.libraryAcks({ versionIds: [v.id], personId: ctx.person.id })).length) return { ok: false, error: "This version has been replaced. Open it again" };
    return { ok: true };
  }
  if (doc.kind === "dish") await db.audit({ actorId: ctx.person.id, action: "library.allergens_seen", detail: `Confirmed the allergen change in ${doc.code}: ${v.title}` });
  revalidatePath(`/library/${doc.id}`); revalidatePath(`/library/allergens/${doc.id}`); revalidatePath("/library"); revalidatePath("/today"); revalidatePath("/me");
  return { ok: true };
}

// ---------- training ----------
const SkillZ = z.object({
  section: z.string().max(8), group: z.string().max(200), title: z.string().max(500), about: z.string().max(3000), handsOn: z.boolean(), induction: z.boolean(),
  links: z.array(z.string().max(64)).max(20), videoUrl: z.string().max(1000), refresherMonths: z.number().int().nullable(), passMark: z.number().int(),
});
// The right answer is -1 until one is ticked: cleanQuestion asks for it.
const QuestionZ = z.object({ text: z.string().max(1000), options: z.array(z.string().max(500)).max(10), answer: z.number().int().min(-1).max(9) });
const QuizZ = z.object({ version: z.string().max(4000), answers: z.record(z.string(), z.number().int().min(0).max(9)) });
const TakeBackZ = z.string().trim().min(3, "Say why it has to be done again").max(300, "Keep it under 300 characters");
const TRAINING_PATHS = ["/library/training", "/manage/training", "/me", "/today", "/shift"];
const revalidateTraining = (...more: string[]) => { for (const p of [...TRAINING_PATHS, ...more]) revalidatePath(p); };

/** Signed in on any device (the shop tablet or their own phone), with their own PIN chosen. */
async function signedIn(): Promise<{ ok: true; ctx: Ctx } | { ok: false; error: string }> {
  const ctx = await current();
  if (!ctx) return { ok: false, error: "Sign in again" };
  if (ctx.person.pinMustChange) return { ok: false, error: MUST_CHANGE_PIN };
  return { ok: true, ctx };
}

/** The owner or an operations manager on the full app: they set the skills, quizzes and deadlines. */
async function trainingEditor(): Promise<{ ok: true; ctx: Ctx } | { ok: false; error: string }> {
  const who = await signedIn();
  if (!who.ok) return who;
  if (who.ctx.scope !== "full" || !canEditTraining(who.ctx.person)) return { ok: false, error: "Only the owner or an operations manager changes training" };
  return who;
}

/** Someone's row for a skill in their passport, or why there isn't one. */
async function passportRow(person: Person, skillId: string): Promise<{ ok: true; row: PassportRow; questions: Awaited<ReturnType<typeof trainingData>>["questions"] } | { ok: false; error: string }> {
  const id = UuidZ.safeParse(skillId);
  if (!id.success) return { ok: false, error: "That skill isn't there any more" };
  const db = store();
  const [sites, d] = await Promise.all([db.sites(), trainingData(db, [person.id])]);
  const row = passport(person, sites, d, londonDate(Date.now())).find((r) => r.skill.id === id.data);
  if (!row) return { ok: false, error: "That skill isn't part of this training any more" };
  return { ok: true, row, questions: d.questions };
}

/** After a quiz: the skill is done, waiting for a manager's check, or it was already done and this was practice. */
export type QuizNext = "done" | "ready" | "practice" | "again";
export interface QuizOutcome { score: number; passed: boolean; total: number; correct: number; wrong: string[]; passMark: number; next: QuizNext }

/**
 * Marks a quiz. `version` is the version of the quiz they were shown (if it changed meanwhile, they start again); the
 * answers are option indexes as stored. The attempt is kept with what was asked and answered. Passing completes a
 * knowledge skill, or makes a hands-on one ready for a manager to confirm.
 */
export async function submitQuiz(skillId: string, input: unknown): Promise<ActionResult & { restart?: boolean; result?: QuizOutcome }> {
  const who = await signedIn();
  if (!who.ok) return who;
  const x = QuizZ.safeParse(input);
  if (!x.success) return { ok: false, error: "Answer every question" };
  const mine = await passportRow(who.ctx.person, skillId);
  if (!mine.ok) return mine;
  const { skill } = mine.row;
  const qs = quizOf(skill.id, mine.questions);
  if (!qs.length || x.data.version !== quizVersion(qs)) return { ok: false, error: "The quiz changed while you were doing it. Start it again", restart: true };
  const g = gradeQuiz(qs, x.data.answers, skill.passMark);
  if (!g.ok) return g;
  await store().addTrainingEvent({
    personId: who.ctx.person.id, skillId: skill.id, kind: "quiz", byId: who.ctx.person.id, score: g.value.score, passed: g.value.passed,
    detail: { passMark: skill.passMark, asked: qs.map((q) => ({ id: q.id, text: q.text, options: q.options, answer: q.answer, given: x.data.answers[q.id] })) },
  });
  revalidateTraining(`/library/training/${skill.id}`);
  // Where that leaves them, for the message: done, waiting for a manager, or (already done) practice.
  const after = await passportRow(who.ctx.person, skill.id);
  const p = after.ok ? after.row.progress : mine.row.progress;
  const next: QuizNext = p.readyAt ? "ready" : p.state === "done" ? (skill.handsOn ? "practice" : "done") : "again";
  return { ok: true, result: { ...g.value, passMark: skill.passMark, next } };
}

/** With no quiz: a knowledge skill is marked done; a hands-on one is marked ready for a manager to check. */
export async function markSkillDone(skillId: string): Promise<ActionResult> {
  const who = await signedIn();
  if (!who.ok) return who;
  const mine = await passportRow(who.ctx.person, skillId);
  if (!mine.ok) return mine;
  const { skill, progress: p, hasQuiz, drafted } = mine.row;
  const can = canMarkDone(skill, p, { asked: hasQuiz, drafted });
  if (!can.ok) return can;
  await store().addTrainingEvent({ personId: who.ctx.person.id, skillId: skill.id, kind: "done", byId: who.ctx.person.id });
  revalidateTraining(`/library/training/${skill.id}`);
  return { ok: true };
}

async function managedRow(ctx: Ctx, personId: string, skillId: string): Promise<{ ok: true; target: Person; row: PassportRow } | { ok: false; error: string }> {
  const pid = z.string().min(1).max(64).safeParse(personId);
  const db = store();
  const target = pid.success ? await db.person(pid.data) : undefined;
  if (!target) return { ok: false, error: "That person isn't there any more" };
  const row = await passportRow(target, skillId);
  if (!row.ok) return row;
  const can = managesTraining(ctx.person, target, row.row.skill.section, await db.sites());
  if (!can.ok) return can;
  return { ok: true, target, row: row.row };
}

/** A manager confirms a hands-on skill after watching them do it (once the quiz is passed, if it has one). */
export async function confirmSkill(personId: string, skillId: string): Promise<ActionResult> {
  const ctx = await requireCtx();
  const m = await managedRow(ctx, personId, skillId);
  if (!m.ok) return m;
  const { skill, progress: p, hasQuiz } = m.row;
  const now = canConfirmNow(skill, p, hasQuiz);
  if (!now.ok) return now;
  const db = store();
  await db.addTrainingEvent({ personId: m.target.id, skillId: skill.id, kind: "confirmed", byId: ctx.person.id });
  await db.audit({ actorId: ctx.person.id, siteId: ctx.site.id, action: "training.confirm", detail: `Confirmed ${m.target.name} on ${skill.title}` });
  revalidateTraining(`/manage/training/${m.target.id}`, `/library/training/${skill.id}`);
  return { ok: true };
}

/** A manager takes back a skill that was done (or ready to be checked): it has to be done again, and why is kept. */
export async function takeBackSkill(personId: string, skillId: string, note: unknown): Promise<ActionResult> {
  const ctx = await requireCtx();
  const why = TakeBackZ.safeParse(note);
  if (!why.success) return { ok: false, error: why.error.issues[0]?.message ?? "Say why it has to be done again" };
  const m = await managedRow(ctx, personId, skillId);
  if (!m.ok) return m;
  const now = canTakeBackNow(m.row.progress);
  if (!now.ok) return now;
  const db = store();
  await db.addTrainingEvent({ personId: m.target.id, skillId: m.row.skill.id, kind: "reset", byId: ctx.person.id, note: why.data });
  await db.audit({ actorId: ctx.person.id, siteId: ctx.site.id, action: "training.take_back", detail: `Asked ${m.target.name} to do ${m.row.skill.title} again: ${why.data}` });
  revalidateTraining(`/manage/training/${m.target.id}`, `/library/training/${m.row.skill.id}`);
  return { ok: true };
}

/** The skill as cleaned, with every link checked: an SOP, prep recipe or dish that isn't retired. */
async function skillFrom(input: unknown) {
  const x = SkillZ.safeParse(input);
  if (!x.success) return { ok: false as const, error: "Some details are missing" };
  const c = cleanSkill(x.data);
  if (!c.ok) return c;
  const db = store();
  for (const id of c.value.links) {
    const doc = await db.libraryDoc(id);
    if (!doc) return { ok: false as const, error: "One of the linked SOPs or recipes isn't there any more" };
    if (doc.retiredAt) return { ok: false as const, error: `${doc.published?.title ?? doc.code} has been retired: take its link off` };
  }
  return c;
}

export async function createSkill(input: unknown): Promise<ActionResult & { id?: string }> {
  const who = await trainingEditor();
  if (!who.ok) return who;
  const c = await skillFrom(input);
  if (!c.ok) return c;
  const db = store();
  const id = await db.createTrainingSkill(c.value, who.ctx.person.id);
  await db.audit({ actorId: who.ctx.person.id, action: "training.skill", detail: `Added ${c.value.title} to ${PATHWAY_TEXT[c.value.section]} training` });
  revalidateTraining("/manage/training/skills");
  return { ok: true, id };
}

export async function saveSkill(skillId: string, rev: number, input: unknown): Promise<ActionResult & { rev?: number }> {
  const who = await trainingEditor();
  if (!who.ok) return who;
  const id = UuidZ.safeParse(skillId);
  if (!id.success || !Number.isInteger(rev)) return { ok: false, error: "That skill isn't there any more" };
  const c = await skillFrom(input);
  if (!c.ok) return c;
  const db = store();
  const was = await db.trainingSkill(id.data);
  if (!was) return { ok: false, error: "That skill isn't there any more" };
  if (was.retiredAt) return { ok: false, error: "This skill is retired: bring it back before changing it" };
  const next = await db.saveTrainingSkill(id.data, rev, c.value);
  if (!next) return { ok: false, error: "Someone else changed this skill meanwhile. Reload the page to see their changes" };
  await db.audit({ actorId: who.ctx.person.id, action: "training.skill", detail: `Changed the skill ${c.value.title}` });
  revalidateTraining("/manage/training/skills", `/manage/training/skills/${id.data}`, `/library/training/${id.data}`);
  return { ok: true, rev: next };
}

/** The skill's written guide (the training card): saved as a whole. */
export async function saveSkillGuide(skillId: string, input: unknown): Promise<ActionResult> {
  const who = await trainingEditor();
  if (!who.ok) return who;
  const id = UuidZ.safeParse(skillId);
  if (!id.success) return { ok: false, error: "That skill isn't there any more" };
  const c = cleanGuide(input);
  if (!c.ok) return c;
  const db = store();
  const skill = await db.trainingSkill(id.data);
  if (!skill) return { ok: false, error: "That skill isn't there any more" };
  if (skill.retiredAt) return { ok: false, error: "This skill is retired: bring it back before changing it" };
  // Every picture must be a photo in the library (uploaded by a writer), not erased.
  const photos = guidePhotoIds(c.value);
  if (photos.length) {
    const status = await db.mediaStatus(photos);
    if (photos.some((p) => !status.has(p))) return { ok: false, error: "One of the pictures didn't upload. Add it again" };
  }
  if (!(await db.saveTrainingGuide(skill.id, c.value))) return { ok: false, error: "That skill isn't there any more" };
  await db.audit({ actorId: who.ctx.person.id, action: "training.guide", detail: `Wrote the guide for ${skill.title}: ${c.value.steps.length} steps, ${photos.length} pictures` });
  revalidateTraining("/manage/training/skills", `/manage/training/skills/${id.data}`, `/library/training/${id.data}`);
  return { ok: true };
}

export async function moveSkill(skillId: string, dir: number): Promise<ActionResult> {
  const who = await trainingEditor();
  if (!who.ok) return who;
  const id = UuidZ.safeParse(skillId);
  if (!id.success || (dir !== -1 && dir !== 1)) return { ok: false, error: "That skill isn't there any more" };
  if (!(await store().moveTrainingSkill(id.data, dir))) return { ok: false, error: dir < 0 ? "It's already first" : "It's already last" };
  revalidateTraining("/manage/training/skills");
  return { ok: true };
}

/** Retiring takes it out of everyone's training (their records are kept); bringing it back puts it last in its pathway. */
export async function retireSkill(skillId: string, retire: boolean): Promise<ActionResult> {
  const who = await trainingEditor();
  if (!who.ok) return who;
  const id = UuidZ.safeParse(skillId);
  const db = store();
  const skill = id.success ? await db.trainingSkill(id.data) : undefined;
  if (!skill) return { ok: false, error: "That skill isn't there any more" };
  const done = retire ? await db.retireTrainingSkill(skill.id, who.ctx.person.id) : await db.reinstateTrainingSkill(skill.id);
  if (!done) return { ok: false, error: retire ? "It's already retired" : "It isn't retired" };
  await db.audit({ actorId: who.ctx.person.id, action: retire ? "training.retire" : "training.reinstate", detail: `${retire ? "Retired" : "Brought back"} the skill ${skill.title}` });
  revalidateTraining("/manage/training/skills", `/manage/training/skills/${skill.id}`, `/library/training/${skill.id}`);
  return { ok: true };
}

/** Adds a question to a skill's quiz (approved, as the owner or an operations manager wrote it) or changes one (keeping its approval). */
export async function saveQuestion(skillId: string, questionId: string | null, input: unknown): Promise<ActionResult & { id?: string }> {
  const who = await trainingEditor();
  if (!who.ok) return who;
  const sid = UuidZ.safeParse(skillId), qid = questionId === null ? undefined : UuidZ.safeParse(questionId);
  if (!sid.success || (qid && !qid.success)) return { ok: false, error: "That question isn't there any more" };
  const x = QuestionZ.safeParse(input);
  if (!x.success) return { ok: false, error: "Some details are missing" };
  const c = cleanQuestion(x.data);
  if (!c.ok) return c;
  const db = store();
  const skill = await db.trainingSkill(sid.data);
  if (!skill || skill.retiredAt) return { ok: false, error: "That skill isn't there any more" };
  if (!qid && (await db.trainingQuestions([skill.id])).length >= TRAINING_LIMITS.questions) return { ok: false, error: `A quiz has at most ${TRAINING_LIMITS.questions} questions` };
  const id = await db.saveTrainingQuestion({ id: qid?.data, skillId: skill.id, ...c.value }, who.ctx.person.id, true);
  if (!id) return { ok: false, error: "That question isn't there any more" };
  await db.audit({ actorId: who.ctx.person.id, action: "training.question", detail: `${qid ? "Changed a question in" : "Added a question to"} the quiz for ${skill.title}` });
  revalidateTraining("/manage/training/skills", `/manage/training/skills/${skill.id}`);
  return { ok: true, id };
}

export async function retireQuestion(skillId: string, questionId: string): Promise<ActionResult> {
  const who = await trainingEditor();
  if (!who.ok) return who;
  const sid = UuidZ.safeParse(skillId), qid = UuidZ.safeParse(questionId);
  if (!sid.success || !qid.success) return { ok: false, error: "That question isn't there any more" };
  const db = store();
  const skill = await db.trainingSkill(sid.data);
  if (!skill || !(await db.trainingQuestions([skill.id])).some((q) => q.id === qid.data)) return { ok: false, error: "That question isn't there any more" };
  if (skill.retiredAt) return { ok: false, error: "This skill is retired: bring it back before changing its quiz" };
  await db.retireTrainingQuestion(qid.data, who.ctx.person.id);
  await db.audit({ actorId: who.ctx.person.id, action: "training.question", detail: `Took a question off the quiz for ${skill.title}` });
  revalidateTraining("/manage/training/skills", `/manage/training/skills/${skill.id}`);
  return { ok: true };
}

/** Approves a skill's drafted questions, so the quiz asks them. */
export async function approveQuestions(skillId: string): Promise<ActionResult> {
  const who = await trainingEditor();
  if (!who.ok) return who;
  const sid = UuidZ.safeParse(skillId);
  const db = store();
  const skill = sid.success ? await db.trainingSkill(sid.data) : undefined;
  if (!skill || skill.retiredAt) return { ok: false, error: "That skill isn't there any more" };
  const n = await db.approveTrainingQuestions(skill.id, who.ctx.person.id);
  if (!n) return { ok: false, error: "There's nothing waiting for approval" };
  await db.audit({ actorId: who.ctx.person.id, action: "training.approve", detail: `Approved ${n} question${n === 1 ? "" : "s"} for ${skill.title}` });
  revalidateTraining("/manage/training/skills", `/manage/training/skills/${skill.id}`, `/library/training/${skill.id}`);
  return { ok: true };
}

/** A pathway's deadlines, in days from the day someone started in the section. */
export async function savePathway(section: string, inductionDays: number, allDays: number): Promise<ActionResult> {
  const who = await trainingEditor();
  if (!who.ok) return who;
  const sec = z.enum(["FOH", "BOH", "PROD"]).safeParse(section);
  if (!sec.success) return { ok: false, error: "Choose the pathway" };
  const c = cleanPathway({ inductionDays, allDays });
  if (!c.ok) return c;
  const db = store();
  await db.saveTrainingPathway({ section: sec.data, ...c.value }, who.ctx.person.id);
  await db.audit({ actorId: who.ctx.person.id, action: "training.deadlines", detail: `${PATHWAY_TEXT[sec.data]} training: induction within ${c.value.inductionDays} days, everything within ${c.value.allDays}` });
  revalidateTraining("/manage/training/skills");
  return { ok: true };
}

// ---------- editing checklists (the owner) ----------

const ChecklistIdZ = z.string().regex(/^[A-Z]{2,5}-[A-Z]+-[A-Z0-9-]{1,40}$/);
const checklistChanged = (id: string) => {
  for (const p of ["/manage/checklists", `/manage/checklists/${id}`, "/today", `/run/${id}`, "/shift", "/owner", "/manage"]) revalidatePath(p);
};
async function checklistCtx() {
  const ctx = await requireCtx();
  if (!canEditChecklists(ctx.person)) return { ctx, error: "Only the owner edits checklists" };
  return { ctx, error: undefined };
}

/** A new checklist at a site: its settings and a first draft of its checks (empty is fine, it's published later). */
export async function checklistCreate(input: unknown): Promise<ActionResult & { id?: string }> {
  const { ctx, error } = await checklistCtx();
  if (error) return { ok: false, error };
  const f = z.object({ siteId: SiteIdZ, name: z.string().max(200), area: z.string().max(10), when: z.string().max(200), due: z.string().max(10), items: z.unknown() }).safeParse(input);
  if (!f.success) return { ok: false, error: "That couldn't be saved" };
  const c = cleanSettings(f.data);
  if (!c.ok) return c;
  const db = store();
  const site = await db.site(f.data.siteId);
  if (!site) return { ok: false, error: "Site not found" };
  const rules = await db.rules();
  const items = Array.isArray(f.data.items) && f.data.items.length ? cleanItems(f.data.items, rules) : { ok: true as const, value: [] };
  if (!items.ok) return items;
  const taken = (await db.checklistTemplates(f.data.siteId)).map((t) => t.id);
  const id = templateId(f.data.siteId, c.value.area, c.value.name, taken);
  await db.createChecklist({ id, siteId: f.data.siteId, ...c.value }, items.value, ctx.person.id);
  await db.audit({ actorId: ctx.person.id, siteId: f.data.siteId, action: "checklist.create", detail: `New checklist "${c.value.name}" (${id}, ${c.value.area}, ${c.value.when}${c.value.due ? `, due ${c.value.due}` : ""}) as a draft` });
  checklistChanged(id);
  return { ok: true, id };
}

/** Name, when, due time and on/off: take effect at once, no new version. */
export async function checklistSettings(id: string, input: unknown): Promise<ActionResult> {
  const { ctx, error } = await checklistCtx();
  if (error) return { ok: false, error };
  const idZ = ChecklistIdZ.safeParse(id);
  const f = z.object({ name: z.string().max(200), area: z.string().max(10), when: z.string().max(200), due: z.string().max(10), active: z.boolean() }).safeParse(input);
  if (!idZ.success || !f.success) return { ok: false, error: "That couldn't be saved" };
  const db = store();
  const t = await db.checklistTemplate(idZ.data);
  if (!t) return { ok: false, error: "Checklist not found" };
  const c = cleanSettings(f.data);
  if (!c.ok) return c;
  if (f.data.active && !t.active && !t.published) return { ok: false, error: "Publish its checks before switching it on" };
  const next = { name: c.value.name, area: c.value.area, when: c.value.when, due: c.value.due, active: f.data.active };
  const changes: string[] = [];
  if (next.name !== t.name) changes.push(`name "${t.name}" → "${next.name}"`);
  if (next.area !== t.area) changes.push(`done by ${AREA_TEXT[t.area]} → ${AREA_TEXT[next.area]}`);
  if (next.when !== t.when) changes.push(`when "${t.when}" → "${next.when}"`);
  if ((next.due ?? "") !== (t.due ?? "")) changes.push(`due ${t.due ?? "none"} → ${next.due ?? "none"}`);
  if (next.active !== t.active) changes.push(next.active ? "switched on" : "switched off");
  if (!changes.length) return { ok: true };
  await db.updateChecklistSettings(t.id, next);
  await db.audit({ actorId: ctx.person.id, siteId: t.siteId, action: "checklist.settings", detail: `${t.name} (${t.id}): ${changes.join("; ")}` });
  checklistChanged(t.id);
  return { ok: true };
}

/** Saves the draft's checks as a whole (making the draft from the published checks if there is none). */
export async function checklistSaveDraft(id: string, items: unknown): Promise<ActionResult & { version?: number }> {
  const { ctx, error } = await checklistCtx();
  if (error) return { ok: false, error };
  const idZ = ChecklistIdZ.safeParse(id);
  if (!idZ.success) return { ok: false, error: "That couldn't be saved" };
  const db = store();
  const t = await db.checklistTemplate(idZ.data);
  if (!t) return { ok: false, error: "Checklist not found" };
  const c = cleanItems(items, await db.rules());
  if (!c.ok) return c;
  const note = describeChange(t.published ? toDraftItems(t.published.items) : undefined, c.value);
  const v = await db.saveChecklistDraft(t.id, c.value, note, ctx.person.id);
  await db.audit({ actorId: ctx.person.id, siteId: t.siteId, action: "checklist.draft", detail: `${t.name} (${t.id}): draft v${v.version} saved, ${note}` });
  checklistChanged(t.id);
  return { ok: true, version: v.version };
}

/** The draft goes live for the next run; the version in use before it is retired. */
export async function checklistPublish(id: string): Promise<ActionResult> {
  const { ctx, error } = await checklistCtx();
  if (error) return { ok: false, error };
  const idZ = ChecklistIdZ.safeParse(id);
  if (!idZ.success) return { ok: false, error: "That couldn't be saved" };
  const db = store();
  const t = await db.checklistTemplate(idZ.data);
  if (!t) return { ok: false, error: "Checklist not found" };
  if (!t.draft) return { ok: false, error: "There's no draft to publish" };
  const today = await db.run(t.id, londonNow().date);
  const can = canPublish(toDraftItems(t.draft.items), { answers: today.answers.length, signed: !!today.signedAt });
  if (!can.ok) return can;
  await db.publishChecklistDraft(t.id, ctx.person.id);
  await db.audit({ actorId: ctx.person.id, siteId: t.siteId, action: "checklist.publish", detail: `${t.name} (${t.id}): v${t.draft.version} published${t.published ? `, v${t.published.version} retired` : ""} (${t.draft.note ?? `${t.draft.items.length} checks`})` });
  checklistChanged(t.id);
  return { ok: true };
}

/** Drops the draft. The only draft of a never-published checklist takes the checklist with it (switched off). */
export async function checklistDiscard(id: string): Promise<ActionResult> {
  const { ctx, error } = await checklistCtx();
  if (error) return { ok: false, error };
  const idZ = ChecklistIdZ.safeParse(id);
  if (!idZ.success) return { ok: false, error: "That couldn't be saved" };
  const db = store();
  const t = await db.checklistTemplate(idZ.data);
  if (!t) return { ok: false, error: "Checklist not found" };
  if (!t.draft) return { ok: false, error: "There's no draft to discard" };
  await db.discardChecklistDraft(t.id);
  if (!t.published) await db.updateChecklistSettings(t.id, { name: t.name, area: t.area, when: t.when, due: t.due, active: false });
  await db.audit({ actorId: ctx.person.id, siteId: t.siteId, action: "checklist.discard", detail: `${t.name} (${t.id}): draft v${t.draft.version} discarded${t.published ? "" : "; the checklist was never published, so it's off"}` });
  checklistChanged(t.id);
  return { ok: true };
}

// ---------- Stock & Purchasing (rules in src/lib/domain/stock.ts, steps in src/lib/stock-service.ts) ----------

const StockIdZ = z.string().min(1).max(64);
const QtyZ = z.coerce.number().positive().max(9999);
const StockTextZ = z.string().max(500).optional();
const DayZ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Who's signed in (tablet or own phone), with the stock catalogue and their site. */
async function stockWho(): Promise<{ ok: true; ctx: Ctx } | { ok: false; error: string }> {
  const who = await signedIn();
  if (!who.ok) return who;
  if (who.ctx.person.status !== "active") return { ok: false, error: "Your account isn't active" };
  return who;
}
async function purchasingOwner(): Promise<{ ok: true; ctx: Ctx } | { ok: false; error: string }> {
  const who = await stockWho();
  if (!who.ok) return who;
  if (!runsPurchasing(who.ctx.person)) return { ok: false, error: "Only the owner runs purchasing" };
  return who;
}
function revalidateStock() { revalidatePath("/stock", "layout"); }
/** A photo the person uploaded for stock that's really there (and not erased). */
async function photoOk(id?: string): Promise<boolean> {
  if (!id) return true;
  const m = await store().mediaInfo(id).catch(() => undefined);
  return !!m && !m.erased;
}

/** Saves the person's unsent report at the site they're signed in at (a draft they can come back to). */
export async function saveStockReport(input: { lines: unknown; noIssues: boolean }): Promise<ActionResult> {
  const who = await stockWho();
  if (!who.ok) return who;
  const { ctx } = who;
  if (!canReportAt(ctx.person, ctx.site)) return { ok: false, error: `You can't report stock at ${ctx.site.name}` };
  const parsed = z.object({ lines: z.array(z.object({ productId: StockIdZ, level: z.enum(["low", "out"]), qty: z.number().optional().nullable(), note: z.string().max(200).optional(), photoId: z.string().max(64).optional() })).max(200), noIssues: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Something in the report doesn't look right. Check it and try again" };
  const db = store();
  const clean = cleanStockLines(parsed.data.lines.map((l) => ({ ...l, qty: l.qty ?? undefined })), (await db.stockCatalog()).products, { draft: true });
  if (!clean.ok) return clean;
  for (const l of clean.value) if (!(await photoOk(l.photoId))) return { ok: false, error: "A photo didn't upload properly. Take it again" };
  await db.saveStockDraft(ctx.site.id, ctx.person.id, londonDate(Date.now()), clean.value, parsed.data.noIssues && !clean.value.length);
  return { ok: true };
}

/** Sends the report: new requests, notes on ones already open, production products to the kitchen. */
export async function sendStockReportNow(): Promise<ActionResult & { created?: number; again?: number }> {
  const who = await stockWho();
  if (!who.ok) return who;
  const { ctx } = who;
  if (!canReportAt(ctx.person, ctx.site)) return { ok: false, error: `You can't report stock at ${ctx.site.name}` };
  const db = store();
  const r = await sendStockReport(db, ctx.person, ctx.site, Date.now());
  if (!r.ok) return r;
  await db.audit({ actorId: ctx.person.id, siteId: ctx.site.id, action: "stock.report",
    detail: r.value.noIssues ? "No stock issues today" : `Stock report: ${r.value.created.length} new request${r.value.created.length === 1 ? "" : "s"}${r.value.again ? `, ${r.value.again} already requested` : ""}` });
  revalidateStock();
  return { ok: true, created: r.value.created.length, again: r.value.again };
}

/** The person's last sent report at the site, back into their draft to check and send again. */
export async function repeatLastStockReport(): Promise<ActionResult & { added?: number }> {
  const who = await stockWho();
  if (!who.ok) return who;
  const { ctx } = who;
  if (!canReportAt(ctx.person, ctx.site)) return { ok: false, error: `You can't report stock at ${ctx.site.name}` };
  const db = store();
  const last = (await db.stockReports([ctx.site.id], Date.now() - 60 * 86_400_000)).find((r) => r.lines.length > 0);
  if (!last) return { ok: false, error: "There's no earlier report from this site to repeat" };
  const draft = await db.stockDraft(ctx.site.id, ctx.person.id);
  const lines = [...(draft?.lines ?? [])];
  let added = 0;
  for (const l of last.lines) if (!lines.some((x) => x.productId === l.productId)) { lines.push({ productId: l.productId, level: l.level, qty: l.qty }); added++; }
  const clean = cleanStockLines(lines, (await db.stockCatalog()).products, { draft: true });
  if (!clean.ok) return clean;
  await db.saveStockDraft(ctx.site.id, ctx.person.id, londonDate(Date.now()), clean.value, false);
  return { ok: true, added };
}

/** Confirms what arrived for a request, at its restaurant. */
export async function receiveStock(requestId: string, qty: number, note?: string): Promise<ActionResult> {
  const who = await stockWho();
  if (!who.ok) return who;
  const { ctx } = who;
  const p = z.object({ id: StockIdZ, qty: QtyZ, note: z.string().max(200).optional() }).safeParse({ id: requestId, qty, note });
  if (!p.success) return { ok: false, error: "How many arrived?" };
  const db = store();
  const req = (await db.stockData({ since: 0, siteIds: ctx.person.access.map((a) => a.siteId) })).requests.find((r) => r.id === p.data.id);
  if (!req || !ctx.person.access.some((a) => a.siteId === req.siteId)) return { ok: false, error: "That request isn't for your site" };
  const r = await db.addStockReceipt(req.id, p.data.qty, ctx.person.id, p.data.note?.trim() || undefined);
  if (!r.ok) return r;
  await db.audit({ actorId: ctx.person.id, siteId: req.siteId, action: "stock.receive", detail: `${stockReqCode(req)}: ${p.data.qty} received${p.data.note ? ` (${p.data.note.trim()})` : ""}` });
  revalidateStock();
  return { ok: true };
}

const TaskInputZ = z.object({
  supplierId: StockIdZ.optional().nullable(), method: z.enum(["shop", "online", "delivery", "production"]),
  assigneeId: StockIdZ.optional().nullable(), driverId: StockIdZ.optional().nullable(), requiredBy: DayZ.optional().nullable(),
  priority: z.enum(["normal", "urgent"]), note: z.string().max(500).optional(),
  lines: z.array(z.object({ requestId: StockIdZ, qty: QtyZ })).min(1).max(300),
});

/** Who a task can go to: purchasers and owners; a production order's lead is on that kitchen's team. */
async function checkPeople(assigneeId: string | null | undefined, driverId: string | null | undefined, method: string, supplier?: { siteId?: string }): Promise<string | undefined> {
  const db = store();
  const [people, purchasers] = await Promise.all([db.people(), db.purchaserIds()]);
  for (const [id, role] of [[assigneeId, "person"], [driverId, "driver"]] as const) {
    if (!id) continue;
    const p = people.find((x) => x.id === id);
    const prodLead = role === "person" && method === "production" && supplier?.siteId && p && onProductionTeam(p, supplier.siteId);
    if (!p || !(canPurchase({ ...p, purchaser: purchasers.includes(p.id) }) || prodLead)) return `That ${role} can't be given purchasing work. Add them to the purchasers list first`;
  }
  return undefined;
}

/** The owner gives what's needed to someone: a task of lines, each one restaurant's request and a quantity. */
export async function createPurchaseTask(input: unknown): Promise<ActionResult & { id?: string }> {
  const who = await purchasingOwner();
  if (!who.ok) return who;
  const p = TaskInputZ.safeParse(input);
  if (!p.success) return { ok: false, error: "Check the task's details" };
  const db = store();
  const { suppliers } = await db.stockCatalog();
  const supplier = suppliers.find((s) => s.id === p.data.supplierId);
  if (p.data.supplierId && !supplier) return { ok: false, error: "That supplier isn't in the list" };
  if (p.data.method === "production" && supplier?.method !== "production") return { ok: false, error: "Production orders go to a production kitchen" };
  const bad = await checkPeople(p.data.assigneeId, p.data.driverId, p.data.method, supplier);
  if (bad) return { ok: false, error: bad };
  const reqs = (await db.stockData({ since: 0 })).requests;
  const destination = p.data.method === "production" ? reqs.find((r) => r.id === p.data.lines[0].requestId)?.siteId : undefined;
  const r = await db.createStockTask({ supplierId: p.data.supplierId ?? undefined, method: p.data.method, assigneeId: p.data.assigneeId ?? undefined, driverId: p.data.driverId ?? undefined,
    requiredBy: p.data.requiredBy ?? undefined, priority: p.data.priority, note: p.data.note?.trim() || undefined, destination, createdBy: who.ctx.person.id }, p.data.lines);
  if (!r.ok) return r;
  await notifyTask(db, r.value, Date.now());
  await db.audit({ actorId: who.ctx.person.id, action: "stock.task", detail: `Task for ${supplier?.name ?? "no supplier"} (${p.data.lines.length} line${p.data.lines.length === 1 ? "" : "s"}, ${stockMethodOf(p.data.method)?.label})` });
  revalidateStock();
  return { ok: true, id: r.value };
}

/** The owner changes who has a task, when it's needed, its priority or note. */
export async function updatePurchaseTask(taskId: string, input: unknown): Promise<ActionResult> {
  const who = await purchasingOwner();
  if (!who.ok) return who;
  const p = z.object({ assigneeId: StockIdZ.nullable().optional(), driverId: StockIdZ.nullable().optional(), requiredBy: DayZ.nullable().optional(), priority: z.enum(["normal", "urgent"]).optional(), note: z.string().max(500).nullable().optional() }).safeParse(input);
  if (!p.success || !StockIdZ.safeParse(taskId).success) return { ok: false, error: "Check the task's details" };
  const db = store();
  const d = await db.stockTask(taskId);
  const t = d?.tasks.find((x) => x.id === taskId);
  if (!t) return { ok: false, error: "That task isn't there" };
  const supplier = (await db.stockCatalog()).suppliers.find((s) => s.id === t.supplierId);
  const bad = await checkPeople("assigneeId" in p.data ? p.data.assigneeId : undefined, "driverId" in p.data ? p.data.driverId : undefined, t.method, supplier);
  if (bad) return { ok: false, error: bad };
  const patch = { ...p.data, assigneeId: p.data.assigneeId ?? (p.data.assigneeId === null ? undefined : t.assigneeId), driverId: p.data.driverId ?? (p.data.driverId === null ? undefined : t.driverId),
    requiredBy: p.data.requiredBy === null ? undefined : p.data.requiredBy ?? t.requiredBy, note: p.data.note === null ? undefined : p.data.note?.trim() ?? t.note };
  if (!(await db.updateStockTask(taskId, patch, who.ctx.person.id))) return { ok: false, error: "That task is cancelled" };
  await notifyTask(db, taskId, Date.now());
  await db.audit({ actorId: who.ctx.person.id, action: "stock.task.change", detail: `${stockTaskCode(t)} changed` });
  revalidateStock();
  return { ok: true };
}

export async function cancelPurchaseTask(taskId: string, reason: string): Promise<ActionResult> {
  const who = await purchasingOwner();
  if (!who.ok) return who;
  const why = reason?.trim().slice(0, 200);
  if (!why) return { ok: false, error: "Say why it's cancelled" };
  const db = store();
  const t = (await db.stockTask(taskId))?.tasks.find((x) => x.id === taskId);
  if (!t || !(await db.cancelStockTask(taskId, who.ctx.person.id, why))) return { ok: false, error: "That task is already cancelled" };
  await db.audit({ actorId: who.ctx.person.id, action: "stock.task.cancel", detail: `${stockTaskCode(t)} cancelled: ${why}` });
  revalidateStock();
  return { ok: true };
}

/** The owner takes one line off a task (to give it to someone else); its quantity goes back to waiting. */
export async function cancelTaskLine(lineId: string, reason: string): Promise<ActionResult> {
  const who = await purchasingOwner();
  if (!who.ok) return who;
  const why = reason?.trim().slice(0, 200) || "Taken off the task";
  if (!StockIdZ.safeParse(lineId).success) return { ok: false, error: "That line isn't there any more" };
  const d = await taskOfLine(lineId);
  if (!d) return { ok: false, error: "That line isn't there any more" };
  const db = store();
  const r = await db.addStockEvent({ by: who.ctx.person.id, kind: "line_cancelled", lineId, text: why });
  if (!r.ok) return r;
  await db.audit({ actorId: who.ctx.person.id, siteId: d.request?.siteId, action: "stock.line.cancel", detail: `${stockTaskCode(d.task)}${d.request ? ` ${stockReqCode(d.request)}` : ""}: taken off (${why})` });
  revalidateStock();
  return { ok: true };
}

/** The owner sets a request's quantity, changes its supplier, or cancels it. */
export async function changeStockRequestAction(requestId: string, change: { qty?: number; supplierId?: string | null; cancel?: string }): Promise<ActionResult> {
  const who = await purchasingOwner();
  if (!who.ok) return who;
  if (!StockIdZ.safeParse(requestId).success) return { ok: false, error: "That request isn't there" };
  const db = store();
  const c = change.qty !== undefined ? { fixedQty: Number(change.qty) } : change.cancel !== undefined ? { cancel: change.cancel.trim().slice(0, 200) } : { supplierId: change.supplierId ?? null };
  if ("cancel" in c && !c.cancel) return { ok: false, error: "Say why it's cancelled" };
  if ("supplierId" in c && c.supplierId && !(await db.stockCatalog()).suppliers.some((s) => s.id === c.supplierId)) return { ok: false, error: "That supplier isn't in the list" };
  const r = await db.changeStockRequest(requestId, c, who.ctx.person.id);
  if (!r.ok) return r;
  const req = (await db.stockData({ since: 0 })).requests.find((x) => x.id === requestId);
  if (req && !("cancel" in c)) await routeProduction(db, [req], who.ctx.person.id, Date.now());
  await db.audit({ actorId: who.ctx.person.id, siteId: req?.siteId, action: "stock.request",
    detail: `${req ? stockReqCode(req) : "Request"}: ${"fixedQty" in c ? `quantity set to ${c.fixedQty}` : "cancel" in c ? `cancelled (${c.cancel})` : "supplier changed"}` });
  revalidateStock();
  return { ok: true };
}

/** Records against a line or task by whoever has it: bought, unavailable, picked, packed, dispatched, a substitute. */
export async function recordStockLine(lineId: string, input: unknown): Promise<ActionResult> {
  const who = await stockWho();
  if (!who.ok) return who;
  const p = z.object({ kind: z.enum(["bought", "unavailable", "picked", "packed", "dispatched", "substitute", "substitute_ok", "substitute_no", "note"]), qty: z.coerce.number().min(0).max(9999).optional(),
    text: StockTextZ, ref: z.string().max(80).optional(), on: DayZ.optional(), mediaId: z.string().uuid().optional() }).safeParse(input);
  if (!p.success || !StockIdZ.safeParse(lineId).success) return { ok: false, error: "Check what you entered" };
  const db = store();
  const d = await taskOfLine(lineId);
  if (!d) return { ok: false, error: "That line isn't there any more" };
  const { suppliers } = await db.stockCatalog();
  const supplier = suppliers.find((s) => s.id === d.task.supplierId);
  if (!canSeeTask(who.ctx.person, d.task, supplier)) return { ok: false, error: "That task isn't yours" };
  if (d.task.cancelledAt) return { ok: false, error: "That task has been cancelled" };
  const production = d.task.method === "production";
  if ((p.data.kind === "dispatched" || p.data.kind === "picked" || p.data.kind === "packed") !== production && p.data.kind !== "note" && p.data.kind !== "unavailable" && !p.data.kind.startsWith("substitute")) {
    return { ok: false, error: production ? "Production orders are picked, packed and dispatched" : "Use bought or not available" };
  }
  if ((p.data.kind === "substitute_ok" || p.data.kind === "substitute_no") && !runsPurchasing(who.ctx.person)) return { ok: false, error: "Only the owner approves a substitute" };
  if (!(await photoOk(p.data.mediaId))) return { ok: false, error: "The photo didn't upload properly. Take it again" };
  const r = await db.addStockEvent({ by: who.ctx.person.id, kind: p.data.kind, lineId, qty: p.data.qty, text: p.data.text?.trim() || undefined, ref: p.data.ref?.trim() || undefined, on: p.data.on, mediaId: p.data.mediaId });
  if (!r.ok) return r;
  if (p.data.kind !== "note") await db.audit({ actorId: who.ctx.person.id, siteId: d.request?.siteId, action: `stock.${p.data.kind}`, detail: `${stockTaskCode(d.task)}${d.request ? ` ${stockReqCode(d.request)}` : ""}: ${p.data.kind.replace("_", " ")}${p.data.qty ? ` ${p.data.qty}` : ""}${p.data.text ? ` (${p.data.text.trim()})` : ""}` });
  revalidateStock();
  return { ok: true };
}

/** Task-level steps by whoever has it: seen, order placed (with reference; online and delivery), cost, collected, delivered. */
export async function recordStockTask(taskId: string, input: unknown): Promise<ActionResult> {
  const who = await stockWho();
  if (!who.ok) return who;
  const p = z.object({ kind: z.enum(["acknowledged", "ordered", "cost", "collected", "delivered", "note"]), pounds: z.string().max(12).optional(), text: StockTextZ,
    ref: z.string().max(80).optional(), on: DayZ.optional(), mediaId: z.string().uuid().optional(), allBought: z.boolean().optional() }).safeParse(input);
  if (!p.success || !StockIdZ.safeParse(taskId).success) return { ok: false, error: "Check what you entered" };
  const db = store();
  const d = await db.stockTask(taskId);
  const t = d?.tasks.find((x) => x.id === taskId);
  if (!d || !t) return { ok: false, error: "That task isn't there" };
  const supplier = (await db.stockCatalog()).suppliers.find((s) => s.id === t.supplierId);
  if (!canSeeTask(who.ctx.person, t, supplier)) return { ok: false, error: "That task isn't yours" };
  if (t.cancelledAt) return { ok: false, error: "That task has been cancelled" };
  let pence: number | undefined;
  if (p.data.kind === "cost") {
    const n = Number((p.data.pounds ?? "").replace(/[£,\s]/g, ""));
    if (!Number.isFinite(n) || n <= 0 || n > 100_000) return { ok: false, error: "Enter what it cost, like 42.50" };
    pence = Math.round(n * 100);
  }
  if (p.data.kind === "ordered" && t.method === "production") return { ok: false, error: "Production orders are picked and dispatched" };
  if (!(await photoOk(p.data.mediaId))) return { ok: false, error: "The photo didn't upload properly. Take it again" };
  // Placing an order means it's bought: the order and each open line in full, in one step (record a line first if less was ordered).
  const r = p.data.kind === "ordered" && p.data.allBought
    ? await db.orderPlaced(taskId, who.ctx.person.id, p.data.ref?.trim() || undefined, p.data.on)
    : await db.addStockEvent({ by: who.ctx.person.id, kind: p.data.kind, taskId, pence, text: p.data.text?.trim() || undefined, ref: p.data.ref?.trim() || undefined, on: p.data.on, mediaId: p.data.mediaId });
  if (!r.ok) return r;
  if (p.data.kind !== "acknowledged" && p.data.kind !== "note") {
    await db.audit({ actorId: who.ctx.person.id, action: `stock.${p.data.kind}`, detail: `${stockTaskCode(t)}: ${p.data.kind}${pence !== undefined ? ` ${(pence / 100).toFixed(2)}` : ""}${p.data.ref ? ` ref ${p.data.ref.trim()}` : ""}` });
  }
  revalidateStock();
  return { ok: true };
}

// ---------- Stock needed (owner and operations managers) ----------

async function orderingLead(): Promise<{ ok: true; ctx: Ctx } | { ok: false; error: string }> {
  const who = await stockWho();
  if (!who.ok) return who;
  if (!runsOrdering(who.ctx.person)) return { ok: false, error: "Only the owner and operations managers order stock" };
  return who;
}
const KeyZ = z.string().max(64);

/** Ticks products off a supplier's list (ordered or bought, so done; production: sent). */
export async function tickNeededAction(key: string, productIds: string[]): Promise<ActionResult & { ticked?: number }> {
  const who = await orderingLead();
  if (!who.ok) return who;
  const p = z.object({ key: KeyZ, ids: z.array(StockIdZ).min(1).max(300) }).safeParse({ key, ids: productIds });
  if (!p.success) return { ok: false, error: "Pick what to tick off" };
  const db = store();
  const now = Date.now();
  const before = (await neededView(db, who.ctx.person, now)).groups.find((g) => g.key === p.data.key);
  const r = await tickNeeded(db, who.ctx.person, p.data.key, p.data.ids, now);
  if (!r.ok) return r;
  const names = before?.rows.filter((x) => p.data.ids.includes(x.product.id)).map((x) => `${x.qty} × ${x.product.name}`) ?? [];
  await db.audit({ actorId: who.ctx.person.id, action: "stock.tick",
    detail: `${before?.supplier?.name ?? "No supplier"}: ${before?.production ? "sent" : "ordered"} ${names.slice(0, 6).join(", ")}${names.length > 6 ? ` and ${names.length - 6} more` : ""}` });
  revalidateStock();
  return { ok: true, ticked: r.value.ticked };
}

/** Gives a supplier's list (or some of it) to a driver, who ticks it off on their phone. */
export async function giveNeededToDriver(key: string, driverId: string, productIds?: string[]): Promise<ActionResult> {
  const who = await orderingLead();
  if (!who.ok) return who;
  const p = z.object({ key: KeyZ, driver: StockIdZ, ids: z.array(StockIdZ).max(300).optional() }).safeParse({ key, driver: driverId, ids: productIds });
  if (!p.success) return { ok: false, error: "Choose a driver" };
  const bad = await checkPeople(p.data.driver, undefined, "shop");
  if (bad) return { ok: false, error: bad };
  const db = store();
  const r = await giveToDriver(db, who.ctx.person, p.data.key, p.data.driver, p.data.ids?.length ? p.data.ids : undefined, Date.now());
  if (!r.ok) return r;
  const [driver, sup] = await Promise.all([db.person(p.data.driver), db.stockCatalog().then((c) => c.suppliers.find((s) => s.id === p.data.key))]);
  await db.audit({ actorId: who.ctx.person.id, action: "stock.driver", detail: `${sup?.name ?? "No supplier"} list given to ${driver?.name ?? "a driver"}` });
  revalidateStock();
  return { ok: true };
}

/** Takes a list back from a driver: what they haven't ticked goes back on Stock needed. */
export async function takeBackFromDriver(taskId: string): Promise<ActionResult> {
  const who = await orderingLead();
  if (!who.ok) return who;
  if (!StockIdZ.safeParse(taskId).success) return { ok: false, error: "That list isn't there" };
  const db = store();
  const d = await db.stockTask(taskId);
  const t = d?.tasks.find((x) => x.id === taskId);
  const sites = orderingSites(who.ctx.person, (await db.sites()).map((s) => s.id));
  if (!d || !t || !d.requests.every((r) => sites.includes(r.siteId))) return { ok: false, error: "That list isn't one you order for" };
  if (!(await db.cancelStockTask(taskId, who.ctx.person.id, "Taken back on Stock needed"))) return { ok: false, error: "That list has already been taken back" };
  await db.audit({ actorId: who.ctx.person.id, action: "stock.driver.back", detail: `${stockTaskCode(t)} taken back from ${t.assigneeName ?? "the driver"}` });
  revalidateStock();
  return { ok: true };
}

/** Sets the amount on a request sent without one (from before amounts were asked for). */
export async function setNeededAmount(requestId: string, qty: number): Promise<ActionResult> {
  const who = await orderingLead();
  if (!who.ok) return who;
  const p = z.object({ id: StockIdZ, qty: QtyZ }).safeParse({ id: requestId, qty });
  if (!p.success) return { ok: false, error: "Enter how many, above 0" };
  const db = store();
  const req = (await db.stockData({ since: 0 })).requests.find((r) => r.id === p.data.id);
  const sites = orderingSites(who.ctx.person, (await db.sites()).map((s) => s.id));
  if (!req || !sites.includes(req.siteId)) return { ok: false, error: "That request isn't one you order for" };
  const r = await db.changeStockRequest(req.id, { fixedQty: p.data.qty }, who.ctx.person.id);
  if (!r.ok) return r;
  await routeProduction(db, [req], who.ctx.person.id, Date.now());
  await db.audit({ actorId: who.ctx.person.id, siteId: req.siteId, action: "stock.request", detail: `${stockReqCode(req)}: amount set to ${p.data.qty}` });
  revalidateStock();
  return { ok: true };
}

/** The driver ticks an item off their list: got it (done), or couldn't (back on Stock needed). */
export async function driverTickAction(lineId: string, got: boolean): Promise<ActionResult> {
  const who = await stockWho();
  if (!who.ok) return who;
  if (!StockIdZ.safeParse(lineId).success) return { ok: false, error: "That isn't on your list any more" };
  const db = store();
  const r = await driverTick(db, who.ctx.person, lineId, got === true, Date.now());
  if (!r.ok) return r;
  const d = await taskOfLine(lineId);
  await db.audit({ actorId: who.ctx.person.id, siteId: d?.request?.siteId, action: got ? "stock.bought" : "stock.unavailable",
    detail: `${d ? stockTaskCode(d.task) : "List"}${d?.request ? ` ${stockReqCode(d.request)}` : ""}: ${got ? "bought" : "couldn't get it"}` });
  revalidateStock();
  return { ok: true };
}

async function taskOfLine(lineId: string) {
  const db = store();
  // A line's task: found through the recent records (the screens never show older ones).
  const data = await db.stockData({ since: stockSince(Date.now(), 365) });
  const line = data.lines.find((l) => l.id === lineId);
  const task = line && data.tasks.find((t) => t.id === line.taskId);
  return line && task ? { line, task, request: data.requests.find((r) => r.id === line.requestId) } : undefined;
}

/** The owner keeps the supplier list. */
export async function saveStockSupplier(id: string | undefined, input: { name: string; method: string; note?: string; link?: string; siteId?: string; active: boolean }): Promise<ActionResult> {
  const who = await purchasingOwner();
  if (!who.ok) return who;
  const db = store();
  const { suppliers } = await db.stockCatalog();
  const clean = cleanSupplier({ ...input, siteId: input.siteId || undefined }, suppliers, id);
  if (!clean.ok) return clean;
  if (clean.value.siteId && (await db.site(clean.value.siteId))?.kind !== "production") return { ok: false, error: "Choose a production kitchen" };
  await db.saveSupplier(id, clean.value, input.active !== false);
  await db.audit({ actorId: who.ctx.person.id, action: "stock.supplier", detail: `${id ? "Changed" : "Added"} supplier ${clean.value.name}${input.active === false ? " (off)" : ""}` });
  revalidateStock();
  return { ok: true };
}

/** The owner keeps the product catalogue: name, size, category, preferred supplier, link, on or off. */
export async function saveStockProduct(id: string | undefined, input: { name: string; size?: string; category?: string; supplierId?: string; link?: string; active: boolean }): Promise<ActionResult> {
  const who = await purchasingOwner();
  if (!who.ok) return who;
  const db = store();
  const { suppliers, products } = await db.stockCatalog();
  const clean = cleanProduct(input, suppliers, products, id);
  if (!clean.ok) return clean;
  const saved = await db.saveProduct(id, clean.value, input.active !== false);
  if (!saved) return { ok: false, error: "That product is already in the catalogue" };
  const before = id ? products.find((p) => p.id === id) : undefined;
  await db.audit({ actorId: who.ctx.person.id, action: "stock.product", detail: `${id ? "Changed" : "Added"} ${clean.value.name}${before && before.supplierId !== clean.value.supplierId ? `: supplier now ${suppliers.find((s) => s.id === clean.value.supplierId)?.name ?? "none"}` : ""}${input.active === false ? " (off)" : ""}` });
  revalidateStock();
  return { ok: true };
}

export async function addStockPrice(productId: string, input: { pounds: string; on: string; note?: string }): Promise<ActionResult> {
  const who = await purchasingOwner();
  if (!who.ok) return who;
  const db = store();
  const product = (await db.stockCatalog()).products.find((p) => p.id === productId);
  if (!product) return { ok: false, error: "That product isn't in the catalogue" };
  const clean = cleanStockPrice(input);
  if (!clean.ok) return clean;
  await db.addPrice({ productId, ...clean.value }, who.ctx.person.id);
  await db.audit({ actorId: who.ctx.person.id, action: "stock.price", detail: `${product.name}: £${(clean.value.pence / 100).toFixed(2)} on ${clean.value.on}` });
  revalidateStock();
  return { ok: true };
}

/** The owner keeps the list of people who can be given purchasing work (the Assign Driver / Buyer lists). */
export async function setPurchaserAction(personId: string, on: boolean): Promise<ActionResult> {
  const who = await purchasingOwner();
  if (!who.ok) return who;
  const db = store();
  const p = await db.person(personId);
  if (!p || p.status !== "active") return { ok: false, error: "That person isn't active" };
  await db.setPurchaser(p.id, on);
  await db.audit({ actorId: who.ctx.person.id, action: "stock.purchaser", detail: `${p.name} ${on ? "can now be given" : "no longer gets"} purchasing work` });
  revalidateStock();
  return { ok: true };
}

export async function setStockReminderAction(siteId: string, on: boolean): Promise<ActionResult> {
  const who = await purchasingOwner();
  if (!who.ok) return who;
  const db = store();
  const site = await db.site(SiteIdZ.parse(siteId));
  if (!site) return { ok: false, error: "Site not found" };
  await db.setSiteStockReminder(site.id, on);
  await db.audit({ actorId: who.ctx.person.id, siteId: site.id, action: "stock.reminder", detail: on ? "Closers asked for a stock report" : "Closers no longer asked for a stock report" });
  revalidateStock();
  return { ok: true };
}

// ---------- Production stock count (rules in src/lib/domain/stock-count.ts) ----------

const CountQtyZ = z.number().min(0).max(COUNT_MAX).nullable();

/** Sends a production count from the kitchen the person is signed in at. The planners are told (stock-service). */
export async function sendProductionCountNow(input: { lines: unknown; note?: unknown }): Promise<ActionResult & { below?: number; make?: number; counted?: number; of?: number }> {
  const who = await stockWho();
  if (!who.ok) return who;
  const { ctx } = who;
  if (!canCount(ctx.person, ctx.site)) return { ok: false, error: `You can't count production stock at ${ctx.site.name}` };
  const parsed = z.object({ lines: z.array(z.object({ productId: StockIdZ, qty: CountQtyZ })).max(500), note: z.string().max(COUNT_NOTE_MAX).optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Something in the count doesn't look right. Check the numbers and try again" };
  const db = store();
  const now = Date.now();
  const r = await sendProductionCount(db, ctx.person, ctx.site, parsed.data, now);
  if (!r.ok) return r;
  await db.audit({ actorId: ctx.person.id, siteId: ctx.site.id, action: "stock.count",
    detail: `Production count: ${r.value.counted} of ${r.value.of} items counted, ${r.value.make} to make, ${r.value.below} below target${r.value.count.note ? ` (${r.value.count.note})` : ""}` });
  revalidateStock();
  revalidatePath("/shift");
  return { ok: true, below: r.value.below, make: r.value.make, counted: r.value.counted, of: r.value.of };
}

/** Sets targets at a kitchen: owners, its managers and operations managers. Only the changed ones are added. */
export async function saveProductionTargets(siteId: string, input: unknown): Promise<ActionResult & { changed?: number }> {
  const who = await stockWho();
  if (!who.ok) return who;
  const db = store();
  const site = await db.site(SiteIdZ.parse(siteId));
  if (!site || !isKitchen(site)) return { ok: false, error: "That isn't a production kitchen" };
  if (!plansProduction(who.ctx.person, site.id)) return { ok: false, error: `Only owners and ${site.name}'s managers set its targets` };
  const parsed = z.array(z.object({ productId: StockIdZ, qty: CountQtyZ })).max(500).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Something in the targets doesn't look right. Check the numbers and try again" };
  const { products, suppliers } = await db.stockCatalog();
  const clean = cleanTargets(parsed.data, countProducts(products, suppliers, site.id));
  if (!clean.ok) return clean;
  const changed = changedTargets(clean.value, await db.stockTargets(site.id));
  if (!changed.length) return { ok: true, changed: 0 };
  await db.setStockTargets(site.id, changed, who.ctx.person.id);
  const names = changed.slice(0, 6).map((t) => `${products.find((p) => p.id === t.productId)?.name ?? "?"} ${t.qty ?? "none"}`).join(", ");
  await db.audit({ actorId: who.ctx.person.id, siteId: site.id, action: "stock.targets", detail: `Production targets: ${names}${changed.length > 6 ? ` and ${changed.length - 6} more` : ""}` });
  revalidateStock();
  return { ok: true, changed: changed.length };
}
