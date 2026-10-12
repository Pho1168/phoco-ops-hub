import { isLead, isOps, isOwner, opsSites } from "./access";
import type { Area, Person, Role, Site, SiteAccess, SiteId } from "./types";

/** Staff IDs are three digits (001, 002 ...) and match the Staff ID column in the rota sheets. */
export const STAFF_CODE = /^\d{3}$/;

/**
 * Reads a staff ID the way people type it or Google Sheets stores it: "1", "01", "001" and the
 * older "PC-0001" all become "001". Returns null when it can't be a staff ID.
 */
export function normalizeStaffCode(input: string | number | null | undefined): string | null {
  const s = String(input ?? "").trim().toUpperCase();
  const m = /^(?:PC-?)?0*(\d{1,3})$/.exec(s);
  return m ? m[1].padStart(3, "0") : null;
}
/** In the order the staff form shows them. */
export const ROLES: Role[] = ["staff", "manager", "ops", "owner"];
export const ROLE_LABEL: Record<Role, string> = { staff: "Staff", manager: "Manager", ops: "Operations manager", owner: "Owner" };
/** Short enough for the role buttons and the accounts list. */
export const ROLE_SHORT: Record<Role, string> = { staff: "Staff", manager: "Manager", ops: "Ops manager", owner: "Owner" };
/** These roles see every section at the site, so choosing sections is optional. */
const SEES_ALL_SECTIONS: Role[] = ["owner", "ops"];

/** Sections that exist at each kind of site. */
export function sectionsFor(kind: Site["kind"]): Area[] {
  return kind === "production" ? ["PROD"] : ["FOH", "BOH"];
}

export interface PersonInput { staffCode: string; name: string; access: SiteAccess[] }
export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Cleans and checks the details an owner or operations manager enters for a person.
 * `editingId` is the person being edited, so their own staff ID doesn't count as taken. `canSee`: whose name may be
 * given when their staff ID is taken (an operations manager isn't told who has it at another site).
 */
export function validatePersonInput(input: PersonInput, sites: Site[], people: Person[], editingId?: string, canSee: (p: Person) => boolean = () => true): Checked<PersonInput> {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "Add a name" };
  if (name.length > 40) return { ok: false, error: "Keep the name under 40 characters" };
  const staffCode = normalizeStaffCode(input.staffCode);
  if (!staffCode || !STAFF_CODE.test(staffCode)) return { ok: false, error: "Staff ID must be a number from 001 to 999" };
  const taken = people.find((p) => normalizeStaffCode(p.staffCode) === staffCode && p.id !== editingId);
  if (taken) return { ok: false, error: canSee(taken) ? `${staffCode} is already used by ${taken.name}` : `${staffCode} is already used by someone at another site` };

  if (!input.access.length) return { ok: false, error: "Choose at least one site" };
  const seen = new Set<SiteId>();
  const access: SiteAccess[] = [];
  for (const a of input.access) {
    const site = sites.find((s) => s.id === a.siteId);
    if (!site) return { ok: false, error: "Unknown site" };
    if (seen.has(a.siteId)) return { ok: false, error: `${site.name} is listed twice` };
    seen.add(a.siteId);
    if (!ROLES.includes(a.role)) return { ok: false, error: "Unknown role" };
    const allowed = sectionsFor(site.kind);
    const sections = Array.from(new Set(a.sections)).filter((s) => allowed.includes(s));
    if (!SEES_ALL_SECTIONS.includes(a.role) && !sections.length) return { ok: false, error: `Choose at least one section at ${site.name}` };
    access.push({ siteId: a.siteId, role: a.role, sections });
  }
  return { ok: true, value: { staffCode, name, access } };
}

const activeOwners = (people: Person[]) => people.filter((p) => p.status === "active" && isOwner(p));

/** Owners can't remove their own owner role, and the business must always keep one active owner. */
export function canChangeAccess(actor: Person, target: Person, next: SiteAccess[], people: Person[]): Checked<true> {
  const losingOwner = isOwner(target) && !isOwner({ access: next });
  if (!losingOwner) return { ok: true, value: true };
  if (actor.id === target.id) return { ok: false, error: "You can't remove your own owner access" };
  if (activeOwners(people).filter((p) => p.id !== target.id).length < 1) return { ok: false, error: "This is the last owner. Add another owner first" };
  return { ok: true, value: true };
}

/**
 * Marking someone as left ends their access for good (records stay). Same safeguards as freezing. Someone frozen by a
 * site closure is the owner's to mark as left (rejoining would otherwise lift the closure's freeze).
 */
export function canMarkLeft(actor: Person, target: Person, people: Person[]): Checked<true> {
  if (actor.id === target.id) return { ok: false, error: "You can't mark yourself as left" };
  if (target.status === "left") return { ok: false, error: "They're already marked as left" };
  if (!isOwner(actor) && target.frozenReason?.startsWith("site:")) return { ok: false, error: CLOSURE_FREEZE };
  if (isOwner(target) && activeOwners(people).filter((p) => p.id !== target.id).length < 1)
    return { ok: false, error: "This is the last owner. Add another owner first" };
  return { ok: true, value: true };
}

/** Rejoining is only for someone marked as left. */
export function canRejoin(target: Pick<Person, "status">): Checked<true> {
  return target.status === "left" ? { ok: true, value: true } : { ok: false, error: "They haven't been marked as left" };
}

const CLOSURE_FREEZE = "Frozen because their site is closed. It ends when the owner reopens the site";
const NOT_A_LEAD = "Only the owner or an operations manager can change accounts";

/** The roles someone can give, in the form's order: owners any; operations managers staff and managers only. */
export function givableRoles(actor: Pick<Person, "access">): Role[] {
  return isOwner(actor) ? ROLES : isOps(actor) ? ["staff", "manager"] : [];
}

/**
 * Whether someone may look after this person's account: edit it, set a temporary PIN, log them out, freeze it or
 * mark them as left. Owners: anyone (the last-owner safeguards still apply). Operations managers: staff and managers
 * who work only at sites they run. Their own account, owners and other operations managers are the owner's to change.
 */
export function canManageAccount(actor: Pick<Person, "id" | "access">, target: Pick<Person, "id" | "access" | "seesRightToWork">): Checked<true> {
  if (isOwner(actor)) return { ok: true, value: true };
  if (!isOps(actor)) return { ok: false, error: NOT_A_LEAD };
  if (actor.id === target.id) return { ok: false, error: "Ask the owner to change your own account" };
  if (isLead(target)) return { ok: false, error: "Only the owner can change an owner's or operations manager's account" };
  // Someone who can see right to work checks: a temporary PIN would let anyone else in to see them.
  if (target.seesRightToWork) return { ok: false, error: "Only the owner can change this account" };
  const mine = opsSites(actor);
  if (!target.access.length) return { ok: false, error: "Only the owner can change this account" };
  if (target.access.some((a) => !mine.includes(a.siteId))) return { ok: false, error: "They also work at a site you don't run, so the owner changes their account" };
  return { ok: true, value: true };
}

/** The access someone may give: owners anything; operations managers staff or manager roles at sites they run. */
export function canGiveAccess(actor: Pick<Person, "access">, next: Pick<SiteAccess, "siteId" | "role">[]): Checked<true> {
  if (isOwner(actor)) return { ok: true, value: true };
  if (!isOps(actor)) return { ok: false, error: NOT_A_LEAD };
  const roles = givableRoles(actor), mine = opsSites(actor);
  if (next.some((a) => !roles.includes(a.role))) return { ok: false, error: "Only the owner can make someone an owner or operations manager" };
  if (next.some((a) => !mine.includes(a.siteId))) return { ok: false, error: "You can only give access to sites you run" };
  return { ok: true, value: true };
}

/** Taking a freeze off. A freeze from closing a site is the owner's: it ends when they reopen the site. */
export function canUnfreeze(actor: Pick<Person, "access">, target: Pick<Person, "status" | "frozenReason">): Checked<true> {
  if (target.status !== "frozen") return { ok: false, error: "This account isn't frozen" };
  if (!isOwner(actor) && target.frozenReason?.startsWith("site:")) return { ok: false, error: CLOSURE_FREEZE };
  return { ok: true, value: true };
}

/** The accounts on a lead's overview: everyone for an owner; for an operations manager, anyone with access to a site they run. */
export function accountsFor<P extends Pick<Person, "access">>(actor: Pick<Person, "access">, people: P[]): P[] {
  if (isOwner(actor)) return people;
  const mine = isOps(actor) ? opsSites(actor) : [];
  return people.filter((p) => p.access.some((a) => mine.includes(a.siteId)));
}

/** The next free staff ID, e.g. 009 when 001..008 exist. */
export function nextStaffCode(people: Person[]): string {
  const used = people.map((p) => normalizeStaffCode(p.staffCode)).filter((c): c is string => !!c).map(Number);
  const n = used.length ? Math.max(...used) + 1 : 1;
  return String(Math.min(n, 999)).padStart(3, "0");
}
