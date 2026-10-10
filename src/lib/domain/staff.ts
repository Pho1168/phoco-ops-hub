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
const ROLES: Role[] = ["owner", "manager", "staff"];

/** Sections that exist at each kind of site. */
export function sectionsFor(kind: Site["kind"]): Area[] {
  return kind === "production" ? ["PROD"] : ["FOH", "BOH"];
}

export interface PersonInput { staffCode: string; name: string; access: SiteAccess[] }
export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Cleans and checks the details an owner enters for a person.
 * `editingId` is the person being edited, so their own staff ID doesn't count as taken.
 */
export function validatePersonInput(input: PersonInput, sites: Site[], people: Person[], editingId?: string): Checked<PersonInput> {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "Add a name" };
  if (name.length > 40) return { ok: false, error: "Keep the name under 40 characters" };
  const staffCode = normalizeStaffCode(input.staffCode);
  if (!staffCode || !STAFF_CODE.test(staffCode)) return { ok: false, error: "Staff ID must be a number from 001 to 999" };
  const taken = people.find((p) => normalizeStaffCode(p.staffCode) === staffCode && p.id !== editingId);
  if (taken) return { ok: false, error: `${staffCode} is already used by ${taken.name}` };

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
    if (a.role !== "owner" && !sections.length) return { ok: false, error: `Choose at least one section at ${site.name}` };
    access.push({ siteId: a.siteId, role: a.role, sections });
  }
  return { ok: true, value: { staffCode, name, access } };
}

const isOwner = (access: SiteAccess[]) => access.some((a) => a.role === "owner");
const activeOwners = (people: Person[]) => people.filter((p) => p.status === "active" && isOwner(p.access));

/** Owners can't remove their own owner role, and the business must always keep one active owner. */
export function canChangeAccess(actor: Person, target: Person, next: SiteAccess[], people: Person[]): Checked<true> {
  const losingOwner = isOwner(target.access) && !isOwner(next);
  if (!losingOwner) return { ok: true, value: true };
  if (actor.id === target.id) return { ok: false, error: "You can't remove your own owner access" };
  if (activeOwners(people).filter((p) => p.id !== target.id).length < 1) return { ok: false, error: "This is the last owner. Add another owner first" };
  return { ok: true, value: true };
}

/** Marking someone as left ends their access for good (records stay). Same safeguards as freezing. */
export function canMarkLeft(actor: Person, target: Person, people: Person[]): Checked<true> {
  if (actor.id === target.id) return { ok: false, error: "You can't mark yourself as left" };
  if (isOwner(target.access) && activeOwners(people).filter((p) => p.id !== target.id).length < 1)
    return { ok: false, error: "This is the last owner. Add another owner first" };
  return { ok: true, value: true };
}

/** The next free staff ID, e.g. 009 when 001..008 exist. */
export function nextStaffCode(people: Person[]): string {
  const used = people.map((p) => normalizeStaffCode(p.staffCode)).filter((c): c is string => !!c).map(Number);
  const n = used.length ? Math.max(...used) + 1 : 1;
  return String(Math.min(n, 999)).padStart(3, "0");
}
