"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DEMO_MODE, store } from "@/lib/data";
import { canUseDeviceForSite, formatPairCode, makePairCode, normalizePairCode, PAIR_TTL_MINUTES } from "@/lib/domain/devices";
import { currentDevice, DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE, newDeviceToken, sha256 } from "@/lib/device";
import { pushToPerson } from "@/lib/push";
import { rotaScript } from "@/lib/rota-script";
import { headers } from "next/headers";
import { randomInt } from "node:crypto";
import { canFreeze, canManage, canSignIn, isPinLocked, managedSites, planSiteClosure, registerPinFailure } from "@/lib/domain/access";
import { canCancel, canDecide, clashes, kindLabel, rangeLabel, validateRequest } from "@/lib/domain/timeoff";
import { canPostTo, inAudience, NOTICE_BODY_MAX, NOTICE_TITLE_MAX } from "@/lib/domain/notices";
import { afterQuietHours, dayMonthYear, isIsoDate, londonDate } from "@/lib/domain/time";
import { canEditCerts, certType, validateCert, CERT_KINDS, type CertKind } from "@/lib/domain/certificates";
import { canComplete, categoryLabel, isForPerson, priorityCode, validateTask, TASK_CATEGORIES, type Priority, type TaskCategory } from "@/lib/domain/tasks";
import { canManageEquipment, canUseEquipment, faultReportedMessages, faultsOf, siteManagers, validateEquipment, validateService,
  EQUIPMENT_KINDS, INSTRUCTIONS_MAX, NAME_MAX, SEVERITY_LABEL, TEXT_MAX, type EquipmentKind } from "@/lib/domain/equipment";
import { deliverDue } from "@/lib/rota-service";
import { canSignOff, evaluateAnswer } from "@/lib/domain/checklist";
import { hashPin, isValidPin, PIN_RULE, verifyPin } from "@/lib/domain/pin";
import { canUndo, canUsePrep, planSubmit, shiftLabel } from "@/lib/domain/prep";
import { NOTE_CATEGORIES } from "@/lib/domain/handover";
import { canChangeAccess, canMarkLeft, normalizeStaffCode, sectionsFor, validatePersonInput } from "@/lib/domain/staff";
import type { SiteId } from "@/lib/domain/types";
import { current, londonNow, requireCtx, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/session";

const SiteIdZ = z.enum(["EAS", "WEM", "SYD"]);
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
  cookies().set(SESSION_COOKIE, s.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: ttl / 1000, path: "/" });
}

/**
 * Sign-in by staff ID + PIN on a device that isn't a registered site tablet (someone's own phone or computer).
 * Owners get the full app. Everyone else gets "My shifts" only: their own shifts and messages, no names, no checklists.
 * The error is the same "not recognised" for every failure, so the screen gives nothing away.
 */
export async function staffIdSignIn(staffCode: string, pin: string): Promise<ActionResult> {
  const db = store();
  const code = normalizeStaffCode(z.string().max(20).parse(staffCode));
  const notRecognised = { ok: false as const, error: "Staff ID or PIN not recognised" };
  const person = code ? (await db.people()).find((p) => normalizeStaffCode(p.staffCode) === code) : undefined;
  if (!person || !person.access.length) return notRecognised;
  const isOwner = person.access.some((a) => a.role === "owner");
  const sites = await db.sites();
  const mine = person.access.map((a) => sites.find((s) => s.id === a.siteId)).filter((s): s is NonNullable<typeof s> => !!s);
  const site = mine.find((s) => s.status === "open") ?? (isOwner ? mine[0] : undefined);
  if (!site) return notRecognised;
  const now = Date.now();
  const gate = canSignIn(person, site, now);
  if (!gate.allowed) return { ok: false, error: gate.reason };
  if (!verifyPin(pin, person.pinHash)) {
    await db.updatePerson(person.id, registerPinFailure(person, now));
    await db.audit({ actorId: person.id, action: "signin.failed", detail: "Wrong PIN (staff ID sign-in, unregistered device)" });
    return notRecognised;
  }
  if (isOwner) {
    await startSession(person.id, site.id);
    await db.audit({ actorId: person.id, siteId: site.id, action: "signin", detail: "Owner signed in on an unregistered device" });
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
  if (!device) return { ok: false, error: "Code not recognised, already used or expired. Ask an owner for a new one" };
  cookies().set(DEVICE_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: DEVICE_COOKIE_MAX_AGE, path: "/" });
  cookies().delete(SESSION_COOKIE);
  await store().audit({ siteId: device.siteId, action: "device.paired", detail: `${device.label} set up` });
  return { ok: true };
}

export async function signOut() {
  const sid = cookies().get(SESSION_COOKIE)?.value;
  if (sid) {
    const db = store();
    const s = await db.session(sid);
    if (s) await db.revokeSessions({ personId: s.personId, siteId: s.siteId }, "signed out");
  }
  cookies().delete(SESSION_COOKIE);
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
      cookies().delete(SESSION_COOKIE);
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
const NoteZ = z.object({
  category: z.enum(NOTE_CATEGORIES),
  body: z.string().trim().min(1, "Write the note first").max(1000, "Keep the note under 1000 characters"),
  needsAction: z.boolean(),
});

/** A note for the next shift. Shows straight away on the Handover tab and goes on the next handover report. */
export async function addNote(input: unknown): Promise<ActionResult> {
  const ctx = await requireCtx();
  const n = NoteZ.safeParse(input);
  if (!n.success) return { ok: false, error: n.error.issues[0]?.message ?? "That note couldn't be saved" };
  await store().addHandover({ siteId: ctx.site.id, createdBy: ctx.person.id, ...n.data });
  await store().audit({ actorId: ctx.person.id, siteId: ctx.site.id, action: "handover.add",
    detail: `${n.data.needsAction ? "Needs action" : "For info"} · ${n.data.category}: ${n.data.body}` });
  revalidatePath("/handover"); revalidatePath("/today");
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
const PrepItemZ = z.string().regex(/^kp-\d{3}$/);
const UuidZ = z.string().uuid();

/** Anyone working at a site where the prep board is switched on. */
async function prepCtx(): Promise<{ ctx: Awaited<ReturnType<typeof requireCtx>>; error?: string }> {
  const ctx = await requireCtx();
  if (!canUsePrep(ctx.access)) return { ctx, error: "You don't work at this site" };
  if (!(await store().prepEnabledSites()).includes(ctx.site.id)) return { ctx, error: `Kitchen prep isn't switched on at ${ctx.site.name}` };
  return { ctx };
}

/** Draft changes save as staff tap, so a refresh or a second phone sees the same draft. */
export async function prepEditDraft(input: unknown): Promise<ActionResult> {
  const { ctx, error } = await prepCtx();
  if (error) return { ok: false, error };
  const c = z.object({
    shift: PrepShiftZ.optional(), itemId: PrepItemZ.optional(), needed: z.boolean().optional(),
    urgent: z.boolean().optional(), note: z.string().trim().max(200).nullable().optional(),
  }).safeParse(input);
  if (!c.success) return { ok: false, error: "That change couldn't be saved" };
  if (c.data.itemId && !(await store().prepItems()).some((i) => i.id === c.data.itemId && i.active)) return { ok: false, error: "That item isn't on the list any more" };
  await store().prepEditDraft(ctx.site.id, ctx.person.id, c.data);
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

async function requireOwner() {
  const ctx = await requireCtx();
  if (!ctx.isOwner) redirect("/today");
  return ctx;
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
  const ctx = await requireOwner();
  const db = store();
  const target = await db.person(personId);
  if (!target) return { ok: false, error: "Person not found" };
  if (frozen) {
    const ok = canFreeze(ctx.person, target, await db.people());
    if (!ok.allowed) return { ok: false, error: ok.reason };
    await db.updatePerson(personId, { status: "frozen", frozenReason: "owner" });
    await db.revokeSessions({ personId }, "account frozen by owner");
  } else {
    await db.updatePerson(personId, { status: "active", frozenReason: undefined });
  }
  await db.audit({ actorId: ctx.person.id, action: frozen ? "person.freeze" : "person.unfreeze", detail: target.name });
  revalidatePath("/owner");
  return { ok: true };
}

export async function logOutEverywhere(personId: string): Promise<ActionResult> {
  const ctx = await requireOwner();
  const db = store();
  const n = await db.revokeSessions({ personId }, "logged out by owner");
  const p = await db.person(personId);
  await db.audit({ actorId: ctx.person.id, action: "person.logout", detail: `${p?.name}: ${n} sessions ended` });
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

export async function switchSite(siteId: string): Promise<void> {
  const ctx = await requireOwner();
  const db = store();
  const id = SiteIdZ.parse(siteId);
  await db.revokeSessions({ personId: ctx.person.id, siteId: ctx.site.id }, "switched site");
  const prev = await db.session(ctx.sessionId);
  const s = await db.createSession(ctx.person.id, id, SESSION_TTL_MS, prev?.deviceId);
  cookies().set(SESSION_COOKIE, s.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: SESSION_TTL_MS / 1000, path: "/" });
  redirect("/today");
}

// ---------- staff management (owners) ----------

const AccessZ = z.array(z.object({
  siteId: SiteIdZ,
  role: z.enum(["owner", "manager", "staff"]),
  sections: z.array(z.enum(["FOH", "BOH", "PROD"])).max(3),
})).max(3);
const PersonZ = z.object({ staffCode: z.string().max(20), name: z.string().max(80), access: AccessZ });
const describeAccess = (a: z.infer<typeof AccessZ>) => a.map((x) => `${x.siteId} ${x.role}${x.sections.length ? ` (${x.sections.join("+")})` : ""}`).join(", ");

export async function createPerson(input: unknown, tempPin: string): Promise<ActionResult & { id?: string }> {
  const ctx = await requireOwner();
  const db = store();
  const parsed = PersonZ.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Some details are missing" };
  const checked = validatePersonInput(parsed.data, await db.sites(), await db.people());
  if (!checked.ok) return checked;
  if (!isValidPin(tempPin)) return { ok: false, error: `Temporary PIN: ${PIN_RULE}` };
  const id = await db.createPerson({ ...checked.value, pinHash: hashPin(tempPin), pinMustChange: true });
  await db.audit({ actorId: ctx.person.id, action: "person.create", detail: `Added ${checked.value.name} (${checked.value.staffCode}): ${describeAccess(checked.value.access)}` });
  revalidatePath("/owner");
  return { ok: true, id };
}

export async function updatePerson(personId: string, input: unknown): Promise<ActionResult> {
  const ctx = await requireOwner();
  const db = store();
  const target = await db.person(z.string().max(64).parse(personId));
  if (!target) return { ok: false, error: "Person not found" };
  const parsed = PersonZ.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Some details are missing" };
  const people = await db.people();
  const checked = validatePersonInput(parsed.data, await db.sites(), people, target.id);
  if (!checked.ok) return checked;
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
  const ctx = await requireOwner();
  const db = store();
  const target = await db.person(z.string().max(64).parse(personId));
  if (!target) return { ok: false, error: "Person not found" };
  if (target.id === ctx.person.id) return { ok: false, error: "Change your own PIN from \"My PIN\" instead" };
  if (!isValidPin(tempPin)) return { ok: false, error: `Temporary PIN: ${PIN_RULE}` };
  await db.updatePerson(target.id, { pinHash: hashPin(tempPin), pinMustChange: true, pinFailed: 0, pinLockedUntil: undefined });
  await db.revokeSessions({ personId: target.id }, "PIN reset by owner");
  await db.audit({ actorId: ctx.person.id, action: "person.pin_reset", detail: `Temporary PIN set for ${target.name}` });
  revalidatePath(`/staff/${target.id}`);
  return { ok: true };
}

export async function setLeft(personId: string, left: boolean): Promise<ActionResult> {
  const ctx = await requireOwner();
  const db = store();
  const target = await db.person(z.string().max(64).parse(personId));
  if (!target) return { ok: false, error: "Person not found" };
  if (left) {
    const allowed = canMarkLeft(ctx.person, target, await db.people());
    if (!allowed.ok) return allowed;
    await db.updatePerson(target.id, { status: "left", frozenReason: undefined });
    await db.revokeSessions({ personId: target.id }, "marked as left");
  } else {
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
      cookies().delete(SESSION_COOKIE);
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

// ---------- site devices (owners) ----------

export async function createPairingCode(siteId: string, label: string): Promise<ActionResult & { code?: string; expiresAt?: number }> {
  const ctx = await requireOwner();
  const db = store();
  const site = await db.site(SiteIdZ.parse(siteId));
  if (!site) return { ok: false, error: "Site not found" };
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
  const ctx = await requireOwner();
  const db = store();
  const device = await db.device(z.string().max(64).parse(deviceId));
  if (!device) return { ok: false, error: "Device not found" };
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
  const h = headers();
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
  await pushToPerson(ctx.person.id, { title: "Reminders are on", body: "You'll get a message the evening before each shift and when your rota changes.", url: "/me" });
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
  const openSites = (await db.sites()).filter((s) => s.status === "open").map((s) => s.id);
  const siteId = n.data.siteId ?? undefined;
  if (!canPostTo(managed, openSites, siteId)) return { ok: false, error: "You can only post to sites you manage" };
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
  const openSites = (await db.sites()).filter((s) => s.status === "open").map((s) => s.id);
  if (!canPostTo(managedSites(ctx.person), openSites, n.siteId)) return { ok: false, error: "Only a manager of that site can take it down" };
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

/** Messages the managers of a site (not the person themself) about time off. Pushed if they have notifications on. */
async function tellManagers(siteId: SiteId, exceptId: string, title: string, body: string, dedupeKey: string) {
  const db = store();
  const now = Date.now();
  const told: string[] = [];
  for (const p of (await db.people()).filter((p) => p.status === "active" && p.id !== exceptId && canManage(p, siteId))) {
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
  await tellManagers(ctx.site.id, ctx.person.id, `Time off request: ${ctx.person.name}`,
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
  const ok = canDecide(ctx.person, t);
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
  if (t.status === "approved") await tellManagers(t.siteId, ctx.person.id, `Time off withdrawn: ${ctx.person.name}`, `${rangeLabel(t)} is no longer needed`, `timeoff-withdrawn|${t.id}`);
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
