import { isLead, isOps, isOwner, managedSites, opsSites } from "./access";
import { addMonths } from "./equipment";
import { sectionsFor } from "./staff";
import { addDays, isIsoDate } from "./time";
import type { Area, Person, Site, SiteId } from "./types";

/**
 * The library: SOPs as versioned, approved documents (recipes use the same steps). Managers, operations managers and
 * owners write drafts; an owner or operations manager approves and publishes, never a version they wrote or sent for
 * approval (an owner may, so they're never stuck). Only published versions reach staff. A published version is never
 * changed: an edit is a new draft, and publishing it replaces the old one, which is kept. Documents are retired, never
 * deleted. Everyone a published version is for reads it and confirms they have, once per version.
 */

export type LibraryKind = "sop";
export type VersionStatus = "draft" | "in_review" | "published" | "superseded" | "discarded";
/** What publishing a version means for staff: a new SOP, an update to re-read, or a major change to re-learn. */
export type ChangeKind = "new" | "minor" | "major";

export interface Photo { id: string; w: number; h: number }
export interface SopStep { text: string; warning?: string; photo?: Photo }
/** `sections`: who it's for (none: everyone). */
export interface SopBody { sections: Area[]; purpose: string; steps: SopStep[] }

export interface LibraryVersion {
  id: string; docId: string; status: VersionStatus;
  /** 1, 2, 3 … once published. */
  version?: number;
  title: string; body: SopBody;
  authorId: string; authorName: string; createdAt: number; updatedAt: number;
  /** Everyone who wrote, changed or sent this version: none of them can approve it (owners excepted). */
  contributors: string[];
  /** Goes up with every change: an action names the revision it was shown, so nobody acts on a version they haven't seen. */
  rev: number;
  submittedBy?: string; submittedAt?: number;
  /** Why an approver sent it back (cleared when it's sent again). */
  reviewNote?: string; reviewedBy?: string; reviewedByName?: string; reviewedAt?: number;
  approvedBy?: string; approvedByName?: string; publishedAt?: number;
  change?: ChangeKind;
  /** London date the published version should be reviewed by. */
  reviewBy?: string;
  supersededAt?: number;
}

export interface LibraryDoc {
  id: string; kind: LibraryKind; code: string; createdAt: number;
  retiredAt?: number; retiredBy?: string; retiredNote?: string;
  /** The version staff see. */
  published?: LibraryVersion;
  /** The draft or the version waiting for approval, if any (one at a time). */
  open?: LibraryVersion;
}

export const SOP_LIMITS = { title: 100, purpose: 600, step: 800, warning: 300, steps: 40 } as const;
export const REVIEW_MONTHS = 12;
export const REVIEW_SOON_DAYS = 30;
export const PHOTO_MAX_BYTES = 2_000_000;
/** Photos are made at most 1600 px on the long side on the device; anything over this is refused. */
export const PHOTO_MAX_SIDE = 4096;
/** Uploads per person in 24 hours. */
export const PHOTO_DAILY_LIMIT = 100;
/** A photo no version uses (removed, replaced, or from an abandoned draft) is cleared away after this many days. */
export const PHOTO_KEEP_UNUSED_DAYS = 7;

export const STATUS_TEXT: Record<VersionStatus, string> = {
  draft: "Draft", in_review: "Waiting for approval", published: "Published", superseded: "Replaced", discarded: "Discarded",
};
export const CHANGE_TEXT: Record<ChangeKind, string> = { new: "New", minor: "Updated", major: "Major change" };
export const SECTION_TEXT: Record<Area, string> = { FOH: "Front of house", BOH: "Back of house", PROD: "Production" };

export type Checked = { ok: true } | { ok: false; error: string };
const yes: Checked = { ok: true };
const no = (error: string): Checked => ({ ok: false, error });

/** Who writes drafts: managers, operations managers and owners. */
export const canDraft = (p: Pick<Person, "status" | "access">) => p.status === "active" && managedSites(p).length > 0;
/** Who approves, publishes and retires: owners and operations managers. */
export const canApprove = (p: Pick<Person, "status" | "access">) => p.status === "active" && isLead(p);

type Actor = Pick<Person, "id" | "status" | "access">;
type Sited = Pick<Site, "id" | "kind" | "status">;

/** The open sites a version reaches: those with one of its sections (all open sites when it's for everyone). */
export function reachedSites(sections: Area[], sites: Sited[]): SiteId[] {
  return sites.filter((s) => s.status === "open" && (!sections.length || sectionsFor(s.kind).some((x) => sections.includes(x)))).map((s) => s.id);
}

/** Wrote, changed or sent this version. */
export const isContributor = (p: Pick<Person, "id">, v: Pick<LibraryVersion, "authorId" | "submittedBy" | "contributors">) =>
  p.id === v.authorId || p.id === v.submittedBy || v.contributors.includes(p.id);

export function canEditDraft(p: Actor, v: Pick<LibraryVersion, "status">): Checked {
  if (!canDraft(p)) return no("Only managers can write SOPs");
  if (v.status === "in_review") return no("It's waiting for approval. Take it back to change it");
  if (v.status !== "draft") return no("Only a draft can be changed");
  return yes;
}

/** Taking a version back from approval: whoever wrote or sent it (if they still write SOPs), or an approver. */
export function canWithdraw(p: Actor, v: Pick<LibraryVersion, "status" | "authorId" | "submittedBy">): Checked {
  if (!canDraft(p)) return no("Only managers can change SOPs");
  if (v.status !== "in_review") return no("It isn't waiting for approval");
  if (p.id !== v.authorId && p.id !== v.submittedBy && !canApprove(p)) return no("Only whoever sent it, or an approver, can take it back");
  return yes;
}

/**
 * Approving (and publishing) or sending back: an owner, or an operations manager who didn't write, change or send
 * this version and runs every site it reaches (`reach`: reachedSites). Owners may approve their own, so they're never stuck.
 */
export function canReview(p: Actor, v: Pick<LibraryVersion, "status" | "authorId" | "submittedBy" | "contributors">, reach: SiteId[]): Checked {
  if (!canApprove(p)) return no("Only the owner or an operations manager can approve");
  if (v.status !== "in_review") return no("It isn't waiting for approval");
  if (isOwner(p)) return yes;
  if (isContributor(p, v)) return no("You wrote or changed this version, so another approver checks it");
  if (isOps(p) && reach.some((s) => !opsSites(p).includes(s))) return no("It reaches a site you don't run, so the owner approves it");
  return yes;
}

/** Throwing away a draft (it's kept, marked discarded): whoever started it (if they still write SOPs), or an approver. */
export function canDiscard(p: Actor, v: Pick<LibraryVersion, "status" | "authorId">): Checked {
  if (!canDraft(p)) return no("Only managers can change SOPs");
  if (v.status !== "draft") return no("Only a draft can be discarded");
  if (p.id !== v.authorId && !canApprove(p)) return no("Only whoever started it, or an approver, can discard it");
  return yes;
}

/** Retiring takes a published SOP out of use (a draft that was never published is discarded instead). */
export function canRetire(p: Actor, doc: Pick<LibraryDoc, "retiredAt" | "published">): Checked {
  if (!canApprove(p)) return no("Only the owner or an operations manager can retire an SOP");
  if (doc.retiredAt) return no("It's already retired");
  if (!doc.published) return no("It was never published: discard the draft instead");
  return yes;
}

export function canReinstate(p: Actor, doc: Pick<LibraryDoc, "retiredAt" | "published">): Checked {
  if (!canApprove(p)) return no("Only the owner or an operations manager can bring an SOP back");
  if (!doc.retiredAt) return no("It isn't retired");
  if (!doc.published) return no("It was never published");
  return yes;
}

/** SOP-BOH-…, SOP-FOH-…, SOP-PROD-…; for several sections or everyone, SOP-GEN-…. The code never changes. */
export const sopPrefix = (sections: Area[]) => `SOP-${sections.length === 1 ? sections[0] : "GEN"}-`;

/** The next free code with this prefix: SOP-BOH-003 after SOP-BOH-002. */
export function nextCode(prefix: string, codes: string[]): string {
  const used = codes.filter((c) => c.startsWith(prefix)).map((c) => Number(c.slice(prefix.length))).filter((n) => Number.isInteger(n) && n > 0);
  return prefix + String((used.length ? Math.max(...used) : 0) + 1).padStart(3, "0");
}

export interface SopInput { title: string; sections: string[]; purpose: string; steps: { text: string; warning?: string; photo?: Photo }[] }
type Cleaned<T> = { ok: true; value: T } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECTIONS: Area[] = ["FOH", "BOH", "PROD"];
const text = (s: string | undefined) => (s ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
const isPhoto = (p: Photo | undefined): p is Photo => !!p && UUID.test(p.id) && [p.w, p.h].every((n) => Number.isInteger(n) && n > 0 && n <= 10_000);

/**
 * Cleans a draft and checks the limits. A draft may be unfinished (`readyForReview` says when it isn't); steps with
 * nothing in them are dropped.
 */
export function cleanSop(input: SopInput): Cleaned<{ title: string; body: SopBody }> {
  const title = input.title.replace(/\s+/g, " ").trim();
  if (!title) return { ok: false, error: "Give it a title" };
  if (title.length > SOP_LIMITS.title) return { ok: false, error: `Keep the title under ${SOP_LIMITS.title} characters` };
  const sections = SECTIONS.filter((s) => input.sections.includes(s));
  if (input.sections.some((s) => !SECTIONS.includes(s as Area))) return { ok: false, error: "Unknown section" };
  const purpose = text(input.purpose);
  if (purpose.length > SOP_LIMITS.purpose) return { ok: false, error: `Keep the purpose under ${SOP_LIMITS.purpose} characters` };
  const steps: SopStep[] = [];
  for (const [i, s] of input.steps.entries()) {
    const t = text(s.text), w = text(s.warning);
    if (s.photo && !isPhoto(s.photo)) return { ok: false, error: "That photo didn't upload properly. Add it again" };
    if (!t && !w && !s.photo) continue;
    const n = i + 1; // as numbered in the editor
    if (t.length > SOP_LIMITS.step) return { ok: false, error: `Step ${n} is too long: keep it under ${SOP_LIMITS.step} characters, or split it` };
    if (w.length > SOP_LIMITS.warning) return { ok: false, error: `The warning in step ${n} is too long: keep it under ${SOP_LIMITS.warning} characters` };
    steps.push({ text: t, ...(w ? { warning: w } : {}), ...(s.photo ? { photo: { id: s.photo.id, w: s.photo.w, h: s.photo.h } } : {}) });
  }
  if (steps.length > SOP_LIMITS.steps) return { ok: false, error: `At most ${SOP_LIMITS.steps} steps: split it into two SOPs` };
  return { ok: true, value: { title, body: { sections, purpose, steps } } };
}

/** Ready to send for approval: a purpose, at least one step, and words in every step. */
export function readyForReview(body: SopBody): Checked {
  if (!body.purpose) return no("Say what it's for and when it's used (purpose)");
  if (!body.steps.length) return no("Add at least one step");
  const i = body.steps.findIndex((s) => !s.text);
  if (i >= 0) return no(`Step ${i + 1} needs words, not just a photo or warning`);
  return yes;
}

/** Photo ids used in a body, to check they were uploaded. */
export const photoIds = (body: SopBody) => body.steps.flatMap((s) => (s.photo ? [s.photo.id] : []));

/** The body without these photos (ones the owner erased): each step keeps its words, and a step left empty goes. */
export function dropPhotos(body: SopBody, gone: Set<string>): SopBody {
  const steps = body.steps.flatMap((s): SopStep[] => {
    if (!s.photo || !gone.has(s.photo.id)) return [s];
    return s.text || s.warning ? [{ text: s.text, ...(s.warning ? { warning: s.warning } : {}) }] : [];
  });
  return { ...body, steps };
}

export const defaultReviewBy = (today: string) => addMonths(today, REVIEW_MONTHS);

/** The review date an approver picks: after today, within 3 years. */
export function validReviewBy(date: string, today: string): Checked {
  if (!isIsoDate(date)) return no("Choose a review date");
  if (date <= today) return no("The review date must be in the future");
  if (date > addMonths(today, 36)) return no("Review it at least every 3 years");
  return yes;
}

/** A first version is "new"; after that the approver says whether it's a minor update or a major change. */
export function changeFor(hasPublished: boolean, picked: string | undefined): Cleaned<ChangeKind> {
  if (!hasPublished) return { ok: true, value: "new" };
  if (picked === "minor" || picked === "major") return { ok: true, value: picked };
  return { ok: false, error: "Say whether it's a minor update or a major change" };
}

export function reviewState(reviewBy: string | undefined, today: string): "overdue" | "soon" | undefined {
  if (!reviewBy) return undefined;
  if (reviewBy < today) return "overdue";
  if (reviewBy <= addDays(today, REVIEW_SOON_DAYS)) return "soon";
  return undefined;
}

/**
 * Whether someone reads a version at this site: staff by their sections there; managers and operations managers by
 * the sections the site has. Owners aren't asked. Only open sites count.
 */
export function readsAt(sections: Area[], p: Pick<Person, "status" | "access">, site: Pick<Site, "id" | "kind" | "status">): boolean {
  if (p.status !== "active" || isOwner(p) || site.status !== "open") return false;
  const a = p.access.find((x) => x.siteId === site.id);
  if (!a) return false;
  if (!sections.length) return true;
  const theirs = a.role === "staff" ? a.sections : sectionsFor(site.kind);
  return theirs.some((s) => sections.includes(s));
}

export const readsAny = (sections: Area[], p: Pick<Person, "status" | "access">, sites: Pick<Site, "id" | "kind" | "status">[]) =>
  sites.some((s) => readsAt(sections, p, s));

/** Published, live SOPs this person still has to read (newest first). */
export function mustRead<D extends Pick<LibraryDoc, "retiredAt"> & { published?: Pick<LibraryVersion, "id" | "body" | "publishedAt"> }>(
  p: Pick<Person, "status" | "access">, docs: D[], acked: Set<string>, sites: Pick<Site, "id" | "kind" | "status">[]): D[] {
  return docs.filter((d) => !d.retiredAt && d.published && !acked.has(d.published.id) && readsAny(d.published.body.sections, p, sites))
    .sort((a, b) => (b.published!.publishedAt ?? 0) - (a.published!.publishedAt ?? 0));
}

export interface SiteReads { siteId: SiteId; siteName: string; read: { id: string; name: string; at: number }[]; unread: { id: string; name: string }[] }

/** Who has read a version, site by site (each person at each of the given sites where they read it). */
export function readStats(sections: Area[], versionId: string, people: Pick<Person, "id" | "name" | "status" | "access">[],
  acks: { versionId: string; personId: string; at: number }[], sites: Pick<Site, "id" | "name" | "kind" | "status">[]): SiteReads[] {
  const at = new Map(acks.filter((a) => a.versionId === versionId).map((a) => [a.personId, a.at]));
  return sites.filter((s) => s.status === "open").map((site) => {
    const here = people.filter((p) => readsAt(sections, p, site));
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    return {
      siteId: site.id, siteName: site.name,
      read: here.filter((p) => at.has(p.id)).map((p) => ({ id: p.id, name: p.name, at: at.get(p.id)! })).sort(byName),
      unread: here.filter((p) => !at.has(p.id)).map((p) => ({ id: p.id, name: p.name })).sort(byName),
    };
  });
}

/** What's waiting for this person in the library: versions they can approve, and their own drafts sent back. */
export function libraryToDo(p: Actor, docs: Pick<LibraryDoc, "open" | "retiredAt">[], sites: Sited[]): number {
  return docs.filter((d) => {
    const v = d.open;
    if (!v || d.retiredAt) return false;
    if (v.status === "in_review") return canReview(p, v, reachedSites(v.body.sections, sites)).ok;
    return v.status === "draft" && !!v.reviewNote && v.authorId === p.id;
  }).length;
}

/** How a version stands, in words, for the lists. */
export function versionLabel(v: Pick<LibraryVersion, "status" | "reviewNote">): string {
  return v.status === "draft" && v.reviewNote ? "Sent back" : STATUS_TEXT[v.status];
}

export type ImageMime = "image/jpeg" | "image/png" | "image/webp";

/** What a photo's first bytes say it is (JPEG, PNG or WebP), whatever the upload claimed. Undefined for anything else. */
export function imageKind(b: Uint8Array): ImageMime | undefined {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...Array.from(b.subarray(from, to)));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return undefined;
}

/** Width and height from a JPEG's frame header (the real size, whatever the upload claimed). Undefined if it can't be read. */
export function jpegSize(b: Uint8Array): { w: number; h: number } | undefined {
  if (imageKind(b) !== "image/jpeg") return undefined;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return undefined;
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; } // fill byte
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; } // no length
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) return undefined;
    const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (sof) {
      if (i + 8 >= b.length) return undefined;
      const h = (b[i + 5] << 8) | b[i + 6], w = (b[i + 7] << 8) | b[i + 8];
      return w > 0 && h > 0 ? { w, h } : undefined;
    }
    if (marker === 0xd9 || marker === 0xda) return undefined; // end, or image data before any frame header
    i += 2 + len;
  }
  return undefined;
}
