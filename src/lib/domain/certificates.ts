import { canManage, managedSites } from "./access";
import { addDays, dayMonthYear, daysBetween } from "./time";
import type { Person, SiteId } from "./types";

/**
 * Staff certificates and checks, with expiry dates and reminders. The app records what was done and when it
 * runs out; it doesn't store copies of documents. "Expected" sets are PHO & CO's standard, not legal advice.
 */

export type CertKind =
  | "food_hygiene_l2" | "food_hygiene_l3" | "allergen" | "first_aid" | "fire_marshal"
  | "health_safety" | "manual_handling" | "coshh" | "personal_licence" | "right_to_work";

export const CERT_KINDS: CertKind[] = [
  "food_hygiene_l2", "food_hygiene_l3", "allergen", "first_aid", "fire_marshal",
  "health_safety", "manual_handling", "coshh", "personal_licence", "right_to_work",
];

export interface CertType {
  id: CertKind; label: string; short: string;
  /** Suggested renewal, used to pre-fill the expiry date. Undefined: doesn't expire. */
  renewYears?: number;
  /** Who should hold it (person level). */
  expectedFor: "everyone" | "managers" | "none";
  /** At least one valid holder per site is recommended. */
  sitecover?: boolean;
  /** Only owners can see and edit it. */
  ownerOnly?: boolean;
  /** Form labels when "issued" and "expires" read wrongly for this kind. */
  dates?: { issued: string; expires: string };
  /** No certificate number for this kind (right to work: document numbers stay off the app). */
  noReference?: boolean;
  /** One line on why it matters. */
  why: string;
}

export const CERT_TYPES: CertType[] = [
  { id: "food_hygiene_l2", label: "Food hygiene Level 2", short: "Hygiene L2", renewYears: 3, expectedFor: "everyone",
    why: "Food handlers must be trained in food hygiene for the work they do. Level 2, refreshed every 3 years, is the usual way to show it" },
  { id: "allergen", label: "Allergen awareness", short: "Allergens", renewYears: 3, expectedFor: "everyone",
    why: "Staff must give correct allergen information. The Food Standards Agency's free online course counts" },
  { id: "right_to_work", label: "Right to work check", short: "Right to work", expectedFor: "everyone", ownerOnly: true, noReference: true,
    dates: { issued: "Checked on", expires: "Follow-up check due (time-limited permission only)" },
    why: "Check before someone starts work. If their permission is time-limited, the follow-up check must be done before it runs out" },
  { id: "food_hygiene_l3", label: "Food hygiene Level 3 (supervisor)", short: "Hygiene L3", renewYears: 3, expectedFor: "managers", sitecover: true,
    why: "For whoever supervises food handlers on a shift" },
  { id: "first_aid", label: "First aid (EFAW or FAW)", short: "First aid", renewYears: 3, expectedFor: "none", sitecover: true,
    why: "Each workplace needs adequate first aid cover. First aid at work certificates last 3 years" },
  { id: "fire_marshal", label: "Fire marshal / warden", short: "Fire marshal", renewYears: 3, expectedFor: "none", sitecover: true,
    why: "Staff need fire safety training, and a trained fire marshal on each shift is good practice" },
  { id: "health_safety", label: "Health and safety induction", short: "H&S induction", expectedFor: "none", why: "The site's risks, fire exits and how to report an accident" },
  { id: "manual_handling", label: "Manual handling", short: "Manual handling", renewYears: 3, expectedFor: "none", why: "Lifting deliveries, stock pots and boxes safely" },
  { id: "coshh", label: "COSHH (cleaning chemicals)", short: "COSHH", renewYears: 3, expectedFor: "none", why: "Safe use and storage of cleaning chemicals" },
  { id: "personal_licence", label: "Personal licence (alcohol)", short: "Personal licence", expectedFor: "none", why: "Needed by the designated premises supervisor where alcohol is sold. It doesn't expire" },
];

export const certType = (k: CertKind) => CERT_TYPES.find((t) => t.id === k)!;

/** The kinds a viewer can see: right to work is for owners only. */
export const visibleTypes = (isOwner: boolean) => CERT_TYPES.filter((t) => isOwner || !t.ownerOnly);

export interface Certificate {
  id: string; personId: string; kind: CertKind;
  issuedOn?: string; expiresOn?: string; provider?: string; reference?: string; note?: string;
  createdBy: string; createdByName?: string; createdAt: number;
}

export type CertStatus = "valid" | "expiring" | "expired" | "missing" | "none";

export const EXPIRING_DAYS = 30;
/** An "it has run out" message only goes this soon after the date, so back-filling old records doesn't send a flood. */
export const EXPIRED_REMINDER_DAYS = 14;

/** The status of one kind for one person: the record with the latest expiry counts (no expiry beats any date). */
export function certStatus(records: Certificate[], kind: CertKind, expected: boolean, today: string): { status: CertStatus; cert?: Certificate } {
  const mine = records.filter((r) => r.kind === kind);
  if (!mine.length) return { status: expected ? "missing" : "none" };
  const best = [...mine].sort((a, b) => (a.expiresOn ?? "9999-12-31").localeCompare(b.expiresOn ?? "9999-12-31") || a.createdAt - b.createdAt)[mine.length - 1];
  if (!best.expiresOn) return { status: "valid", cert: best };
  if (best.expiresOn < today) return { status: "expired", cert: best };
  if (best.expiresOn <= addDays(today, EXPIRING_DAYS)) return { status: "expiring", cert: best };
  return { status: "valid", cert: best };
}

/** Kinds this person is expected to hold under PHO & CO's standard. Owners aren't held to it. */
export function expectedKinds(person: Pick<Person, "access" | "status">): CertKind[] {
  if (person.status !== "active" || !person.access.length || person.access.some((a) => a.role === "owner")) return [];
  const isManager = person.access.some((a) => a.role === "manager");
  return CERT_TYPES.filter((t) => t.expectedFor === "everyone" || (t.expectedFor === "managers" && isManager)).map((t) => t.id);
}

/** Short words for a status, as shown in the matrix and on someone's page. */
export function statusText(kind: CertKind, s: { status: CertStatus; cert?: Pick<Certificate, "expiresOn"> }, today: string): string {
  const rtw = kind === "right_to_work";
  const exp = s.cert?.expiresOn;
  switch (s.status) {
    case "missing": return "Not recorded";
    case "none": return "Not held";
    case "valid": return exp ? `${rtw ? "Follow-up due" : "Valid to"} ${dayMonthYear(exp)}` : rtw ? "Checked" : "Held";
    case "expiring": {
      const d = daysBetween(today, exp!);
      const when = d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`;
      return rtw ? `Follow-up check due ${when}` : `Runs out ${when}`;
    }
    case "expired": return rtw ? `Follow-up check overdue since ${dayMonthYear(exp!)}` : `Ran out ${dayMonthYear(exp!)}`;
  }
}

export interface SiteCover { kind: CertKind; holders: string[] }

/** For each site-cover kind: who at the site holds a valid (or expiring, still valid) one. */
export function siteCover(siteId: SiteId, people: Pick<Person, "id" | "name" | "status" | "access">[], records: Certificate[], today: string): SiteCover[] {
  const here = people.filter((p) => p.status === "active" && p.access.some((a) => a.siteId === siteId));
  return CERT_TYPES.filter((t) => t.sitecover).map((t) => ({
    kind: t.id,
    holders: here.filter((p) => ["valid", "expiring"].includes(certStatus(records.filter((r) => r.personId === p.id), t.id, false, today).status)).map((p) => p.name),
  }));
}

/** Expiry date suggested from the issue date, for the form. */
export function suggestExpiry(kind: CertKind, issuedOn: string): string | undefined {
  const years = certType(kind).renewYears;
  if (!years || !/^\d{4}-\d{2}-\d{2}$/.test(issuedOn)) return undefined;
  const d = new Date(issuedOn + "T12:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

export type ReminderStage = "30" | "7" | "expired";

/** Certificate reminders are worked out once a day in this hour (London), so they arrive in the morning. */
export const CERT_REMINDER_FROM = "09:00";
export const CERT_REMINDER_UNTIL = "10:00";

/** Which reminder is due today: 30 days before, 7 days before, or just after it runs out (the last valid day is the expiry date). */
export function reminderDue(c: Pick<Certificate, "expiresOn">, today: string): ReminderStage | undefined {
  if (!c.expiresOn) return undefined;
  if (c.expiresOn < today) return c.expiresOn >= addDays(today, -EXPIRED_REMINDER_DAYS) ? "expired" : undefined;
  if (c.expiresOn <= addDays(today, 7)) return "7";
  if (c.expiresOn <= addDays(today, EXPIRING_DAYS)) return "30";
  return undefined;
}

export interface CertMessage { personId: string; title: string; body: string; dedupeKey: string; url: string }

/**
 * The reminder messages due today. For each active person and kind, only the record that counts (their latest)
 * is looked at, so a renewed certificate stops the reminders for the old one. The holder and the managers of
 * their sites are told; right to work goes to owners only. Each message has its own key so it's sent once.
 */
export function certReminderMessages(people: Pick<Person, "id" | "name" | "status" | "access">[], records: Certificate[], today: string): CertMessage[] {
  const out: CertMessage[] = [];
  const active = people.filter((p) => p.status === "active");
  for (const holder of active) {
    const mine = records.filter((r) => r.personId === holder.id);
    for (const kind of Array.from(new Set(mine.map((r) => r.kind)))) {
      const best = certStatus(mine, kind, false, today).cert;
      const stage = best && reminderDue(best, today);
      if (!best || !stage) continue;
      const t = certType(kind);
      const exp = best.expiresOn!;
      const days = daysBetween(today, exp);
      const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
      const key = (to: string) => `cert|${best.id}|${stage}|${to}`;
      const others = active.filter((p) => p.id !== holder.id && (t.ownerOnly
        ? p.access.some((a) => a.role === "owner")
        : holder.access.some((a) => canManage(p, a.siteId))));
      if (kind === "right_to_work") {
        for (const p of others) out.push(stage === "expired"
          ? { personId: p.id, title: `${holder.name}: right to work follow-up overdue`, body: `It was due by ${dayMonthYear(exp)}. Check their right to work now, then record it in Manage → Certificates.`, dedupeKey: key(p.id), url: `/manage/certificates/${holder.id}` }
          : { personId: p.id, title: `${holder.name}: right to work follow-up due ${when}`, body: `Their permission to work is time-limited. Do the follow-up check by ${dayMonthYear(exp)}, then record it in Manage → Certificates.`, dedupeKey: key(p.id), url: `/manage/certificates/${holder.id}` });
        continue;
      }
      out.push(stage === "expired"
        ? { personId: holder.id, title: `Your ${t.label} has run out`, body: `It ran out on ${dayMonthYear(exp)}. Speak to your manager about renewing it.`, dedupeKey: key(holder.id), url: "/me" }
        : { personId: holder.id, title: `Your ${t.label} runs out ${when}`, body: `Last valid day: ${dayMonthYear(exp)}. Speak to your manager about the refresher.`, dedupeKey: key(holder.id), url: "/me" });
      for (const p of others) out.push(stage === "expired"
        ? { personId: p.id, title: `${holder.name}: ${t.label} has run out`, body: `It ran out on ${dayMonthYear(exp)}. Book the refresher, then add the new certificate in Manage → Certificates.`, dedupeKey: key(p.id), url: `/manage/certificates/${holder.id}` }
        : { personId: p.id, title: `${holder.name}: ${t.label} runs out ${when}`, body: `Last valid day: ${dayMonthYear(exp)}. Book the refresher, then add the new certificate in Manage → Certificates.`, dedupeKey: key(p.id), url: `/manage/certificates/${holder.id}` });
    }
  }
  return out;
}

/** People a manager looks after: anyone (not left) with access to a site they manage. Owners see everyone. */
export function peopleInCare<P extends Pick<Person, "status" | "access">>(actor: Pick<Person, "access">, people: P[]): P[] {
  const isOwner = actor.access.some((a) => a.role === "owner");
  const managed = managedSites(actor);
  return people.filter((p) => p.status !== "left" && (isOwner || p.access.some((a) => managed.includes(a.siteId))));
}

/** Who may add or remove a person's records: a manager of one of their sites; right to work, owners only. */
export function canEditCerts(actor: Pick<Person, "id" | "access">, target: Pick<Person, "access" | "status">, kind?: CertKind): { ok: true } | { ok: false; error: string } {
  const isOwner = actor.access.some((a) => a.role === "owner");
  if (kind && certType(kind).ownerOnly && !isOwner) return { ok: false, error: "Only an owner can record right to work checks" };
  if (!isOwner && !target.access.some((a) => canManage(actor, a.siteId))) return { ok: false, error: "You can only update records for people at your sites" };
  return { ok: true };
}

export type CertInput = { kind: CertKind; issuedOn: string; expiresOn?: string; provider?: string; reference?: string; note?: string };

/** Checks a new record's dates: issued in the past (or today), expiry after it and not absurdly far away. */
export function validateCert(input: CertInput, today: string): { ok: true } | { ok: false; error: string } {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(input.issuedOn)) return { ok: false, error: `Choose the ${certType(input.kind).dates ? "date of the check" : "date it was issued"}` };
  if (input.issuedOn > today) return { ok: false, error: "That date is in the future" };
  if (input.issuedOn < "1970-01-01") return { ok: false, error: "Check the date" };
  if (input.expiresOn) {
    if (!iso.test(input.expiresOn)) return { ok: false, error: "Check the expiry date" };
    if (input.expiresOn < input.issuedOn) return { ok: false, error: "It can't run out before it was issued" };
    if (input.expiresOn > addDays(today, 365 * 15)) return { ok: false, error: "That expiry is more than 15 years away. Check the date" };
  }
  return { ok: true };
}

/** How many expected certificates are missing, expired or running out for these people, plus sites missing cover. */
export function issueCount(people: Pick<Person, "id" | "name" | "status" | "access">[], records: Certificate[], today: string, includeOwnerOnly: boolean, coverSites: SiteId[] = []): number {
  let n = 0;
  for (const p of people) {
    const mine = records.filter((r) => r.personId === p.id);
    for (const k of expectedKinds(p)) {
      if (!includeOwnerOnly && certType(k).ownerOnly) continue;
      if (certStatus(mine, k, true, today).status !== "valid") n++;
    }
  }
  for (const s of coverSites) n += siteCover(s, people, records, today).filter((c) => !c.holders.length).length;
  return n;
}
