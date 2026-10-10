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
import { canFreeze, canSignIn, isPinLocked, planSiteClosure, registerPinFailure } from "@/lib/domain/access";
import { canSignOff, evaluateAnswer } from "@/lib/domain/checklist";
import { hashPin, isValidPin, PIN_RULE, verifyPin } from "@/lib/domain/pin";
import { canUndo, canUsePrep, planSubmit, shiftLabel } from "@/lib/domain/prep";
import { canChangeAccess, canMarkLeft, normalizeStaffCode, validatePersonInput } from "@/lib/domain/staff";
import type { SiteId } from "@/lib/domain/types";
import { current, londonNow, requireCtx, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/session";

const SiteIdZ = z.enum(["EAS", "WEM", "SYD"]);
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

export async function addHandover(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  const body = String(form.get("body") || "").trim().slice(0, 1000);
  if (!body) return;
  await store().addHandover({ siteId: ctx.site.id, category: String(form.get("category") || "Note"), body, needsAction: form.get("needsAction") === "on", createdBy: ctx.person.id });
  await store().audit({ actorId: ctx.person.id, siteId: ctx.site.id, action: "handover.add", detail: body });
  revalidatePath("/handover");
}

export async function closeHandover(id: string): Promise<void> {
  const ctx = await requireCtx();
  await store().closeHandover(z.string().max(64).parse(id), ctx.person.id);
  revalidatePath("/handover");
}

// ---------- kitchen prep ----------
const PrepShiftZ = z.enum(["next", "tomorrow_am", "tomorrow_pm"]);
const PrepItemZ = z.string().regex(/^kp-\d{3}$/);
const UuidZ = z.string().uuid();

/** Kitchen staff (BOH) and managers, at a site where the prep board is switched on. */
async function prepCtx(): Promise<{ ctx: Awaited<ReturnType<typeof requireCtx>>; error?: string }> {
  const ctx = await requireCtx();
  if (!canUsePrep(ctx.access, ctx.isManager)) return { ctx, error: "Kitchen prep is for kitchen staff and managers" };
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
  revalidatePath("/prep"); revalidatePath("/today");
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
  revalidatePath("/prep"); revalidatePath("/today");
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

export async function resolveAlert(id: string, note: string): Promise<ActionResult> {
  const ctx = await requireCtx();
  if (!ctx.isManager) return { ok: false, error: "Only managers can resolve alerts" };
  if (!note.trim()) return { ok: false, error: "Say what was done" };
  await store().resolveAlert(z.string().max(64).parse(id), ctx.person.id, note.trim().slice(0, 500));
  await store().audit({ actorId: ctx.person.id, siteId: ctx.site.id, action: "alert.resolve", detail: note.trim() });
  revalidatePath("/owner");
  revalidatePath("/today");
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
  const db = store();
  const mine = await db.pushSubs(ctx.person.id);
  if (mine.some((s) => s.endpoint === endpoint)) await db.dropPushSub(endpoint);
  return { ok: true };
}
