import type { Answer, Checklist, Person, Site, SiteId, TempRule } from "@/lib/domain/types";
import type { Device } from "@/lib/domain/devices";
import type { Notice, StoredShift, SyncPlan, WeekStatus } from "@/lib/domain/rota";

export interface Session { id: string; personId: string; siteId: SiteId; deviceId?: string; scope: SessionScope; startedAt: number; expiresAt: number; revokedAt?: number; revokedReason?: string }
/** "full" = normal app; "shifts" = a staff member's own phone, limited to My shifts. */
export type SessionScope = "full" | "shifts";
export interface ShiftView { id: string; siteId: SiteId; siteName: string; section: string; week: string; date: string; start: string; end: string; published: boolean; cancelled: boolean }
export interface NoticeRow { id: string; personId: string; kind: Notice["kind"]; title: string; body: string; sendAfter: number; sentAt?: number; createdAt: number }
export interface PushSub { personId: string; endpoint: string; p256dh: string; auth: string }
export interface RotaResult { at: number; rows: number; shifts: number; added: number; changed: number; cancelled: number; notices: number; published: string[]; issues: string[] }
export interface RotaSource { siteId: SiteId; createdAt: number; lastImportAt?: number; lastResult?: RotaResult }
export interface Run { listId: string; date: string; answers: Answer[]; signedBy?: string; signedAt?: number }
export interface Alert { id: string; siteId: SiteId; level: "warning" | "critical"; title: string; detail: string; dedupeKey: string; createdAt: number; resolvedAt?: number; resolvedBy?: string; resolutionNote?: string }
/** createdBy/closedBy are person ids; createdByName is filled in by the store for display. */
export interface HandoverItem { id: string; siteId: SiteId; category: string; body: string; needsAction: boolean; createdBy: string; createdByName: string; createdAt: number; closedAt?: number; closedBy?: string }
export interface AuditEntry { at: number; actorId?: string; siteId?: SiteId; action: string; detail: string }

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

  handover(siteId: SiteId): Promise<HandoverItem[]>;
  addHandover(h: Omit<HandoverItem, "id" | "createdAt" | "createdByName">): Promise<void>;
  closeHandover(id: string, personId: string): Promise<void>;

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
  /** Published, not-cancelled shifts on a London date, with the person's staff ID. */
  shiftsOnDate(date: string): Promise<(ShiftView & { personId: string; staffCode: string })[]>;

  // Messages and push
  queueNotice(n: { personId: string; kind: Notice["kind"]; title: string; body: string; dedupeKey?: string; sendAfter: number }): Promise<boolean>;
  dueNotices(now: number, limit: number): Promise<NoticeRow[]>;
  markNoticeSent(id: string): Promise<void>;
  notices(personId: string, limit: number): Promise<NoticeRow[]>;
  savePushSub(sub: PushSub): Promise<void>;
  pushSubs(personId: string): Promise<PushSub[]>;
  dropPushSub(endpoint: string): Promise<void>;
  /** Returns the stored value, creating it with `make()` the first time. */
  secret(key: string, make: () => string): Promise<string>;

  audit(entry: Omit<AuditEntry, "at">): Promise<void>;
  auditLog(limit: number): Promise<AuditEntry[]>;
}
