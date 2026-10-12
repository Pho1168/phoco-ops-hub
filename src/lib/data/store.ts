import type { Answer, Checklist, Person, Site, SiteId, TempRule } from "@/lib/domain/types";
import type { Device } from "@/lib/domain/devices";
import type { Notice, StoredShift, SyncPlan, TeamShift, WeekStatus } from "@/lib/domain/rota";
import type { PrepEntry, PrepItem, PrepShift, SubmitPlan } from "@/lib/domain/prep";
import type { ListInfo, RawAnswer, RunInfo } from "@/lib/domain/records";
import type { TeamNotice } from "@/lib/domain/notices";
import type { TimeOff, TimeOffKind, TimeOffStatus } from "@/lib/domain/timeoff";
import type { Certificate } from "@/lib/domain/certificates";
import type { Equipment, EquipmentEvent, EquipmentInput } from "@/lib/domain/equipment";
import type { Task, TaskInput, TaskStatus } from "@/lib/domain/tasks";
import type { ShiftReply } from "@/lib/domain/reminders";
import type { GasCheck } from "@/lib/domain/daily";
import type { CoverRequest } from "@/lib/domain/cover";
import type { BodyOf, ChangeKind, LibraryBody, LibraryDoc, LibraryKind, LibraryVersion } from "@/lib/domain/library";

export interface Session { id: string; personId: string; siteId: SiteId; deviceId?: string; scope: SessionScope; startedAt: number; expiresAt: number; revokedAt?: number; revokedReason?: string }
/** "full" = normal app; "shifts" = a staff member's own phone, limited to My shifts. */
export type SessionScope = "full" | "shifts";
export interface ShiftView { id: string; siteId: SiteId; siteName: string; section: string; week: string; date: string; start: string; end: string; published: boolean; cancelled: boolean }
/** Kinds of message sent to a person (shown under My shifts, and pushed to phones with notifications on). */
export type MessageKind = Notice["kind"] | "notice" | "leave" | "cert" | "report" | "fault" | "service" | "task" | "shift" | "reply" | "gas" | "ready" | "daily" | "cover";
export interface NoticeRow { id: string; personId: string; kind: MessageKind; title: string; body: string; sendAfter: number; sentAt?: number; createdAt: number; url?: string }
export interface PushSub { personId: string; endpoint: string; p256dh: string; auth: string }
export interface RotaResult { at: number; rows: number; shifts: number; added: number; changed: number; cancelled: number; notices: number; published: string[]; issues: string[] }
export interface RotaSource { siteId: SiteId; createdAt: number; lastImportAt?: number; lastResult?: RotaResult }
export interface Run { listId: string; date: string; answers: Answer[]; signedBy?: string; signedAt?: number }
export interface Alert { id: string; siteId: SiteId; level: "warning" | "critical"; title: string; detail: string; dedupeKey: string; createdAt: number; resolvedAt?: number; resolvedBy?: string; resolutionNote?: string }
/** createdBy/closedBy are person ids; createdByName is filled in by the store for display. */
export interface HandoverItem { id: string; siteId: SiteId; category: string; body: string; needsAction: boolean; createdBy: string; createdByName: string; createdAt: number; closedAt?: number; closedBy?: string; closedByName?: string }
/** A prep entry with display names filled in by the store. */
export interface PrepEntryView extends PrepEntry { createdByName: string; completedByName?: string }
export interface PrepHandover {
  id: string; siteId: SiteId; shift: PrepShift; status: "draft" | "submitted";
  createdBy: string; createdByName: string; createdAt: number; updatedAt: number;
  submittedBy?: string; submittedByName?: string; submittedAt?: number; stockedCount?: number;
  entries: PrepEntryView[];
}
/** Raw food-safety records for one site and date range (London dates, inclusive). */
export interface RecordsData {
  lists: ListInfo[]; runs: RunInfo[];
  /** Every answer in the range's checklist runs, oldest first. */
  answers: RawAnswer[];
  /** Alerts raised in the range. */
  alerts: (Alert & { resolvedByName?: string })[];
  /** The first day the site recorded any checklist: days before it aren't counted as missed. */
  trackingFrom?: string;
}
export interface AuditEntry { at: number; actorId?: string; siteId?: SiteId; action: string; detail: string }
/** "I've read it" for one version of a library document. */
export interface LibraryAck { versionId: string; docId: string; personId: string; at: number }
/** submit: draft → waiting for approval; withdraw: taken back to draft; send_back: an approver returns it with a note; discard: draft → discarded. */
export type LibraryMove = "submit" | "withdraw" | "send_back" | "discard";

/**
 * Everything the app reads and writes goes through this interface.
 * DemoStore keeps data in server memory for development; SqlStore implements the same methods
 * against the Postgres schema in supabase/migrations (Supabase in production).
 */
export interface Store {
  sites(): Promise<Site[]>;
  site(id: SiteId): Promise<Site | undefined>;
  setSiteStatus(id: SiteId, status: Site["status"], reason?: string): Promise<void>;

  people(): Promise<Person[]>;
  person(id: string): Promise<Person | undefined>;
  updatePerson(id: string, patch: Partial<Person>): Promise<void>;
  /** Creates a person with their site access; returns the new id. */
  createPerson(p: { staffCode: string; name: string; pinHash: string; pinMustChange: boolean; access: Person["access"] }): Promise<string>;
  /** Replaces a person's site access. */
  setAccess(personId: string, access: Person["access"]): Promise<void>;

  createSession(personId: string, siteId: SiteId, ttlMs: number, deviceId?: string, scope?: SessionScope): Promise<Session>;
  session(id: string): Promise<Session | undefined>;
  revokeSessions(match: { personId?: string; siteId?: SiteId; deviceId?: string; exceptPersonIds?: string[]; exceptSessionId?: string }, reason: string): Promise<number>;

  devices(): Promise<Device[]>;
  /** The active-or-locked device holding this token hash; also records when it was last seen. */
  deviceByToken(tokenHash: string): Promise<Device | undefined>;
  device(id: string): Promise<Device | undefined>;
  setDeviceStatus(id: string, status: Device["status"]): Promise<void>;
  createPairing(p: { codeHash: string; siteId: SiteId; label: string; createdBy: string; expiresAt: number }): Promise<void>;
  /** Uses a pairing code once: registers the device and returns it, or undefined if the code is unknown, used or expired. */
  redeemPairing(codeHash: string, tokenHash: string, now: number): Promise<Device | undefined>;

  rules(): Promise<Record<string, TempRule>>;
  checklists(siteId: SiteId): Promise<Checklist[]>;
  checklist(id: string): Promise<Checklist | undefined>;
  run(listId: string, date: string): Promise<Run>;
  addAnswer(listId: string, date: string, answer: Answer): Promise<void>;
  signRun(listId: string, date: string, personId: string): Promise<void>;

  alerts(siteId?: SiteId): Promise<Alert[]>;
  raiseAlert(a: Omit<Alert, "id" | "createdAt">): Promise<void>;
  resolveAlert(id: string, personId: string, note: string): Promise<void>;

  /** The first day the site recorded any checklist (London date), or undefined if it hasn't yet. */
  checklistsStartedOn(siteId: SiteId): Promise<string | undefined>;
  /** Checklist runs, answers and alerts for inspection records and reports. */
  recordsData(siteId: SiteId, from: string, to: string): Promise<RecordsData>;

  handover(siteId: SiteId, createdSince?: number): Promise<HandoverItem[]>;
  addHandover(h: Omit<HandoverItem, "id" | "createdAt" | "createdByName">): Promise<void>;
  /** Ticks a note done. Returns false if it isn't at that site or is already done. */
  closeHandover(id: string, siteId: SiteId, personId: string): Promise<boolean>;
  /** Puts a done note back (for a mis-tap). Returns false if it isn't at that site or isn't done. */
  reopenHandover(id: string, siteId: SiteId): Promise<boolean>;

  // Kitchen prep (one master list for every restaurant; handovers per site)
  prepItems(): Promise<PrepItem[]>;
  prepEnabledSites(): Promise<SiteId[]>;
  /** The site's draft, if someone has started one. */
  prepDraft(siteId: SiteId): Promise<PrepHandover | undefined>;
  /** Starts the site's draft if there isn't one, then sets the shift and/or marks an item needed or not. */
  prepEditDraft(siteId: SiteId, personId: string, change: { shift?: PrepShift; itemId?: string; needed?: boolean; urgent?: boolean; note?: string | null }): Promise<void>;
  /** Outstanding entries in the site's submitted handovers. */
  prepOutstanding(siteId: SiteId): Promise<PrepEntryView[]>;
  /**
   * Submits the site's draft in one transaction: `plan` (from planSubmit) is worked out inside it from the
   * draft and the outstanding entries, so two people submitting at once can't carry an item twice.
   */
  prepSubmit(siteId: SiteId, personId: string, plan: (draft: PrepEntry[], outstanding: PrepEntry[], activeItemIds: string[]) => SubmitPlan):
    Promise<{ handoverId: string; plan: SubmitPlan } | undefined>;
  prepHandover(id: string): Promise<PrepHandover | undefined>;
  /** Submitted handovers for the site, newest first. */
  prepHandovers(siteId: SiteId, limit: number): Promise<PrepHandover[]>;
  /** Marks an outstanding entry done (or back to outstanding). Returns false if it isn't at that site or not in that state. */
  prepSetDone(entryId: string, siteId: SiteId, personId: string, done: boolean): Promise<boolean>;

  // Team notices
  /** Live notices plus the most recent finished ones (taken down or past their last day), newest first, with who has read them. */
  teamNotices(recentEnded?: number): Promise<TeamNotice[]>;
  addTeamNotice(n: Omit<TeamNotice, "id" | "createdAt" | "createdByName" | "reads" | "endedAt">): Promise<string>;
  endTeamNotice(id: string, personId: string): Promise<boolean>;
  /** Records "Got it". Returns false if the notice doesn't exist. */
  readTeamNotice(id: string, personId: string): Promise<boolean>;

  // Time off
  /** Requests matching the filter (dates: any overlap with from..to), newest first. */
  timeOff(filter: { personId?: string; siteIds?: SiteId[]; from?: string; to?: string; statuses?: TimeOffStatus[] }): Promise<TimeOff[]>;
  requestTimeOff(t: { personId: string; siteId: SiteId; startsOn: string; endsOn: string; kind: TimeOffKind; note?: string }): Promise<string>;
  /** Approve or decline a pending request. False if it isn't pending any more. */
  decideTimeOff(id: string, decision: "approved" | "declined", personId: string, note?: string): Promise<boolean>;
  /** Withdraw a request that is still in the given status (pending or approved). False if it has changed. */
  cancelTimeOff(id: string, from: "pending" | "approved"): Promise<boolean>;

  // Staff certificates (removed records are kept in the database but never returned)
  /** Current records, oldest first; for some people or everyone. */
  certificates(filter?: { personIds?: string[] }): Promise<Certificate[]>;
  certificate(id: string): Promise<Certificate | undefined>;
  addCertificate(c: Omit<Certificate, "id" | "createdAt" | "createdByName">): Promise<string>;
  /** Marks a record removed (added by mistake). False if it isn't there or is already removed. */
  removeCertificate(id: string, personId: string): Promise<boolean>;

  // Equipment (retired, never deleted) and its append-only history
  /** The site's equipment by name; retired kit only when asked. */
  equipment(siteId: SiteId, includeRetired?: boolean): Promise<Equipment[]>;
  equipmentItem(id: string): Promise<Equipment | undefined>;
  addEquipment(e: EquipmentInput & { siteId: SiteId; createdBy: string }): Promise<string>;
  updateEquipment(id: string, e: EquipmentInput): Promise<boolean>;
  retireEquipment(id: string, personId: string): Promise<boolean>;
  /** History, oldest first: for one item or a site, optionally since a time, or only faults still open (with their updates). */
  equipmentEvents(filter: { equipmentId?: string; siteId?: SiteId; since?: number; openFaultsOnly?: boolean }): Promise<EquipmentEvent[]>;
  /** Adds to the history. Returns undefined if the fault has already been fixed (a fault is fixed once). */
  addEquipmentEvent(e: Omit<EquipmentEvent, "id" | "createdAt" | "createdByName">): Promise<string | undefined>;

  // Tasks (done or cancelled, never deleted)
  /** Tasks at these sites: open ones, plus done or cancelled since a time when asked. Newest first. */
  tasks(filter: { siteIds: SiteId[]; statuses?: TaskStatus[]; closedSince?: number }): Promise<Task[]>;
  task(id: string): Promise<Task | undefined>;
  addTask(t: TaskInput & { siteId: SiteId; createdBy: string }): Promise<string>;
  /** Open → done. False if it isn't open. */
  completeTask(id: string, personId: string, note?: string): Promise<boolean>;
  /** Done → open again (a mis-tap), only by the person who ticked it. False otherwise. */
  reopenTask(id: string, personId: string): Promise<boolean>;
  /** Open → cancelled. False if it isn't open. */
  cancelTask(id: string, personId: string): Promise<boolean>;

  // Gas off at close (one per site per day; never changed)
  /** Gas checks at these sites between two London dates (inclusive). */
  gasChecks(siteIds: SiteId[], from: string, to: string): Promise<GasCheck[]>;
  /** Records the day's gas check. False if someone has already done it (the first tap counts). */
  addGasCheck(c: { siteId: SiteId; date: string; personId: string; onTablet: boolean }): Promise<boolean>;

  // Library: SOPs, prep recipes and dish specs. A published version never changes; documents are retired; versions and
  // confirmations are never deleted. Every change to a version takes the revision (`rev`) the person was shown, and
  // fails if it has moved on since.
  /**
   * Every document of a kind (by code), each with its published version and its open one (draft or waiting for approval).
   * `light`: versions carry only `body.sections` and `body.category` (no steps, ingredients or allergens), for counts and lists.
   */
  libraryDocs<K extends LibraryKind>(kind: K, opts?: { light?: boolean }): Promise<LibraryDoc<BodyOf<K>>[]>;
  libraryDoc(id: string): Promise<LibraryDoc | undefined>;
  /** Every version of a document, newest first. */
  libraryVersions(docId: string): Promise<LibraryVersion[]>;
  libraryVersion(id: string): Promise<LibraryVersion | undefined>;
  /** A new document and its first draft. The code is the next free one starting with `prefix` (nextCode). */
  createLibraryDoc(d: { kind: LibraryKind; prefix: string; title: string; body: LibraryBody; authorId: string }): Promise<{ docId: string; versionId: string; code: string }>;
  /** A new draft copied from the published version. Undefined if a draft is already open, nothing is published, or it's retired. */
  startLibraryDraft(docId: string, authorId: string): Promise<string | undefined>;
  /** Saves a draft's title and body; the person joins its contributors. The new revision, or undefined if it isn't that draft any more. */
  saveLibraryDraft(versionId: string, rev: number, d: { title: string; body: LibraryBody }, personId: string): Promise<number | undefined>;
  /**
   * Moves a version along (see LibraryMove); sending it adds the person to its contributors. Discarding the only draft
   * of a document that was never published also retires the document. False if it changed meanwhile.
   */
  moveLibraryVersion(versionId: string, move: LibraryMove, personId: string, rev: number, note?: string): Promise<boolean>;
  /**
   * Waiting for approval → published, replacing the published version (kept as superseded); the approver counts as
   * having read it. Refused if it changed meanwhile, the document is retired, or the approver is one of its
   * contributors (unless `ownerApproving`). Dishes: `allergens` "changed" marks the change now (everyone at its sites
   * confirms it); "same" keeps the version it replaces' last change. Returns the new version number.
   */
  publishLibraryVersion(versionId: string, rev: number, p: { approverId: string; change: ChangeKind; reviewBy: string; ownerApproving: boolean; allergens?: "changed" | "same" }): Promise<number | undefined>;
  /** Retires a document; a draft or version waiting for approval is discarded with it. */
  retireLibraryDoc(docId: string, personId: string, note: string): Promise<boolean>;
  reinstateLibraryDoc(docId: string): Promise<boolean>;
  libraryAcks(filter: { versionIds?: string[]; personId?: string; docId?: string }): Promise<LibraryAck[]>;
  /** Records "I've read it" for a published version. False if already recorded (or it isn't published). */
  ackLibraryVersion(versionId: string, personId: string): Promise<boolean>;

  // Photos (JPEG). In use: never changed, but the owner can erase one (privacy). Unused for a week: cleared away.
  /** Stores a photo, unless the person has already added `cap.max` since `cap.since` (checked and added as one step): undefined then. */
  addMedia(m: { bytes: Uint8Array; width: number; height: number; createdBy: string }, cap: { max: number; since: number }): Promise<string | undefined>;
  media(id: string): Promise<{ mime: string; bytes: Uint8Array; erased: boolean } | undefined>;
  /** Without the bytes, for answering "not changed" quickly. */
  mediaInfo(id: string): Promise<{ mime: string; erased: boolean } | undefined>;
  /** Which of these photos exist, and whether each has been erased (ids not found are left out). */
  mediaStatus(ids: string[]): Promise<Map<string, { erased: boolean }>>;
  /** How many photos a person has uploaded since a time. */
  mediaCountSince(personId: string, since: number): Promise<number>;
  /** Empties a photo for good (it shows as removed). False if it's already erased or isn't there. */
  eraseMedia(id: string, personId: string): Promise<boolean>;
  /** Deletes photos older than `before` that no library version uses (discarded drafts don't count). Returns how many. */
  deleteUnusedMedia(before: number): Promise<number>;

  // Shift cover (requests are withdrawn or decided, offers withdrawn; nothing is deleted)
  /**
   * Requests matching the filter, newest first, with the shift as it is now and every offer. `live`: open or approved.
   * `shiftEndsAfter`: only shifts ending after then (so old ones drop out without anything being deleted).
   */
  coverRequests(filter: { siteIds?: SiteId[]; personId?: string; shiftEndsAfter?: number; live?: boolean }): Promise<CoverRequest[]>;
  coverRequest(id: string): Promise<CoverRequest | undefined>;
  /** Undefined if a request for that shift is already in play. */
  addCoverRequest(r: { shiftId: string; siteId: SiteId; personId: string; section: string; note?: string }): Promise<string | undefined>;
  /**
   * Open → approved (with who covers; they must still have an offer in), declined, or withdrawn by the person asking;
   * approved → cancelled by a manager. False if it isn't in that state any more (or the offer has gone).
   */
  decideCover(id: string, d: { status: "approved" | "declined" | "withdrawn" | "cancelled"; personId: string; coveredBy?: string; note?: string }): Promise<boolean>;
  /** Undefined if they already have an offer in, or the request isn't open. */
  addCoverOffer(requestId: string, personId: string): Promise<string | undefined>;
  /** Takes back an offer while the request is open; returns the offer's id. */
  withdrawCoverOffer(requestId: string, personId: string): Promise<string | undefined>;

  // Rota (read from the site Google Sheets; never written back)
  rotaSources(): Promise<RotaSource[]>;
  rotaSourceByToken(tokenHash: string): Promise<SiteId | undefined>;
  setRotaToken(siteId: SiteId, tokenHash: string, createdBy: string): Promise<void>;
  recordRotaImport(siteId: SiteId, result: RotaResult): Promise<void>;
  weekStatuses(siteId: SiteId): Promise<Map<string, WeekStatus>>;
  setWeekStatuses(siteId: SiteId, statuses: Map<string, WeekStatus>): Promise<void>;
  /** Every stored shift for the site, cancelled ones included, keyed the way the import builds them. */
  siteShifts(siteId: SiteId): Promise<StoredShift[]>;
  applyShiftSync(siteId: SiteId, plan: SyncPlan, personIdByCode: Map<string, string>): Promise<void>;
  shiftsForPerson(personId: string, fromDate: string, toDate: string): Promise<ShiftView[]>;
  /** The site's shifts in one week (Monday, YYYY-MM-DD), not cancelled, with names. Published or not: the caller decides. */
  teamShifts(siteId: SiteId, week: string): Promise<TeamShift[]>;
  /** Published, not-cancelled shifts on a London date, with the person's staff ID. */
  shiftsOnDate(date: string): Promise<(ShiftView & { personId: string; staffCode: string })[]>;
  /** One shift by id, published or not, cancelled or not. */
  shift(id: string): Promise<(ShiftView & { personId: string; staffCode: string }) | undefined>;

  // Replies to shift reminders (kept: a new reply is added, the latest one counts)
  /** Replies about these shifts, oldest first. */
  shiftReplies(shiftIds: string[]): Promise<ShiftReply[]>;
  /**
   * Adds a reply unless `isRepeat` says it repeats the latest one (a second tap, or a retry). Done under a lock on
   * the shift, so two at once can't both be added. Returns the reply that stands now and the one before it.
   */
  addShiftReply(r: Omit<ShiftReply, "id" | "createdAt">, isRepeat: (latest: ShiftReply) => boolean): Promise<{ reply: ShiftReply; previous?: ShiftReply; added: boolean }>;

  // Messages and push
  /** `url`: the app page the phone notification opens (default My shifts). */
  queueNotice(n: { personId: string; kind: MessageKind; title: string; body: string; dedupeKey?: string; sendAfter: number; url?: string }): Promise<boolean>;
  /**
   * Takes messages due to go to phones and marks them sent in the same step, so two senders (the scheduler and
   * someone's action) never push the same one. Optionally only for some people.
   */
  dueNotices(now: number, limit: number, personIds?: string[]): Promise<NoticeRow[]>;
  /** A person's messages, newest first. They show in the app at once; quiet hours only hold back the phone alert. */
  notices(personId: string, limit: number): Promise<NoticeRow[]>;
  /** Of these message keys, the ones already queued, with when they were queued. */
  noticeKeys(keys: string[]): Promise<Map<string, number>>;
  savePushSub(sub: PushSub): Promise<void>;
  pushSubs(personId: string): Promise<PushSub[]>;
  /** Everyone with at least one phone set up for notifications. */
  peopleWithPush(): Promise<Set<string>>;
  dropPushSub(endpoint: string): Promise<void>;
  /** Returns the stored value, creating it with `make()` the first time. */
  secret(key: string, make: () => string): Promise<string>;

  audit(entry: Omit<AuditEntry, "at">): Promise<void>;
  auditLog(limit: number): Promise<AuditEntry[]>;
}
