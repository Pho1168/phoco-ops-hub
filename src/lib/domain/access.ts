import type { Person, Site, SiteId } from "./types";

export const MAX_PIN_ATTEMPTS = 5;
export const PIN_LOCK_MINUTES = 15;

export type SignInCheck = { allowed: true } | { allowed: false; reason: string };

/** Whether a person may start a session at a site right now. PIN correctness is checked separately. */
export function canSignIn(person: Person, site: Site, now: number): SignInCheck {
  const access = person.access.find((a) => a.siteId === site.id);
  if (!access) return { allowed: false, reason: `You don't have access to ${site.name}` };
  if (person.status === "frozen") return { allowed: false, reason: "Your account is frozen. Speak to your manager" };
  if (person.status === "left") return { allowed: false, reason: "This account is no longer active" };
  if (isPinLocked(person, now))
    return { allowed: false, reason: "Too many wrong PINs. Try again in a few minutes or ask a manager" };
  if (site.status === "closed" && access.role !== "owner")
    return { allowed: false, reason: `${site.name} is closed. Sign-in is frozen until the owner reopens it` };
  return { allowed: true };
}

/** True while an account is locked out after too many wrong PINs (sign-in and sign-off share the count). */
export function isPinLocked(person: Pick<Person, "pinLockedUntil">, now: number): boolean {
  return !!person.pinLockedUntil && person.pinLockedUntil > now;
}

/** Result of a wrong PIN: counts the failure and locks after MAX_PIN_ATTEMPTS. */
export function registerPinFailure(person: Person, now: number): Pick<Person, "pinFailed" | "pinLockedUntil"> {
  const failed = person.pinFailed + 1;
  if (failed >= MAX_PIN_ATTEMPTS) return { pinFailed: 0, pinLockedUntil: now + PIN_LOCK_MINUTES * 60_000 };
  return { pinFailed: failed, pinLockedUntil: person.pinLockedUntil };
}

export interface LockdownPlan {
  /** Accounts whose only working site is the closed one: frozen. */
  freeze: string[];
  /** People who also work elsewhere: only their sessions at this site end. */
  endSessionsOnly: string[];
  /** Owners are never locked out by a site closure. */
  untouched: string[];
}

/**
 * What "Close site" does to each person. Multi-site staff keep access to their other sites;
 * owners keep access everywhere so the business can never lock itself out.
 */
export function planSiteClosure(siteId: SiteId, people: Person[], openSites: Set<SiteId>): LockdownPlan {
  const plan: LockdownPlan = { freeze: [], endSessionsOnly: [], untouched: [] };
  for (const p of people) {
    const here = p.access.find((a) => a.siteId === siteId);
    if (!here) continue;
    if (here.role === "owner" || p.access.some((a) => a.role === "owner")) { plan.untouched.push(p.id); continue; }
    const elsewhere = p.access.some((a) => a.siteId !== siteId && openSites.has(a.siteId));
    (elsewhere ? plan.endSessionsOnly : plan.freeze).push(p.id);
  }
  return plan;
}

/** An owner can't freeze themself, and the last active owner can't be frozen. */
export function canFreeze(actor: Person, target: Person, people: Person[]): SignInCheck {
  if (actor.id === target.id) return { allowed: false, reason: "You can't freeze your own account" };
  const isOwner = (p: Person) => p.access.some((a) => a.role === "owner");
  if (isOwner(target) && people.filter((p) => isOwner(p) && p.status === "active").length <= 1)
    return { allowed: false, reason: "This is the last owner account. Add another owner first" };
  return { allowed: true };
}
