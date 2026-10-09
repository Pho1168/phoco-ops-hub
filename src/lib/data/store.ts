import type { Answer, Checklist, Person, Site, SiteId, TempRule } from "@/lib/domain/types";

export interface Session { id: string; personId: string; siteId: SiteId; startedAt: number; expiresAt: number; revokedAt?: number; revokedReason?: string }
export interface Run { listId: string; date: string; answers: Answer[]; signedBy?: string; signedAt?: number }
export interface Alert { id: string; siteId: SiteId; level: "warning" | "critical"; title: string; detail: string; dedupeKey: string; createdAt: number; resolvedAt?: number; resolvedBy?: string; resolutionNote?: string }
export interface HandoverItem { id: string; siteId: SiteId; category: string; body: string; needsAction: boolean; createdBy: string; createdAt: number; closedAt?: number; closedBy?: string }
export interface AuditEntry { at: number; actorId?: string; siteId?: SiteId; action: string; detail: string }

/**
 * Everything the app reads and writes goes through this interface.
 * DemoStore keeps data in server memory for development; a Supabase store implements the same methods
 * against the schema in supabase/migrations.
 */
export interface Store {
  sites(): Promise<Site[]>;
  site(id: SiteId): Promise<Site | undefined>;
  setSiteStatus(id: SiteId, status: Site["status"], reason?: string): Promise<void>;

  people(): Promise<Person[]>;
  person(id: string): Promise<Person | undefined>;
  updatePerson(id: string, patch: Partial<Person>): Promise<void>;

  createSession(personId: string, siteId: SiteId, ttlMs: number): Promise<Session>;
  session(id: string): Promise<Session | undefined>;
  revokeSessions(match: { personId?: string; siteId?: SiteId; exceptPersonIds?: string[] }, reason: string): Promise<number>;

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
  addHandover(h: Omit<HandoverItem, "id" | "createdAt">): Promise<void>;
  closeHandover(id: string, personId: string): Promise<void>;

  audit(entry: Omit<AuditEntry, "at">): Promise<void>;
  auditLog(limit: number): Promise<AuditEntry[]>;
}
