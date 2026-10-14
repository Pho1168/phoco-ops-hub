import postgres from "postgres";
import type { Answer, Area, Checklist, ChecklistItem, ChecklistTemplate, ChecklistVersion, Outcome, Person, Role, Site, SiteId, TempRule } from "@/lib/domain/types";
import type { Alert, AuditEntry, ChecklistDraftItem, HandoverItem, NoticeRow, PrepEntryView, PrepHandover, Run, RotaResult, Session, SessionScope, ShiftView, Store } from "./store";
import type { RawAnswer } from "@/lib/domain/records";
import type { TeamNotice } from "@/lib/domain/notices";
import type { TimeOff, TimeOffKind, TimeOffStatus } from "@/lib/domain/timeoff";
import type { Certificate, CertKind } from "@/lib/domain/certificates";
import type { Equipment, EquipmentEvent, EquipmentKind, EventKind, Severity } from "@/lib/domain/equipment";
import type { Priority, Task, TaskCategory, TaskStatus } from "@/lib/domain/tasks";
import type { LateMinutes, ReplyKind, ShiftReply } from "@/lib/domain/reminders";
import type { CoverRequest, CoverStatus } from "@/lib/domain/cover";
import { nextCode, type BodyOf, type ChangeKind, type LibraryBody, type LibraryDoc, type LibraryKind, type LibraryVersion, type VersionStatus } from "@/lib/domain/library";
import type { PrepEntry, PrepItem, PrepKind, PrepShift } from "@/lib/domain/prep";
import type { StoredShift, WeekStatus } from "@/lib/domain/rota";
import { addDays, londonDate, londonHM, londonToUtc } from "@/lib/domain/time";
import type { Device } from "@/lib/domain/devices";
import { trainingSections, type Pathway, type Question, type Skill, type TrainingEvent } from "@/lib/domain/training";

/**
 * Postgres implementation of Store, used when DATABASE_URL is set (Supabase in production).
 * The server connects directly to the database; the public Supabase API can read nothing because
 * row level security is on with no policies. Food-safety records are only ever inserted.
 */

type Sql = postgres.Sql;
const g = globalThis as unknown as { __phocoSql?: Sql };

function sql(): Sql {
  if (!g.__phocoSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    // Supabase's transaction pooler (port 6543) hands a database connection to the next client as soon as a query
    // finishes. So: no prepared statements (prepare:false), and one query at a time per connection (max_pipeline:0).
    // With pipelining on, a page that runs many queries at once can be left waiting for an answer that never comes.
    const options = { prepare: false, max: 5, max_pipeline: 0, idle_timeout: 20, connect_timeout: 10 };
    g.__phocoSql = postgres(url, options);
  }
  return g.__phocoSql;
}

/**
 * Runs `fn` in a transaction on one reserved connection. postgres.js's own sql.begin can't be used with
 * max_pipeline:0 (it never marks its connection as reserved), so this does begin / commit / rollback itself.
 */
async function withTx<T>(fn: (tx: postgres.ReservedSql) => Promise<T>): Promise<T> {
  const tx = await sql().reserve();
  try {
    await tx`begin`;
    const result = await fn(tx);
    await tx`commit`;
    return result;
  } catch (e) {
    await tx`rollback`.catch(() => undefined);
    throw e;
  } finally {
    tx.release();
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string) => UUID.test(s);
const ms = (d: Date | null | undefined) => (d ? d.getTime() : undefined);
const num = (v: string | null) => (v === null ? undefined : Number(v));
const opt = <T,>(v: T | null) => (v === null ? undefined : v);

interface LibVersionRow { id: string; doc_id: string; status: VersionStatus; version: number | null; title: string; body: LibraryBody; author_id: string; author_name: string;
  contributors: string[]; rev: number; created_at: Date; updated_at: Date; submitted_by: string | null; submitted_at: Date | null; review_note: string | null; reviewed_by: string | null; reviewed_by_name: string | null;
  reviewed_at: Date | null; approved_by: string | null; approved_by_name: string | null; published_at: Date | null; change: ChangeKind | null; review_by: string | null; superseded_at: Date | null;
  allergens_changed_at: Date | null }
/** `light`: the body carries only its sections and category (the rest empty), for counts and lists. */
const libVersionSelect = (q: postgres.Sql | postgres.ReservedSql, light = false) => q`
  select v.id, v.doc_id, v.status, v.version, v.title,
    ${light ? q`jsonb_build_object('sections', coalesce(v.body->'sections', '[]'::jsonb), 'category', coalesce(v.body->'category', '""'::jsonb), 'purpose', '',
      'steps', '[]'::jsonb, 'ingredients', '[]'::jsonb, 'components', '[]'::jsonb, 'allergens', '{}'::jsonb, 'dietary', '[]'::jsonb)` : q`v.body`} as body,
    v.author_id, a.display_name as author_name, v.contributors::text[] as contributors, v.rev, v.created_at, v.updated_at, v.submitted_by, v.submitted_at,
    v.review_note, v.reviewed_by, r.display_name as reviewed_by_name, v.reviewed_at, v.approved_by, ap.display_name as approved_by_name, v.published_at, v.change,
    to_char(v.review_by, 'YYYY-MM-DD') as review_by, v.superseded_at, v.allergens_changed_at
  from library_versions v join people a on a.id = v.author_id left join people r on r.id = v.reviewed_by left join people ap on ap.id = v.approved_by`;
const libVersionFrom = (r: LibVersionRow): LibraryVersion => ({
  id: r.id, docId: r.doc_id, status: r.status, version: opt(r.version), title: r.title, body: r.body, authorId: r.author_id, authorName: r.author_name,
  contributors: r.contributors ?? [], rev: r.rev, createdAt: r.created_at.getTime(), updatedAt: r.updated_at.getTime(), submittedBy: opt(r.submitted_by), submittedAt: ms(r.submitted_at),
  reviewNote: opt(r.review_note), reviewedBy: opt(r.reviewed_by), reviewedByName: opt(r.reviewed_by_name), reviewedAt: ms(r.reviewed_at),
  approvedBy: opt(r.approved_by), approvedByName: opt(r.approved_by_name), publishedAt: ms(r.published_at), change: opt(r.change), reviewBy: opt(r.review_by),
  supersededAt: ms(r.superseded_at), allergensChangedAt: ms(r.allergens_changed_at),
});
interface LibDocRow { id: string; kind: LibraryKind; code: string; created_at: Date; retired_at: Date | null; retired_by: string | null; retired_note: string | null }
async function libDocsWith(q: postgres.Sql, docs: LibDocRow[], light = false): Promise<LibraryDoc[]> {
  if (!docs.length) return [];
  const versions = (await q<LibVersionRow[]>`${libVersionSelect(q, light)}
    where v.doc_id = any(${docs.map((d) => d.id)}::uuid[]) and v.status in ('published', 'draft', 'in_review')`).map(libVersionFrom);
  return docs.map((d) => ({
    id: d.id, kind: d.kind, code: d.code, createdAt: d.created_at.getTime(), retiredAt: ms(d.retired_at), retiredBy: opt(d.retired_by), retiredNote: opt(d.retired_note),
    published: versions.find((v) => v.docId === d.id && v.status === "published"),
    open: versions.find((v) => v.docId === d.id && (v.status === "draft" || v.status === "in_review")),
  }));
}

interface TaskRow { id: string; site_id: SiteId; title: string; detail: string | null; priority: number; category: TaskCategory; assignee_id: string | null; assignee_name: string | null;
  section: Area | null; due_on: string | null; status: TaskStatus; created_by: string; created_by_name: string; created_at: Date; done_by: string | null; done_by_name: string | null;
  done_at: Date | null; done_note: string | null; cancelled_by: string | null; cancelled_at: Date | null }
const taskSelect = (q: postgres.Sql) => q`
  select t.id, t.site_id, t.title, t.detail, t.priority, t.category, t.assignee_id, a.display_name as assignee_name, t.section, to_char(t.due_on, 'YYYY-MM-DD') as due_on,
    t.status, t.created_by, c.display_name as created_by_name, t.created_at, t.done_by, d.display_name as done_by_name, t.done_at, t.done_note, t.cancelled_by, t.cancelled_at
  from tasks t join people c on c.id = t.created_by left join people a on a.id = t.assignee_id left join people d on d.id = t.done_by`;
const taskFrom = (r: TaskRow): Task => ({
  id: r.id, siteId: r.site_id, title: r.title, detail: opt(r.detail), priority: r.priority as Priority, category: r.category, assigneeId: opt(r.assignee_id),
  assigneeName: opt(r.assignee_name), section: opt(r.section), dueOn: opt(r.due_on), status: r.status, createdBy: r.created_by, createdByName: r.created_by_name,
  createdAt: r.created_at.getTime(), doneBy: opt(r.done_by), doneByName: opt(r.done_by_name), doneAt: ms(r.done_at), doneNote: opt(r.done_note),
  cancelledBy: opt(r.cancelled_by), cancelledAt: ms(r.cancelled_at),
});

interface EqRow { id: string; site_id: SiteId; name: string; kind: EquipmentKind; location: string | null; make_model: string | null; serial: string | null;
  service_every_months: number | null; service_contact: string | null; instructions: string | null; created_at: Date; retired_at: Date | null }
const eqFrom = (r: EqRow): Equipment => ({
  id: r.id, siteId: r.site_id, name: r.name, kind: r.kind, location: opt(r.location), makeModel: opt(r.make_model), serial: opt(r.serial),
  serviceEveryMonths: opt(r.service_every_months), serviceContact: opt(r.service_contact), instructions: opt(r.instructions),
  createdAt: r.created_at.getTime(), retiredAt: ms(r.retired_at),
});

interface CertRow { id: string; person_id: string; kind: CertKind; issued_on: string | null; expires_on: string | null; provider: string | null; reference: string | null;
  note: string | null; created_by: string; created_by_name: string; created_at: Date }
const certSelect = (q: postgres.Sql) => q`
  select c.id, c.person_id, c.kind, to_char(c.issued_on, 'YYYY-MM-DD') as issued_on, to_char(c.expires_on, 'YYYY-MM-DD') as expires_on,
    c.provider, c.reference, c.note, c.created_by, p.display_name as created_by_name, c.created_at
  from staff_certificates c join people p on p.id = c.created_by`;
const certFrom = (r: CertRow): Certificate => ({
  id: r.id, personId: r.person_id, kind: r.kind, issuedOn: opt(r.issued_on), expiresOn: opt(r.expires_on), provider: opt(r.provider), reference: opt(r.reference),
  note: opt(r.note), createdBy: r.created_by, createdByName: r.created_by_name, createdAt: r.created_at.getTime(),
});
interface CoverRow {
  id: string; shift_id: string; site_id: SiteId; site_name: string; person_id: string; person_name: string; section: string; note: string | null;
  status: CoverStatus; created_at: Date; covered_by: string | null; covered_by_name: string | null; decided_by: string | null; decided_by_name: string | null;
  decided_at: Date | null; decision_note: string | null; cancelled_by_name: string | null; cover_cancelled_at: Date | null; cancel_note: string | null;
  starts_at: Date; ends_at: Date; cancelled_at: Date | null; shift_person_id: string; coverer_on_rota: boolean;
  offers: { id: string; person_id: string; name: string; created_at: string; withdrawn_at: string | null }[];
}
const coverSelect = (q: postgres.Sql, where: postgres.PendingQuery<postgres.Row[]>) => q<CoverRow[]>`
  select c.id, c.shift_id, c.site_id, si.name as site_name, c.person_id, p.display_name as person_name, c.section, c.note, c.status, c.created_at,
    c.covered_by, cb.display_name as covered_by_name, c.decided_by, d.display_name as decided_by_name, c.decided_at, c.decision_note,
    xp.display_name as cancelled_by_name, c.cancelled_at as cover_cancelled_at, c.cancel_note,
    s.starts_at, s.ends_at, s.cancelled_at, s.person_id as shift_person_id,
    (c.covered_by is not null and exists (select 1 from shifts x where x.person_id = c.covered_by and x.site_id = c.site_id and x.cancelled_at is null
       and x.starts_at < s.ends_at and s.starts_at < x.ends_at)) as coverer_on_rota,
    coalesce((select json_agg(json_build_object('id', o.id, 'person_id', o.person_id, 'name', op.display_name, 'created_at', o.created_at, 'withdrawn_at', o.withdrawn_at) order by o.created_at)
              from cover_offers o join people op on op.id = o.person_id where o.request_id = c.id), '[]') as offers
  from cover_requests c join shifts s on s.id = c.shift_id join sites si on si.id = c.site_id join people p on p.id = c.person_id
  left join people cb on cb.id = c.covered_by left join people d on d.id = c.decided_by left join people xp on xp.id = c.cancelled_by
  ${where}
  order by c.created_at desc`;
const coverFrom = (r: CoverRow): CoverRequest => ({
  id: r.id, shiftId: r.shift_id, siteId: r.site_id, siteName: r.site_name, personId: r.person_id, personName: r.person_name, section: r.section,
  note: opt(r.note), status: r.status, createdAt: r.created_at.getTime(), coveredBy: opt(r.covered_by), coveredByName: opt(r.covered_by_name),
  decidedBy: opt(r.decided_by), decidedByName: opt(r.decided_by_name), decidedAt: ms(r.decided_at), decisionNote: opt(r.decision_note),
  cancelledByName: opt(r.cancelled_by_name), cancelledAt: ms(r.cover_cancelled_at), cancelNote: opt(r.cancel_note),
  date: londonDate(r.starts_at.getTime()), start: londonHM(r.starts_at.getTime()), end: londonHM(r.ends_at.getTime()),
  shiftCancelled: !!r.cancelled_at, shiftPersonId: r.shift_person_id, covererOnRota: r.coverer_on_rota,
  offers: r.offers.map((o) => ({ id: o.id, personId: o.person_id, personName: o.name, createdAt: Date.parse(o.created_at), withdrawnAt: o.withdrawn_at ? Date.parse(o.withdrawn_at) : undefined })),
});

interface ReplyRow { id: string; shift_id: string; person_id: string; site_id: SiteId; kind: ReplyKind; late_minutes: number | null; created_at: Date }
const replyFrom = (r: ReplyRow): ShiftReply => ({ id: r.id, shiftId: r.shift_id, personId: r.person_id, siteId: r.site_id, kind: r.kind,
  lateMinutes: r.late_minutes === null ? undefined : (r.late_minutes as LateMinutes), createdAt: r.created_at.getTime() });

// The database stores an un-ticked item as 'cleared'; the app calls it 'todo'.
const toDbOutcome = (o: Outcome) => (o === "todo" ? "cleared" : o);
const fromDbOutcome = (o: string): Outcome => (o === "cleared" ? "todo" : (o as Outcome));

interface PersonRow {
  id: string; staff_code: string; display_name: string; status: Person["status"]; frozen_reason: string | null;
  pin_hash: string | null; pin_failed: number; pin_locked_until: Date | null; pin_must_change: boolean; sees_right_to_work: boolean;
  access: { site_id: SiteId; role: Role; sections: Area[] }[] | null;
}

function toPerson(r: PersonRow): Person {
  return {
    id: r.id, staffCode: r.staff_code, name: r.display_name, status: r.status, frozenReason: opt(r.frozen_reason),
    pinHash: opt(r.pin_hash), pinFailed: r.pin_failed, pinLockedUntil: ms(r.pin_locked_until), pinMustChange: r.pin_must_change,
    seesRightToWork: r.sees_right_to_work,
    access: (r.access ?? []).map((a) => ({ siteId: a.site_id, role: a.role, sections: a.sections })),
  };
}

function toSite(r: { id: SiteId; name: string; kind: Site["kind"]; status: Site["status"]; closed_reason: string | null; ready_by: string | null }): Site {
  return { id: r.id, name: r.name, kind: r.kind, status: r.status, closedReason: opt(r.closed_reason), readyBy: r.ready_by ?? undefined };
}

async function selectPeople(where: postgres.PendingQuery<postgres.Row[]> | null): Promise<Person[]> {
  const q = sql();
  const rows = await q<PersonRow[]>`
    select p.id, p.staff_code, p.display_name, p.status, p.frozen_reason, p.pin_hash, p.pin_failed, p.pin_locked_until, p.pin_must_change,
      p.sees_right_to_work,
      (select coalesce(json_agg(json_build_object('site_id', ps.site_id, 'role', ps.role, 'sections', ps.sections) order by ps.site_id), '[]')
         from person_sites ps where ps.person_id = p.id) as access
    from people p
    ${where ?? q``}
    order by p.display_name`;
  return rows.map(toPerson);
}

async function loadChecklists(filter: postgres.PendingQuery<postgres.Row[]>): Promise<Checklist[]> {
  const q = sql();
  const rows = await q<{
    id: string; site_id: SiteId; name: string; area: Area; when_label: string; due_time: string | null; is_suggested: boolean;
    items: { id: string; position: number; section: string; text: string; answer_type: Checklist["items"][number]["type"]; rule_code: string | null; hint: string | null; tag: string | null }[] | null;
  }[]>`
    select t.id, t.site_id, t.name, t.area, t.when_label, t.due_time::text, t.is_suggested,
      (select json_agg(json_build_object('id', i.id, 'position', i.position, 'section', i.section, 'text', i.text,
                'answer_type', i.answer_type, 'rule_code', i.rule_code, 'hint', i.hint, 'tag', i.tag) order by i.position)
         from checklist_items i
         where i.version_id = (select v.id from checklist_versions v where v.template_id = t.id and v.status = 'published'
                               order by v.version desc limit 1)) as items
    from checklist_templates t
    where t.active and ${filter}
    order by t.id`;
  return rows.map((r) => ({
    id: r.id, siteId: r.site_id, name: r.name, area: r.area, when: r.when_label,
    due: r.due_time ? r.due_time.slice(0, 5) : undefined, suggested: r.is_suggested,
    items: (r.items ?? []).map((i) => ({
      id: i.id, position: i.position, section: i.section, text: i.text, type: i.answer_type,
      ruleCode: opt(i.rule_code), hint: opt(i.hint), tag: opt(i.tag),
    })),
  }));
}

// ---------- editing checklists ----------

interface ItemRow { id: string; position: number; section: string; text: string; answer_type: ChecklistItem["type"]; rule_code: string | null; hint: string | null; tag: string | null }
interface VersionRow { id: string; template_id: string; version: number; status: ChecklistVersion["status"]; source_note: string | null; approved_by: string | null; published_at: Date | null; created_by: string | null; created_at: Date; updated_at: Date; items: ItemRow[] | null }

const toItem = (i: ItemRow): ChecklistItem => ({ id: i.id, position: i.position, section: i.section, text: i.text, type: i.answer_type, ruleCode: opt(i.rule_code), hint: opt(i.hint), tag: opt(i.tag) });
const toVersion = (v: VersionRow): ChecklistVersion => ({
  id: v.id, templateId: v.template_id, version: v.version, status: v.status, items: (v.items ?? []).map(toItem), note: opt(v.source_note),
  createdBy: opt(v.created_by), createdAt: v.created_at.getTime(), updatedAt: v.updated_at.getTime(), publishedAt: v.published_at?.getTime(), publishedBy: opt(v.approved_by),
});

/** Versions of the checklists matching the filter, with items for the published and draft ones. */
async function loadVersions(filter: postgres.PendingQuery<postgres.Row[]>): Promise<ChecklistVersion[]> {
  const q = sql();
  const rows = await q<VersionRow[]>`
    select v.id, v.template_id, v.version, v.status, v.source_note, v.approved_by, v.published_at, v.created_by, v.created_at, v.updated_at,
      case when v.status in ('published', 'draft') then
        (select json_agg(json_build_object('id', i.id, 'position', i.position, 'section', i.section, 'text', i.text,
                  'answer_type', i.answer_type, 'rule_code', i.rule_code, 'hint', i.hint, 'tag', i.tag) order by i.position)
           from checklist_items i where i.version_id = v.id) end as items
    from checklist_versions v
    where ${filter}
    order by v.version desc`;
  return rows.map(toVersion);
}

async function loadTemplates(filter: postgres.PendingQuery<postgres.Row[]>): Promise<ChecklistTemplate[]> {
  const q = sql();
  const rows = await q<{ id: string; site_id: SiteId; name: string; area: Area; when_label: string; due_time: string | null; is_suggested: boolean; active: boolean }[]>`
    select t.id, t.site_id, t.name, t.area, t.when_label, t.due_time::text, t.is_suggested, t.active
    from checklist_templates t where ${filter} order by t.id`;
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const versions = await loadVersions(q`v.template_id in ${q(ids)} and v.status in ('published', 'draft')`);
  return rows.map((r) => ({
    id: r.id, siteId: r.site_id, name: r.name, area: r.area, when: r.when_label, due: r.due_time ? r.due_time.slice(0, 5) : undefined,
    suggested: r.is_suggested, active: r.active,
    published: versions.find((v) => v.templateId === r.id && v.status === "published"),
    draft: versions.find((v) => v.templateId === r.id && v.status === "draft"),
  }));
}

async function insertItems(tx: postgres.ReservedSql | postgres.Sql, versionId: string, items: ChecklistDraftItem[]) {
  for (const [n, i] of items.entries()) {
    await tx`insert into checklist_items (version_id, position, section, text, answer_type, rule_code, hint)
             values (${versionId}, ${n + 1}, ${i.section}, ${i.text}, ${i.type}, ${i.ruleCode ?? null}, ${i.hint ?? null})`;
  }
}

interface NoticeDbRow { id: string; person_id: string; kind: NoticeRow["kind"]; title: string; body: string; send_after: Date; sent_at: Date | null; created_at: Date; url: string | null }
const toNotice = (r: NoticeDbRow): NoticeRow => ({ id: r.id, personId: r.person_id, kind: r.kind, title: r.title, body: r.body, sendAfter: r.send_after.getTime(), sentAt: ms(r.sent_at), createdAt: r.created_at.getTime(), url: opt(r.url) });

interface DeviceRow { id: string; site_id: SiteId; label: string; status: Device["status"]; last_seen: Date | null; created_at: Date }
const toDevice = (r: DeviceRow): Device => ({ id: r.id, siteId: r.site_id, label: r.label, status: r.status, lastSeen: ms(r.last_seen), createdAt: r.created_at.getTime() });

// ---------- kitchen prep ----------
interface PrepEntryRow {
  id: string; handover_id: string; site_id: SiteId; item_id: string; status: PrepEntry["status"]; urgent: boolean; note: string | null;
  carried_from: string | null; created_by: string; created_at: Date; completed_by: string | null; completed_at: Date | null;
  assigned_to: string | null; assigned_by: string | null; assigned_at: Date | null;
  created_by_name?: string | null; completed_by_name?: string | null; assigned_to_name?: string | null; assigned_by_name?: string | null;
}
const toPrepEntry = (r: PrepEntryRow): PrepEntryView => ({
  id: r.id, handoverId: r.handover_id, siteId: r.site_id, itemId: r.item_id, status: r.status, urgent: r.urgent, note: opt(r.note),
  carriedFrom: opt(r.carried_from), createdBy: r.created_by, createdAt: r.created_at.getTime(), completedBy: opt(r.completed_by),
  completedAt: ms(r.completed_at), createdByName: r.created_by_name ?? "", completedByName: opt(r.completed_by_name ?? null),
  assignedTo: opt(r.assigned_to), assignedBy: opt(r.assigned_by), assignedAt: ms(r.assigned_at),
  assignedToName: opt(r.assigned_to_name ?? null), assignedByName: opt(r.assigned_by_name ?? null),
});
/** Someone a handover item can be given to (canBeGiven in src/lib/domain/assign.ts): active and working at the site. */
const givable = (q: postgres.Sql, personId: string, siteId: SiteId) =>
  q`exists (select 1 from people p join person_sites ps on ps.person_id = p.id where p.id = ${personId} and p.status = 'active' and ps.site_id = ${siteId})`;
interface PrepHandoverRow {
  id: string; site_id: SiteId; shift: PrepShift; status: "draft" | "submitted"; created_by: string; created_by_name: string | null;
  created_at: Date; updated_at: Date; submitted_by: string | null; submitted_by_name: string | null; submitted_at: Date | null; stocked_count: number | null;
}
async function prepEntriesOf(ids: string[]): Promise<PrepEntryView[]> {
  if (!ids.length) return [];
  const q = sql();
  const rows = await q<PrepEntryRow[]>`
    select e.*, c.display_name as created_by_name, d.display_name as completed_by_name, a.display_name as assigned_to_name, ab.display_name as assigned_by_name
    from prep_entries e join people c on c.id = e.created_by left join people d on d.id = e.completed_by
      left join people a on a.id = e.assigned_to left join people ab on ab.id = e.assigned_by
    where e.handover_id = any(${ids}::uuid[])`;
  return rows.map(toPrepEntry);
}
async function prepHandoversWhere(where: postgres.PendingQuery<postgres.Row[]>, limit = 50): Promise<PrepHandover[]> {
  const q = sql();
  const rows = await q<PrepHandoverRow[]>`
    select h.*, c.display_name as created_by_name, s.display_name as submitted_by_name
    from prep_handovers h join people c on c.id = h.created_by left join people s on s.id = h.submitted_by
    where ${where} order by h.submitted_at desc nulls first, h.created_at desc limit ${limit}`;
  const entries = await prepEntriesOf(rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id, siteId: r.site_id, shift: r.shift, status: r.status, createdBy: r.created_by, createdByName: r.created_by_name ?? "",
    createdAt: r.created_at.getTime(), updatedAt: r.updated_at.getTime(), submittedBy: opt(r.submitted_by), submittedByName: opt(r.submitted_by_name),
    submittedAt: ms(r.submitted_at), stockedCount: opt(r.stocked_count), entries: entries.filter((e) => e.handoverId === r.id),
  }));
}

// ---------- training ----------
interface SkillRow {
  id: string; section: Area; grp: string; position: number; title: string; about: string; hands_on: boolean; induction: boolean; links: string[] | null;
  video_url: string | null; refresher_months: number | null; pass_mark: number; created_at: Date; updated_at: Date; added_at: Date; induction_from: Date | null;
  refresher_from: Date | null; refresher_was: number | null; link_since: Record<string, number> | null; rev: number; retired_at: Date | null;
}
const toSkill = (r: SkillRow): Skill => ({
  id: r.id, section: r.section, group: r.grp, position: r.position, title: r.title, about: r.about, handsOn: r.hands_on, induction: r.induction,
  links: r.links ?? [], videoUrl: opt(r.video_url), refresherMonths: opt(r.refresher_months), passMark: r.pass_mark,
  createdAt: r.created_at.getTime(), updatedAt: r.updated_at.getTime(), addedAt: r.added_at.getTime(), inductionFrom: ms(r.induction_from),
  refresherFrom: ms(r.refresher_from), refresherWas: opt(r.refresher_was), linkedAt: Object.fromEntries(Object.entries(r.link_since ?? {}).map(([k, v]) => [k, Number(v)])),
  rev: r.rev, retiredAt: ms(r.retired_at),
});
interface QuestionRow { id: string; skill_id: string; position: number; text: string; options: string[]; answer: number; approved_at: Date | null; created_at: Date; updated_at: Date }
const toQuestion = (r: QuestionRow): Question => ({
  id: r.id, skillId: r.skill_id, position: r.position, text: r.text, options: r.options, answer: r.answer, approved: !!r.approved_at,
  approvedAt: ms(r.approved_at), createdAt: r.created_at.getTime(), updatedAt: r.updated_at.getTime(),
});
interface TrainingEventRow { id: string; person_id: string; skill_id: string; kind: TrainingEvent["kind"]; at: Date; by_id: string; by_name: string | null; score: number | null; passed: boolean | null; note: string | null }
const toTrainingEvent = (r: TrainingEventRow): TrainingEvent => ({
  id: r.id, personId: r.person_id, skillId: r.skill_id, kind: r.kind, at: r.at.getTime(), byId: r.by_id, byName: r.by_name ?? "",
  score: opt(r.score), passed: opt(r.passed), note: opt(r.note),
});
/** One position change at a time in the skill list (adding, moving, bringing back). */
const lockSkillOrder = (tx: postgres.ReservedSql) => tx`select pg_advisory_xact_lock(hashtext('training_skills.position'))`;
/**
 * The sections someone trains in now (the rule is trainingSections), read inside a transaction. A freeze on its own
 * (not a site closure) doesn't stop training, so unfreezing doesn't start it again.
 */
async function traineeSections(tx: postgres.ReservedSql, personId: string): Promise<Area[]> {
  const [p] = await tx<{ status: Person["status"] }[]>`select status from people where id = ${personId}`;
  if (!p) return [];
  const access = await tx<{ site_id: SiteId; role: Role; sections: Area[] }[]>`select site_id, role, sections from person_sites where person_id = ${personId}`;
  const sites = await tx<{ id: SiteId; status: Site["status"] }[]>`select id, status from sites`;
  const status = p.status === "frozen" ? "active" : p.status;
  return trainingSections({ status, access: access.map((a) => ({ siteId: a.site_id, role: a.role, sections: a.sections })) }, sites);
}
/**
 * Makes a change to people, their access or a site, then starts training today in each section someone trains in now
 * that they didn't before: given a new section, back from leaving, or their site reopened.
 */
async function withStarts<T>(tx: postgres.ReservedSql, personIds: string[], change: () => Promise<T>): Promise<T> {
  const before = new Map<string, Area[]>();
  for (const id of personIds) before.set(id, await traineeSections(tx, id));
  const out = await change();
  for (const id of personIds) {
    const fresh = (await traineeSections(tx, id)).filter((sec) => !before.get(id)!.includes(sec));
    if (fresh.length) {
      await tx`insert into training_starts (person_id, section, started_on)
        select ${id}, s, (now() at time zone 'Europe/London')::date from unnest(${fresh}::text[]) as s on conflict do nothing`;
    }
  }
  return out;
}

export const sqlStore: Store = {
  async sites() {
    const q = sql();
    return (await q`select id, name, kind, status, closed_reason, to_char(ready_by, 'HH24:MI') as ready_by from sites order by case id when 'EAS' then 1 when 'WEM' then 2 else 3 end`)
      .map((r) => toSite(r as Parameters<typeof toSite>[0]));
  },
  async site(id) {
    const q = sql();
    const [r] = await q`select id, name, kind, status, closed_reason, to_char(ready_by, 'HH24:MI') as ready_by from sites where id = ${id}`;
    return r ? toSite(r as Parameters<typeof toSite>[0]) : undefined;
  },
  async setSiteStatus(id, status, reason) {
    await withTx(async (tx) => {
      const people = (await tx<{ person_id: string }[]>`select distinct person_id from person_sites where site_id = ${id}`).map((r) => r.person_id);
      await withStarts(tx, people, async () => {
        if (status === "closed") await tx`update sites set status = 'closed', closed_reason = ${reason ?? null}, closed_at = now() where id = ${id}`;
        else await tx`update sites set status = 'open', closed_reason = null, closed_at = null, closed_by = null where id = ${id}`;
      });
    });
  },

  async people() { return selectPeople(null); },
  async person(id) {
    if (!isUuid(id)) return undefined;
    const q = sql();
    return (await selectPeople(q`where p.id = ${id}`))[0];
  },
  async updatePerson(id, patch) {
    if (!isUuid(id)) return;
    const cols: Record<string, unknown> = {};
    if ("name" in patch) cols.display_name = patch.name;
    if ("staffCode" in patch) cols.staff_code = patch.staffCode;
    if ("pinMustChange" in patch) cols.pin_must_change = !!patch.pinMustChange;
    if ("status" in patch) cols.status = patch.status;
    if ("frozenReason" in patch) cols.frozen_reason = patch.frozenReason ?? null;
    if ("pinHash" in patch) cols.pin_hash = patch.pinHash ?? null;
    if ("pinFailed" in patch) cols.pin_failed = patch.pinFailed ?? 0;
    if ("pinLockedUntil" in patch) cols.pin_locked_until = patch.pinLockedUntil ? new Date(patch.pinLockedUntil) : null;
    const keys = Object.keys(cols);
    if (!keys.length) return;
    const set = (q: postgres.Sql | postgres.ReservedSql) => q`update people set ${q(cols as Record<string, postgres.ParameterOrJSON<never>>, ...keys)} where id = ${id}`;
    // Back from leaving or a freeze: training starts again in their sections.
    if ("status" in patch) await withTx((tx) => withStarts(tx, [id], async () => { await set(tx); }));
    else await set(sql());
  },

  async createPerson({ staffCode, name, pinHash, pinMustChange, access }) {
    return withTx(async (tx) => {
      const [p] = await tx<{ id: string }[]>`
        insert into people (staff_code, display_name, pin_hash, pin_must_change)
        values (${staffCode}, ${name}, ${pinHash}, ${pinMustChange}) returning id`;
      await withStarts(tx, [p.id], async () => {
        for (const a of access) {
          await tx`insert into person_sites (person_id, site_id, role, sections) values (${p.id}, ${a.siteId}, ${a.role}, ${a.sections})`;
        }
      });
      return p.id;
    });
  },
  async setAccess(personId, access) {
    if (!isUuid(personId)) return;
    await withTx((tx) => withStarts(tx, [personId], async () => {
      await tx`delete from person_sites where person_id = ${personId}`;
      for (const a of access) {
        await tx`insert into person_sites (person_id, site_id, role, sections) values (${personId}, ${a.siteId}, ${a.role}, ${a.sections})`;
      }
    }));
  },

  async createSession(personId, siteId, ttlMs, deviceId, scope = "full") {
    const q = sql();
    const dev = deviceId && isUuid(deviceId) ? deviceId : null;
    const [r] = await q<{ id: string; started_at: Date; expires_at: Date }[]>`
      insert into app_sessions (person_id, site_id, device_id, scope, expires_at) values (${personId}, ${siteId}, ${dev}, ${scope}, ${new Date(Date.now() + ttlMs)})
      returning id, started_at, expires_at`;
    return { id: r.id, personId, siteId, deviceId: dev ?? undefined, scope, startedAt: r.started_at.getTime(), expiresAt: r.expires_at.getTime() };
  },
  async session(id) {
    if (!isUuid(id)) return undefined;
    const q = sql();
    const [r] = await q<{ id: string; person_id: string; site_id: SiteId; device_id: string | null; scope: SessionScope; started_at: Date; expires_at: Date; revoked_at: Date | null; revoked_reason: string | null }[]>`
      select id, person_id, site_id, device_id, scope, started_at, expires_at, revoked_at, revoked_reason from app_sessions where id = ${id}`;
    if (!r) return undefined;
    const s: Session = { id: r.id, personId: r.person_id, siteId: r.site_id, deviceId: opt(r.device_id), scope: r.scope, startedAt: r.started_at.getTime(), expiresAt: r.expires_at.getTime() };
    if (r.revoked_at) { s.revokedAt = r.revoked_at.getTime(); s.revokedReason = opt(r.revoked_reason); }
    return s;
  },
  async revokeSessions(match, reason) {
    const q = sql();
    const except = (match.exceptPersonIds ?? []).filter(isUuid);
    if (match.personId && !isUuid(match.personId)) return 0;
    const res = await q`
      update app_sessions set revoked_at = now(), revoked_reason = ${reason}
      where revoked_at is null
        ${match.personId ? q`and person_id = ${match.personId}` : q``}
        ${match.siteId ? q`and site_id = ${match.siteId}` : q``}
        ${match.deviceId && isUuid(match.deviceId) ? q`and device_id = ${match.deviceId}` : q``}
        ${except.length ? q`and not (person_id = any(${except}::uuid[]))` : q``}
        ${match.exceptSessionId && isUuid(match.exceptSessionId) ? q`and id <> ${match.exceptSessionId}` : q``}`;
    return res.count;
  },

  async devices() {
    const q = sql();
    return (await q<DeviceRow[]>`select id, site_id, label, status, last_seen, created_at from devices where token_hash is not null order by status, site_id, label`).map(toDevice);
  },
  async deviceByToken(tokenHash) {
    const q = sql();
    const [r] = await q<DeviceRow[]>`
      update devices set last_seen = now() where token_hash = ${tokenHash}
      returning id, site_id, label, status, last_seen, created_at`;
    return r ? toDevice(r) : undefined;
  },
  async device(id) {
    if (!isUuid(id)) return undefined;
    const q = sql();
    const [r] = await q<DeviceRow[]>`select id, site_id, label, status, last_seen, created_at from devices where id = ${id}`;
    return r ? toDevice(r) : undefined;
  },
  async setDeviceStatus(id, status) {
    if (!isUuid(id)) return;
    const q = sql();
    await q`update devices set status = ${status} where id = ${id}`;
  },
  async createPairing(p) {
    const q = sql();
    await q`insert into device_pairings (code_hash, site_id, label, created_by, expires_at)
            values (${p.codeHash}, ${p.siteId}, ${p.label}, ${p.createdBy}, ${new Date(p.expiresAt)})`;
  },
  async redeemPairing(codeHash, tokenHash, now) {
    return withTx(async (tx) => {
      // Locks the code row so two tablets can't use the same code at once.
      const [p] = await tx<{ id: string; site_id: SiteId; label: string; created_by: string }[]>`
        select id, site_id, label, created_by from device_pairings
        where code_hash = ${codeHash} and used_at is null and expires_at > ${new Date(now)}
        for update`;
      if (!p) return undefined;
      const [d] = await tx<DeviceRow[]>`
        insert into devices (site_id, label, status, token_hash, created_by, last_seen)
        values (${p.site_id}, ${p.label}, 'active', ${tokenHash}, ${p.created_by}, now())
        returning id, site_id, label, status, last_seen, created_at`;
      await tx`update device_pairings set used_at = now(), device_id = ${d.id} where id = ${p.id}`;
      return toDevice(d);
    });
  },

  async rules() {
    const q = sql();
    const rows = await q<{ code: string; label: string; target_max: string | null; target_min: string | null; legal_max: string | null; legal_min: string | null }[]>`
      select code, label, target_max, target_min, legal_max, legal_min from temp_rules`;
    const out: Record<string, TempRule> = {};
    for (const r of rows) out[r.code] = { code: r.code, label: r.label, targetMax: num(r.target_max), targetMin: num(r.target_min), legalMax: num(r.legal_max), legalMin: num(r.legal_min) };
    return out;
  },
  async checklists(siteId) { const q = sql(); return loadChecklists(q`t.site_id = ${siteId}`); },
  async checklist(id) { const q = sql(); return (await loadChecklists(q`t.id = ${id}`))[0]; },
  async checklistTemplates(siteId) { const q = sql(); return loadTemplates(q`t.site_id = ${siteId}`); },
  async checklistTemplate(id) { const q = sql(); return (await loadTemplates(q`t.id = ${id}`))[0]; },
  async checklistVersions(templateId) { const q = sql(); return loadVersions(q`v.template_id = ${templateId}`); },
  async createChecklist(t, items, by) {
    await withTx(async (tx) => {
      await tx`insert into checklist_templates (id, site_id, name, area, when_label, due_time, is_suggested, active)
               values (${t.id}, ${t.siteId}, ${t.name}, ${t.area}, ${t.when}, ${t.due ?? null}, false, true)`;
      const [v] = await tx<{ id: string }[]>`
        insert into checklist_versions (template_id, version, status, source_note, created_by) values (${t.id}, 1, 'draft', 'New checklist', ${by}) returning id`;
      await insertItems(tx, v.id, items);
    });
  },
  async updateChecklistSettings(id, next) {
    await sql()`update checklist_templates set name = ${next.name}, area = ${next.area}, when_label = ${next.when}, due_time = ${next.due ?? null}, active = ${next.active} where id = ${id}`;
  },
  async saveChecklistDraft(templateId, items, note, by) {
    const id = await withTx(async (tx) => {
      await tx`select id from checklist_templates where id = ${templateId} for update`;
      let [d] = await tx<{ id: string }[]>`select id from checklist_versions where template_id = ${templateId} and status = 'draft'`;
      if (!d) {
        [d] = await tx<{ id: string }[]>`
          insert into checklist_versions (template_id, version, status, source_note, created_by)
          values (${templateId}, (select coalesce(max(version), 0) + 1 from checklist_versions where template_id = ${templateId}), 'draft', ${note}, ${by})
          returning id`;
      } else {
        await tx`delete from checklist_items where version_id = ${d.id}`;
        await tx`update checklist_versions set source_note = ${note}, updated_at = now() where id = ${d.id}`;
      }
      await insertItems(tx, d.id, items);
      return d.id;
    });
    const q = sql();
    return (await loadVersions(q`v.id = ${id}`))[0];
  },
  async publishChecklistDraft(templateId, by) {
    await withTx(async (tx) => {
      await tx`select id from checklist_templates where id = ${templateId} for update`;
      const [d] = await tx<{ id: string; n: number }[]>`
        select v.id, (select count(*)::int from checklist_items i where i.version_id = v.id) as n
        from checklist_versions v where v.template_id = ${templateId} and v.status = 'draft'`;
      if (!d) throw new Error("No draft to publish");
      if (d.n === 0) throw new Error("A version needs at least one check");
      await tx`update checklist_versions set status = 'retired', updated_at = now() where template_id = ${templateId} and status = 'published'`;
      await tx`update checklist_versions set status = 'published', approved_by = ${by}, published_at = now(), updated_at = now() where id = ${d.id}`;
    });
  },
  async discardChecklistDraft(templateId) {
    await sql()`update checklist_versions set status = 'discarded', updated_at = now() where template_id = ${templateId} and status = 'draft'`;
  },

  async run(listId, date) {
    const q = sql();
    const [r] = await q<{ id: string; signed_by: string | null; signed_at: Date | null }[]>`
      select id, signed_by, signed_at from checklist_runs where template_id = ${listId} and business_date = ${date}`;
    const run: Run = { listId, date, answers: [] };
    if (!r) return run;
    if (r.signed_at) { run.signedAt = r.signed_at.getTime(); run.signedBy = opt(r.signed_by); }
    const rows = await q<{ item_id: string; value: string | null; outcome: string; recorded_by: string; captured_at: Date; action: string | null }[]>`
      select a.item_id, a.value, a.outcome, a.recorded_by, a.captured_at,
        (select c.action from corrective_actions c where c.answer_id = a.id order by c.recorded_at desc limit 1) as action
      from run_answers a where a.run_id = ${r.id}
      order by a.captured_at, a.synced_at, a.id`;
    run.answers = rows.map((a): Answer => ({
      itemId: a.item_id, value: a.value ?? "", outcome: fromDbOutcome(a.outcome), action: opt(a.action),
      recordedBy: a.recorded_by, capturedAt: a.captured_at.getTime(),
    }));
    return run;
  },
  async addAnswer(listId, date, answer) {
    await withTx(async (tx) => {
      const [run] = await tx<{ id: string }[]>`
        insert into checklist_runs (template_id, version_id, site_id, business_date)
        select t.id, v.id, t.site_id, ${date}
        from checklist_templates t
        join checklist_versions v on v.template_id = t.id and v.status = 'published'
        where t.id = ${listId}
        order by v.version desc limit 1
        on conflict (template_id, business_date) do update set template_id = excluded.template_id
        returning id`;
      if (!run) throw new Error(`No published version for checklist ${listId}`);
      const [prev] = await tx<{ id: string }[]>`
        select id from run_answers where run_id = ${run.id} and item_id = ${answer.itemId}
        order by captured_at desc, synced_at desc limit 1`;
      const n = Number(answer.value);
      const [row] = await tx<{ id: string }[]>`
        insert into run_answers (run_id, item_id, value, numeric_value, outcome, recorded_by, captured_at, supersedes)
        values (${run.id}, ${answer.itemId}, ${answer.value}, ${answer.value !== "" && Number.isFinite(n) ? n : null},
                ${toDbOutcome(answer.outcome)}, ${answer.recordedBy}, ${new Date(answer.capturedAt)}, ${prev?.id ?? null})
        returning id`;
      if (answer.action) {
        await tx`insert into corrective_actions (answer_id, action, recorded_by) values (${row.id}, ${answer.action}, ${answer.recordedBy})`;
      }
    });
  },
  async signRun(listId, date, personId) {
    const q = sql();
    await q`update checklist_runs set status = 'signed', signed_by = ${personId}, signed_at = now()
            where template_id = ${listId} and business_date = ${date} and signed_at is null`;
  },

  async alerts(siteId) {
    const q = sql();
    const rows = await q<{ id: string; site_id: SiteId; level: Alert["level"]; title: string; detail: string | null; dedupe_key: string; created_at: Date; resolved_at: Date | null; resolved_by: string | null; resolution_note: string | null }[]>`
      select id, site_id, level, title, detail, dedupe_key, created_at, resolved_at, resolved_by, resolution_note
      from alerts ${siteId ? q`where site_id = ${siteId}` : q``}
      order by created_at desc limit 200`;
    return rows.map((r) => ({
      id: r.id, siteId: r.site_id, level: r.level, title: r.title, detail: r.detail ?? "", dedupeKey: r.dedupe_key,
      createdAt: r.created_at.getTime(), resolvedAt: ms(r.resolved_at), resolvedBy: opt(r.resolved_by), resolutionNote: opt(r.resolution_note),
    }));
  },
  async raiseAlert(a) {
    const q = sql();
    await q`insert into alerts (site_id, level, title, detail, dedupe_key)
            values (${a.siteId}, ${a.level}, ${a.title}, ${a.detail}, ${a.dedupeKey})
            on conflict (dedupe_key) where resolved_at is null do nothing`;
  },
  async resolveAlert(id, personId, note) {
    if (!isUuid(id)) return;
    const q = sql();
    await q`update alerts set resolved_at = now(), resolved_by = ${personId}, resolution_note = ${note}
            where id = ${id} and resolved_at is null`;
  },

  async recordsData(siteId, from, to) {
    const q = sql();
    const lists = await loadChecklists(q`t.site_id = ${siteId}`);
    const runs = await q<{ list_id: string; d: string; signed_at: Date | null; signed_by_name: string | null; total: number; answered: number }[]>`
      select r.template_id as list_id, to_char(r.business_date, 'YYYY-MM-DD') as d, r.signed_at, p.display_name as signed_by_name,
        (select count(*)::int from checklist_items i where i.version_id = r.version_id) as total,
        (select count(*)::int from (select distinct on (a.item_id) a.outcome from run_answers a where a.run_id = r.id
                                    order by a.item_id, a.captured_at desc, a.synced_at desc) x where x.outcome <> 'cleared') as answered
      from checklist_runs r left join people p on p.id = r.signed_by
      where r.site_id = ${siteId} and r.business_date between ${from} and ${to}`;
    const answers = await q<{ list_id: string; list_name: string; d: string; item_id: string; item_text: string; answer_type: RawAnswer["itemType"]; rule_code: string | null;
      value: string | null; outcome: string; by_name: string; captured_at: Date; action: string | null; action_by: string | null }[]>`
      select r.template_id as list_id, t.name as list_name, to_char(r.business_date, 'YYYY-MM-DD') as d, a.item_id, i.text as item_text, i.answer_type, i.rule_code,
        a.value, a.outcome, p.display_name as by_name, a.captured_at, c.action, cp.display_name as action_by
      from run_answers a
        join checklist_runs r on r.id = a.run_id
        join checklist_templates t on t.id = r.template_id
        join checklist_items i on i.id = a.item_id
        join people p on p.id = a.recorded_by
        left join lateral (select c.action, c.recorded_by from corrective_actions c where c.answer_id = a.id order by c.recorded_at desc limit 1) c on true
        left join people cp on cp.id = c.recorded_by
      where r.site_id = ${siteId} and r.business_date between ${from} and ${to}
      order by a.captured_at, a.synced_at`;
    const alerts = await q<{ id: string; site_id: SiteId; level: Alert["level"]; title: string; detail: string | null; dedupe_key: string; created_at: Date; resolved_at: Date | null; resolved_by: string | null; resolution_note: string | null; resolved_by_name: string | null }[]>`
      select a.id, a.site_id, a.level, a.title, a.detail, a.dedupe_key, a.created_at, a.resolved_at, a.resolved_by, a.resolution_note, p.display_name as resolved_by_name
      from alerts a left join people p on p.id = a.resolved_by
      where a.site_id = ${siteId} and a.created_at >= ${new Date(londonToUtc(from, "00:00"))} and a.created_at < ${new Date(londonToUtc(addDays(to, 1), "00:00"))}
      order by a.created_at`;
    const [first] = await q<{ d: string | null }[]>`select to_char(min(business_date), 'YYYY-MM-DD') as d from checklist_runs where site_id = ${siteId}`;
    return {
      lists: lists.map((l) => ({ id: l.id, name: l.name, area: l.area, due: l.due })),
      runs: runs.map((r) => ({ listId: r.list_id, date: r.d, signedAt: ms(r.signed_at), signedByName: opt(r.signed_by_name), total: r.total, answered: r.answered })),
      answers: answers.map((a) => ({
        listId: a.list_id, listName: a.list_name, date: a.d, itemId: a.item_id, itemText: a.item_text, itemType: a.answer_type, ruleCode: opt(a.rule_code),
        value: a.value ?? "", outcome: fromDbOutcome(a.outcome), byName: a.by_name, at: a.captured_at.getTime(), action: opt(a.action), actionByName: opt(a.action_by),
      })),
      alerts: alerts.map((r) => ({
        id: r.id, siteId: r.site_id, level: r.level, title: r.title, detail: r.detail ?? "", dedupeKey: r.dedupe_key, createdAt: r.created_at.getTime(),
        resolvedAt: ms(r.resolved_at), resolvedBy: opt(r.resolved_by), resolutionNote: opt(r.resolution_note), resolvedByName: opt(r.resolved_by_name),
      })),
      trackingFrom: first?.d ?? undefined,
    };
  },

  async handover(siteId, createdSince = Date.now() - 7 * 86_400_000) {
    const q = sql();
    const rows = await q<{ id: string; site_id: SiteId; category: string; body: string; needs_action: boolean; created_by: string; created_by_name: string | null; created_at: Date; closed_at: Date | null; closed_by: string | null; closed_by_name: string | null;
      assigned_to: string | null; assigned_to_name: string | null; assigned_by: string | null; assigned_by_name: string | null; assigned_at: Date | null }[]>`
      select h.id, h.site_id, h.category, h.body, h.needs_action, h.created_by, p.display_name as created_by_name,
             h.created_at, h.closed_at, h.closed_by, c.display_name as closed_by_name,
             h.assigned_to, a.display_name as assigned_to_name, h.assigned_by, ab.display_name as assigned_by_name, h.assigned_at
      from handover_items h left join people p on p.id = h.created_by left join people c on c.id = h.closed_by
        left join people a on a.id = h.assigned_to left join people ab on ab.id = h.assigned_by
      where h.site_id = ${siteId} and (h.closed_at is null or h.created_at >= ${new Date(createdSince)})
      order by h.created_at desc`;
    return rows.map((r): HandoverItem => ({
      id: r.id, siteId: r.site_id, category: r.category, body: r.body, needsAction: r.needs_action,
      createdBy: r.created_by, createdByName: r.created_by_name ?? "", createdAt: r.created_at.getTime(),
      closedAt: ms(r.closed_at), closedBy: opt(r.closed_by), closedByName: opt(r.closed_by_name),
      assignedTo: opt(r.assigned_to), assignedToName: opt(r.assigned_to_name), assignedBy: opt(r.assigned_by), assignedByName: opt(r.assigned_by_name), assignedAt: ms(r.assigned_at),
    }));
  },
  async addHandover(h) {
    const q = sql();
    // Only a note that needs doing is for someone (the action checks they work at the site).
    const to = h.assignedTo && isUuid(h.assignedTo) && h.needsAction ? h.assignedTo : null;
    await q`insert into handover_items (site_id, category, body, needs_action, created_by, assigned_to, assigned_by, assigned_at)
            values (${h.siteId}, ${h.category}, ${h.body}, ${h.needsAction}, ${h.createdBy}, ${to}, ${to ? h.createdBy : null}, ${to ? q`now()` : null})`;
  },
  async assignHandover(target, siteId, to, byId) {
    if (!isUuid(target.id) || (to !== null && !isUuid(to))) return false;
    const q = sql();
    const ok = to === null ? q`true` : givable(q, to, siteId);
    const rows = target.kind === "prep"
      ? await q`update prep_entries e set assigned_to = ${to}, assigned_by = ${byId}, assigned_at = now()
                from prep_handovers h
                where e.id = ${target.id} and e.site_id = ${siteId} and e.status = 'outstanding' and e.assigned_to is distinct from ${to}::uuid
                  and h.id = e.handover_id and h.status = 'submitted' and ${ok}
                returning e.id`
      : await q`update handover_items set assigned_to = ${to}, assigned_by = ${byId}, assigned_at = now()
                where id = ${target.id} and site_id = ${siteId} and closed_at is null and needs_action
                  and assigned_to is distinct from ${to}::uuid and ${ok}
                returning id`;
    return rows.length > 0;
  },
  async closeHandover(id, siteId, personId) {
    if (!isUuid(id)) return false;
    const q = sql();
    const r = await q`update handover_items set closed_at = now(), closed_by = ${personId}
                      where id = ${id} and site_id = ${siteId} and closed_at is null returning id`;
    return r.length > 0;
  },
  async reopenHandover(id, siteId) {
    if (!isUuid(id)) return false;
    const q = sql();
    const r = await q`update handover_items set closed_at = null, closed_by = null
                      where id = ${id} and site_id = ${siteId} and closed_at is not null returning id`;
    return r.length > 0;
  },

  async prepItems() {
    const q = sql();
    const rows = await q<{ id: string; name: string; kind: PrepKind; grp: string; position: number; active: boolean }[]>`
      select id, name, kind, grp, position, active from prep_items order by position`;
    return rows.map((r): PrepItem => ({ id: r.id, name: r.name, kind: r.kind, group: r.grp, position: r.position, active: r.active }));
  },
  async addPrepItem(item, byId) {
    return withTx(async (tx) => {
      // One at a time, so two people adding at once get different ids and places.
      await tx`lock table prep_items in share row exclusive mode`;
      const [{ n, pos }] = await tx<{ n: number; pos: number }[]>`
        select coalesce(max(substring(id from 4)::int) filter (where id ~ '^kp-[0-9]+$'), 0) + 1 as n, coalesce(max(position), 0) + 1 as pos from prep_items`;
      const id = `kp-${String(n).padStart(3, "0")}`;
      await tx`insert into prep_items (id, name, kind, grp, position, created_by) values (${id}, ${item.name}, ${item.kind}, ${item.group}, ${pos}, ${byId})`;
      return id;
    });
  },
  async updatePrepItem(id, item, byId) {
    const q = sql();
    const r = await q`
      update prep_items set name = ${item.name}, kind = ${item.kind}, grp = ${item.group}, updated_at = now(), updated_by = ${byId},
        position = case when kind = ${item.kind} and grp = ${item.group} then position else (select max(position) + 1 from prep_items) end
      where id = ${id} returning id`;
    return r.length > 0;
  },
  async swapPrepItems(a, b, byId) {
    return withTx(async (tx) => {
      const rows = await tx<{ id: string; kind: string; grp: string; position: number }[]>`
        select id, kind, grp, position from prep_items where id in (${a}, ${b}) for update`;
      const [x, y] = [rows.find((r) => r.id === a), rows.find((r) => r.id === b)];
      if (!x || !y || a === b || x.kind !== y.kind || x.grp !== y.grp) return false;
      await tx`update prep_items set position = ${y.position}, updated_at = now(), updated_by = ${byId} where id = ${a}`;
      await tx`update prep_items set position = ${x.position}, updated_at = now(), updated_by = ${byId} where id = ${b}`;
      return true;
    });
  },
  async setPrepItemActive(id, active, byId) {
    const q = sql();
    const r = await q`
      update prep_items set active = ${active}, retired_at = ${active ? null : q`now()`}, retired_by = ${active ? null : byId}, updated_at = now(), updated_by = ${byId}
      where id = ${id} and active <> ${active} returning id`;
    return r.length > 0;
  },
  async prepEnabledSites() {
    const q = sql();
    return (await q<{ site_id: SiteId }[]>`select site_id from prep_sites order by site_id`).map((r) => r.site_id);
  },
  async prepDraft(siteId) {
    const q = sql();
    return (await prepHandoversWhere(q`h.site_id = ${siteId} and h.status = 'draft'`, 1))[0];
  },
  async prepEditDraft(siteId, personId, change) {
    await withTx(async (tx) => {
      await tx`insert into prep_handovers (site_id, shift, created_by) values (${siteId}, ${change.shift ?? "next"}, ${personId})
               on conflict (site_id) where status = 'draft' do nothing`;
      const [h] = await tx<{ id: string }[]>`
        update prep_handovers set updated_at = now() ${change.shift ? tx`, shift = ${change.shift}` : tx``}
        where site_id = ${siteId} and status = 'draft' returning id`;
      if (!h || !change.itemId) return;
      if (change.needed === false) {
        await tx`delete from prep_entries where handover_id = ${h.id} and item_id = ${change.itemId}`;
        return;
      }
      await tx`insert into prep_entries (handover_id, site_id, item_id, created_by) values (${h.id}, ${siteId}, ${change.itemId}, ${personId})
               on conflict (handover_id, item_id) do nothing`;
      if (change.urgent !== undefined) await tx`update prep_entries set urgent = ${change.urgent} where handover_id = ${h.id} and item_id = ${change.itemId}`;
      if (change.note !== undefined) await tx`update prep_entries set note = ${change.note || null} where handover_id = ${h.id} and item_id = ${change.itemId}`;
      const to = change.assignee;
      if (to !== undefined && (to === null || isUuid(to))) {
        await tx`update prep_entries set assigned_to = ${to}, assigned_by = ${personId}, assigned_at = now()
                 where handover_id = ${h.id} and item_id = ${change.itemId} and assigned_to is distinct from ${to}::uuid
                   and ${to === null ? tx`true` : givable(tx, to, siteId)}`;
      }
    });
  },
  async prepOutstanding(siteId) {
    const q = sql();
    const rows = await q<PrepEntryRow[]>`
      select e.*, c.display_name as created_by_name, null as completed_by_name, a.display_name as assigned_to_name, ab.display_name as assigned_by_name
      from prep_entries e join prep_handovers h on h.id = e.handover_id join people c on c.id = e.created_by
        left join people a on a.id = e.assigned_to left join people ab on ab.id = e.assigned_by
      where e.site_id = ${siteId} and e.status = 'outstanding' and h.status = 'submitted'`;
    return rows.map(toPrepEntry);
  },
  async prepSubmit(siteId, personId, makePlan) {
    return withTx(async (tx) => {
      const [h] = await tx<{ id: string }[]>`select id from prep_handovers where site_id = ${siteId} and status = 'draft' for update`;
      if (!h) return undefined;
      const draft = (await tx<PrepEntryRow[]>`select * from prep_entries where handover_id = ${h.id}`).map(toPrepEntry);
      const outstanding = (await tx<PrepEntryRow[]>`
        select e.* from prep_entries e join prep_handovers ph on ph.id = e.handover_id
        where e.site_id = ${siteId} and e.status = 'outstanding' and ph.status = 'submitted' for update of e`).map(toPrepEntry);
      const active = (await tx<{ id: string }[]>`select id from prep_items where active`).map((r) => r.id);
      const plan = makePlan(draft, outstanding, active);
      // A carried item stays with whoever it was for, keeping who said so and when.
      const forOf = (x: { assignedTo?: string; assignedBy?: string; assignedAt?: number }) =>
        [x.assignedBy ? x.assignedTo ?? null : null, x.assignedBy ?? null, x.assignedBy && x.assignedAt ? new Date(x.assignedAt) : null] as const;
      for (const c of plan.carryIn) {
        const [to, by, at] = forOf(c);
        await tx`insert into prep_entries (handover_id, site_id, item_id, urgent, note, carried_from, created_by, assigned_to, assigned_by, assigned_at)
                 values (${h.id}, ${siteId}, ${c.itemId}, ${c.urgent}, ${c.note ?? null}, ${c.from}, ${personId}, ${to}, ${by}, ${at})`;
      }
      for (const m of plan.merge) {
        const [to, by, at] = forOf(m);
        await tx`update prep_entries set carried_from = ${m.from}, urgent = ${m.urgent}, note = ${m.note ?? null},
                   assigned_to = ${to}, assigned_by = ${by}, assigned_at = ${at} where id = ${m.entryId}`;
      }
      if (plan.markCarried.length) await tx`update prep_entries set status = 'carried' where id = any(${plan.markCarried}::uuid[]) and status = 'outstanding'`;
      await tx`update prep_handovers set status = 'submitted', submitted_by = ${personId}, submitted_at = now(), updated_at = now(),
               stocked_count = ${plan.stockedCount} where id = ${h.id}`;
      return { handoverId: h.id, plan };
    });
  },
  async prepHandover(id) {
    if (!isUuid(id)) return undefined;
    const q = sql();
    return (await prepHandoversWhere(q`h.id = ${id}`, 1))[0];
  },
  async prepHandovers(siteId, limit) {
    const q = sql();
    return prepHandoversWhere(q`h.site_id = ${siteId} and h.status = 'submitted'`, limit);
  },
  async prepSetDone(entryId, siteId, personId, done) {
    if (!isUuid(entryId)) return false;
    const q = sql();
    const rows = done
      ? await q`update prep_entries e set status = 'completed', completed_by = ${personId}, completed_at = now()
                from prep_handovers h where e.id = ${entryId} and e.site_id = ${siteId} and e.status = 'outstanding'
                and h.id = e.handover_id and h.status = 'submitted' returning e.id`
      : await q`update prep_entries set status = 'outstanding', completed_by = null, completed_at = null
                where id = ${entryId} and site_id = ${siteId} and status = 'completed' returning id`;
    return rows.length > 0;
  },

  // ---------- team notices ----------
  async teamNotices(recentEnded = 10) {
    const q = sql();
    const today = londonDate(Date.now());
    const rows = await q<{ id: string; site_id: SiteId | null; sections: Area[]; title: string; body: string; important: boolean; created_by: string; created_by_name: string;
      created_at: Date; show_until: string | null; ended_at: Date | null; reads: { person_id: string; read_at: string }[] | null }[]>`
      select a.id, a.site_id, a.sections, a.title, a.body, a.important, a.created_by, p.display_name as created_by_name, a.created_at,
        to_char(a.show_until, 'YYYY-MM-DD') as show_until, a.ended_at,
        (select json_agg(json_build_object('person_id', r.person_id, 'read_at', r.read_at)) from announcement_reads r where r.announcement_id = a.id) as reads
      from announcements a join people p on p.id = a.created_by
      where (a.ended_at is null and (a.show_until is null or a.show_until >= ${today}))
         or a.id in (select id from announcements where ended_at is not null or show_until < ${today} order by created_at desc limit ${recentEnded})
      order by a.created_at desc`;
    return rows.map((r): TeamNotice => ({
      id: r.id, siteId: opt(r.site_id), sections: r.sections, title: r.title, body: r.body, important: r.important,
      createdBy: r.created_by, createdByName: r.created_by_name, createdAt: r.created_at.getTime(), showUntil: opt(r.show_until), endedAt: ms(r.ended_at),
      reads: (r.reads ?? []).map((x) => ({ personId: x.person_id, readAt: new Date(x.read_at).getTime() })),
    }));
  },
  async addTeamNotice(n) {
    const q = sql();
    const [r] = await q<{ id: string }[]>`
      insert into announcements (site_id, sections, title, body, important, created_by, show_until)
      values (${n.siteId ?? null}, ${n.sections}, ${n.title}, ${n.body}, ${n.important}, ${n.createdBy}, ${n.showUntil ?? null}) returning id`;
    return r.id;
  },
  async endTeamNotice(id, personId) {
    if (!isUuid(id)) return false;
    const q = sql();
    return (await q`update announcements set ended_at = now(), ended_by = ${personId} where id = ${id} and ended_at is null returning id`).length > 0;
  },
  async readTeamNotice(id, personId) {
    if (!isUuid(id)) return false;
    const q = sql();
    const [a] = await q`select id from announcements where id = ${id}`;
    if (!a) return false;
    await q`insert into announcement_reads (announcement_id, person_id) values (${id}, ${personId}) on conflict do nothing`;
    return true;
  },

  // ---------- time off ----------
  async timeOff(f) {
    const q = sql();
    if (f.personId && !isUuid(f.personId)) return [];
    const rows = await q<{ id: string; person_id: string; person_name: string; site_id: SiteId; starts_on: string; ends_on: string; kind: TimeOffKind; note: string | null;
      status: TimeOffStatus; created_at: Date; decided_by: string | null; decided_by_name: string | null; decided_at: Date | null; decision_note: string | null }[]>`
      select t.id, t.person_id, p.display_name as person_name, t.site_id, to_char(t.starts_on, 'YYYY-MM-DD') as starts_on, to_char(t.ends_on, 'YYYY-MM-DD') as ends_on,
        t.kind, t.note, t.status, t.created_at, t.decided_by, d.display_name as decided_by_name, t.decided_at, t.decision_note
      from time_off t join people p on p.id = t.person_id left join people d on d.id = t.decided_by
      where true
        ${f.personId ? q`and t.person_id = ${f.personId}` : q``}
        ${f.siteIds ? q`and t.site_id = any(${f.siteIds}::text[])` : q``}
        ${f.from ? q`and t.ends_on >= ${f.from}` : q``}
        ${f.to ? q`and t.starts_on <= ${f.to}` : q``}
        ${f.statuses ? q`and t.status = any(${f.statuses}::text[])` : q``}
      order by t.created_at desc limit 300`;
    return rows.map((r): TimeOff => ({
      id: r.id, personId: r.person_id, personName: r.person_name, siteId: r.site_id, startsOn: r.starts_on, endsOn: r.ends_on, kind: r.kind, note: opt(r.note),
      status: r.status, createdAt: r.created_at.getTime(), decidedBy: opt(r.decided_by), decidedByName: opt(r.decided_by_name), decidedAt: ms(r.decided_at), decisionNote: opt(r.decision_note),
    }));
  },
  async requestTimeOff(t) {
    const q = sql();
    const [r] = await q<{ id: string }[]>`
      insert into time_off (person_id, site_id, starts_on, ends_on, kind, note)
      values (${t.personId}, ${t.siteId}, ${t.startsOn}, ${t.endsOn}, ${t.kind}, ${t.note ?? null}) returning id`;
    return r.id;
  },
  async decideTimeOff(id, decision, personId, note) {
    if (!isUuid(id)) return false;
    const q = sql();
    return (await q`update time_off set status = ${decision}, decided_by = ${personId}, decided_at = now(), decision_note = ${note ?? null}
                    where id = ${id} and status = 'pending' returning id`).length > 0;
  },
  async cancelTimeOff(id, from) {
    if (!isUuid(id)) return false;
    const q = sql();
    return (await q`update time_off set status = 'cancelled', cancelled_at = now() where id = ${id} and status = ${from} returning id`).length > 0;
  },

  // ---------- staff certificates ----------
  async certificates(f = {}) {
    if (f.personIds && !f.personIds.every(isUuid)) return [];
    const q = sql();
    const rows = await q<CertRow[]>`
      ${certSelect(q)} where c.removed_at is null ${f.personIds ? q`and c.person_id = any(${f.personIds}::uuid[])` : q``}
      order by c.created_at`;
    return rows.map(certFrom);
  },
  async certificate(id) {
    if (!isUuid(id)) return undefined;
    const q = sql();
    const [r] = await q<CertRow[]>`${certSelect(q)} where c.id = ${id} and c.removed_at is null`;
    return r && certFrom(r);
  },
  async addCertificate(c) {
    const q = sql();
    const [r] = await q<{ id: string }[]>`
      insert into staff_certificates (person_id, kind, issued_on, expires_on, provider, reference, note, created_by)
      values (${c.personId}, ${c.kind}, ${c.issuedOn ?? null}, ${c.expiresOn ?? null}, ${c.provider ?? null}, ${c.reference ?? null}, ${c.note ?? null}, ${c.createdBy})
      returning id`;
    return r.id;
  },
  async removeCertificate(id, personId) {
    if (!isUuid(id)) return false;
    const q = sql();
    return (await q`update staff_certificates set removed_at = now(), removed_by = ${personId} where id = ${id} and removed_at is null returning id`).length > 0;
  },

  // ---------- equipment ----------
  async equipment(siteId, includeRetired = false) {
    const q = sql();
    const rows = await q<EqRow[]>`select * from equipment where site_id = ${siteId} ${includeRetired ? q`` : q`and retired_at is null`} order by lower(name)`;
    return rows.map(eqFrom);
  },
  async equipmentItem(id) {
    if (!isUuid(id)) return undefined;
    const q = sql();
    const [r] = await q<EqRow[]>`select * from equipment where id = ${id}`;
    return r && eqFrom(r);
  },
  async addEquipment(e) {
    const q = sql();
    const [r] = await q<{ id: string }[]>`
      insert into equipment (site_id, name, kind, location, make_model, serial, service_every_months, service_contact, instructions, created_by)
      values (${e.siteId}, ${e.name}, ${e.kind}, ${e.location ?? null}, ${e.makeModel ?? null}, ${e.serial ?? null}, ${e.serviceEveryMonths ?? null},
              ${e.serviceContact ?? null}, ${e.instructions ?? null}, ${e.createdBy}) returning id`;
    return r.id;
  },
  async updateEquipment(id, e) {
    if (!isUuid(id)) return false;
    const q = sql();
    return (await q`update equipment set name = ${e.name}, kind = ${e.kind}, location = ${e.location ?? null}, make_model = ${e.makeModel ?? null}, serial = ${e.serial ?? null},
                      service_every_months = ${e.serviceEveryMonths ?? null}, service_contact = ${e.serviceContact ?? null}, instructions = ${e.instructions ?? null}, updated_at = now()
                    where id = ${id} and retired_at is null returning id`).length > 0;
  },
  async retireEquipment(id, personId) {
    if (!isUuid(id)) return false;
    const q = sql();
    return (await q`update equipment set retired_at = now(), retired_by = ${personId} where id = ${id} and retired_at is null returning id`).length > 0;
  },
  async equipmentEvents(f) {
    if (f.equipmentId && !isUuid(f.equipmentId)) return [];
    const q = sql();
    const rows = await q<{ id: string; equipment_id: string; site_id: SiteId; kind: EventKind; fault_id: string | null; severity: Severity | null; body: string;
      done_on: string | null; created_by: string; created_by_name: string; created_at: Date }[]>`
      select e.id, e.equipment_id, e.site_id, e.kind, e.fault_id, e.severity, e.body, to_char(e.done_on, 'YYYY-MM-DD') as done_on,
        e.created_by, p.display_name as created_by_name, e.created_at
      from equipment_events e join people p on p.id = e.created_by
      where true
        ${f.equipmentId ? q`and e.equipment_id = ${f.equipmentId}` : q``}
        ${f.siteId ? q`and e.site_id = ${f.siteId}` : q``}
        ${f.since ? q`and e.created_at >= ${new Date(f.since)}` : q``}
        ${f.openFaultsOnly ? q`and ((e.kind = 'fault' and not exists (select 1 from equipment_events x where x.fault_id = e.id and x.kind = 'fixed'))
                                 or (e.kind = 'update' and not exists (select 1 from equipment_events x where x.fault_id = e.fault_id and x.kind = 'fixed')))` : q``}
      order by e.created_at`;
    return rows.map((r): EquipmentEvent => ({
      id: r.id, equipmentId: r.equipment_id, siteId: r.site_id, kind: r.kind, faultId: opt(r.fault_id), severity: opt(r.severity), body: r.body,
      doneOn: opt(r.done_on), createdBy: r.created_by, createdByName: r.created_by_name, createdAt: r.created_at.getTime(),
    }));
  },
  async addEquipmentEvent(e) {
    const q = sql();
    const rows = await q<{ id: string }[]>`
      insert into equipment_events (equipment_id, site_id, kind, fault_id, severity, body, done_on, created_by)
      values (${e.equipmentId}, ${e.siteId}, ${e.kind}, ${e.faultId ?? null}, ${e.severity ?? null}, ${e.body}, ${e.doneOn ?? null}, ${e.createdBy})
      on conflict (fault_id) where kind = 'fixed' do nothing returning id`;
    return rows[0]?.id;
  },

  // ---------- tasks ----------
  async tasks(f) {
    if (!f.siteIds.length) return [];
    const q = sql();
    const rows = await q<TaskRow[]>`
      ${taskSelect(q)} where t.site_id = any(${f.siteIds}::text[])
        ${f.statuses ? q`and t.status = any(${f.statuses}::text[])`
          : f.closedSince !== undefined ? q`and (t.status = 'open' or t.done_at >= ${new Date(f.closedSince)} or t.cancelled_at >= ${new Date(f.closedSince)})`
          : q`and t.status = 'open'`}
      order by t.created_at desc limit 500`;
    return rows.map(taskFrom);
  },
  async task(id) {
    if (!isUuid(id)) return undefined;
    const q = sql();
    const [r] = await q<TaskRow[]>`${taskSelect(q)} where t.id = ${id}`;
    return r && taskFrom(r);
  },
  async addTask(t) {
    const q = sql();
    const [r] = await q<{ id: string }[]>`
      insert into tasks (site_id, title, detail, priority, category, assignee_id, section, due_on, created_by)
      values (${t.siteId}, ${t.title}, ${t.detail ?? null}, ${t.priority}, ${t.category}, ${t.assigneeId ?? null}, ${t.section ?? null}, ${t.dueOn ?? null}, ${t.createdBy})
      returning id`;
    return r.id;
  },
  async completeTask(id, personId, note) {
    if (!isUuid(id)) return false;
    const q = sql();
    return (await q`update tasks set status = 'done', done_by = ${personId}, done_at = now(), done_note = ${note ?? null}
                    where id = ${id} and status = 'open' returning id`).length > 0;
  },
  async reopenTask(id, personId) {
    if (!isUuid(id)) return false;
    const q = sql();
    return (await q`update tasks set status = 'open', done_by = null, done_at = null, done_note = null
                    where id = ${id} and status = 'done' and done_by = ${personId} returning id`).length > 0;
  },
  async cancelTask(id, personId) {
    if (!isUuid(id)) return false;
    const q = sql();
    return (await q`update tasks set status = 'cancelled', cancelled_by = ${personId}, cancelled_at = now() where id = ${id} and status = 'open' returning id`).length > 0;
  },

  // ---------- rota ----------
  async rotaSources() {
    const q = sql();
    const rows = await q<{ site_id: SiteId; created_at: Date; last_import_at: Date | null; last_result: RotaResult | null }[]>`
      select site_id, created_at, last_import_at, last_result from rota_sources`;
    return rows.map((r) => ({ siteId: r.site_id, createdAt: r.created_at.getTime(), lastImportAt: ms(r.last_import_at), lastResult: opt(r.last_result) }));
  },
  async rotaSourceByToken(tokenHash) {
    const q = sql();
    const [r] = await q<{ site_id: SiteId }[]>`select site_id from rota_sources where token_hash = ${tokenHash}`;
    return r?.site_id;
  },
  async setRotaToken(siteId, tokenHash, createdBy) {
    const q = sql();
    await q`insert into rota_sources (site_id, token_hash, created_by) values (${siteId}, ${tokenHash}, ${createdBy})
            on conflict (site_id) do update set token_hash = excluded.token_hash, created_by = excluded.created_by, created_at = now()`;
  },
  async recordRotaImport(siteId, result) {
    const q = sql();
    await q`update rota_sources set last_import_at = now(), last_result = ${q.json(result as unknown as postgres.JSONValue)} where site_id = ${siteId}`;
  },
  async weekStatuses(siteId) {
    const q = sql();
    const rows = await q<{ week: string; status: WeekStatus }[]>`select to_char(week_start, 'YYYY-MM-DD') as week, status from rota_weeks where site_id = ${siteId}`;
    return new Map(rows.map((r) => [r.week, r.status]));
  },
  async setWeekStatuses(siteId, statuses) {
    if (!statuses.size) return;
    await withTx(async (tx) => {
      for (const [week, status] of Array.from(statuses.entries())) {
        await tx`insert into rota_weeks (site_id, week_start, status) values (${siteId}, ${week}, ${status})
                 on conflict (site_id, week_start) do update set status = excluded.status, imported_at = now()`;
      }
    });
  },
  async siteShifts(siteId) {
    const q = sql();
    const rows = await q<{ source_key: string; staff_code: string; section: string; week: string; starts_at: Date; ends_at: Date; cancelled_at: Date | null; paid_hours: string | null }[]>`
      select s.source_key, p.staff_code, s.section, to_char(s.week_start, 'YYYY-MM-DD') as week, s.starts_at, s.ends_at, s.cancelled_at, s.paid_hours
      from shifts s join people p on p.id = s.person_id where s.site_id = ${siteId}`;
    return rows.map((r): StoredShift => {
      const date = londonDate(r.starts_at.getTime());
      const start = londonHM(r.starts_at.getTime()), end = londonHM(r.ends_at.getTime());
      return { sourceKey: r.source_key, staffCode: r.staff_code, section: r.section, week: r.week, date, start, end, endsNextDay: end <= start, hours: num(r.paid_hours), cancelled: !!r.cancelled_at };
    });
  },
  async applyShiftSync(siteId, plan, personIdByCode) {
    const times = (s: { date: string; start: string; end: string; endsNextDay: boolean }) => ({
      starts: new Date(londonToUtc(s.date, s.start)),
      ends: new Date(londonToUtc(s.endsNextDay ? addDays(s.date, 1) : s.date, s.end)),
    });
    await withTx(async (tx) => {
      for (const s of [...plan.added, ...plan.changed.map((c) => c.after)]) {
        const personId = personIdByCode.get(s.staffCode);
        if (!personId) continue;
        const t = times(s);
        await tx`
          insert into shifts (site_id, person_id, section, starts_at, ends_at, source_key, week_start, paid_hours)
          values (${siteId}, ${personId}, ${s.section}, ${t.starts}, ${t.ends}, ${s.sourceKey}, ${s.week}, ${s.hours ?? null})
          on conflict (source_key) do update set person_id = excluded.person_id, section = excluded.section,
            starts_at = excluded.starts_at, ends_at = excluded.ends_at, week_start = excluded.week_start,
            paid_hours = coalesce(excluded.paid_hours, shifts.paid_hours), changed_at = now(), cancelled_at = null`;
      }
      for (const s of plan.cancelled) {
        await tx`update shifts set cancelled_at = now(), changed_at = now() where source_key = ${s.sourceKey} and cancelled_at is null`;
      }
    });
  },
  async teamShifts(siteId, week) {
    const q = sql();
    const rows = await q<{ person_id: string; name: string; section: string; starts_at: Date; ends_at: Date; paid_hours: string | null }[]>`
      select s.person_id, p.display_name as name, s.section, s.starts_at, s.ends_at, s.paid_hours
      from shifts s join people p on p.id = s.person_id
      where s.site_id = ${siteId} and s.week_start = ${week} and s.cancelled_at is null`;
    return rows.map((r) => ({
      personId: r.person_id, name: r.name, section: r.section, date: londonDate(r.starts_at.getTime()),
      start: londonHM(r.starts_at.getTime()), end: londonHM(r.ends_at.getTime()), hours: num(r.paid_hours),
    }));
  },
  async shiftsForPerson(personId, fromDate, toDate) {
    if (!isUuid(personId)) return [];
    const q = sql();
    const rows = await q<{ id: string; site_id: SiteId; site_name: string; section: string; week: string; starts_at: Date; ends_at: Date; cancelled_at: Date | null; status: WeekStatus | null }[]>`
      select s.id, s.site_id, si.name as site_name, s.section, to_char(s.week_start, 'YYYY-MM-DD') as week, s.starts_at, s.ends_at, s.cancelled_at, w.status
      from shifts s join sites si on si.id = s.site_id
      left join rota_weeks w on w.site_id = s.site_id and w.week_start = s.week_start
      where s.person_id = ${personId}
        and s.starts_at >= ${new Date(londonToUtc(fromDate, "00:00"))} and s.starts_at < ${new Date(londonToUtc(addDays(toDate, 1), "00:00"))}
      order by s.starts_at`;
    return rows.map((r): ShiftView => ({
      id: r.id, siteId: r.site_id, siteName: r.site_name, section: r.section, week: r.week,
      date: londonDate(r.starts_at.getTime()), start: londonHM(r.starts_at.getTime()), end: londonHM(r.ends_at.getTime()),
      published: r.status === "published", cancelled: !!r.cancelled_at,
    }));
  },
  async shiftsOnDate(date, until = date) {
    const q = sql();
    const rows = await q<{ id: string; site_id: SiteId; site_name: string; section: string; week: string; starts_at: Date; ends_at: Date; person_id: string; staff_code: string }[]>`
      select s.id, s.site_id, si.name as site_name, s.section, to_char(s.week_start, 'YYYY-MM-DD') as week, s.starts_at, s.ends_at, s.person_id, p.staff_code
      from shifts s join sites si on si.id = s.site_id join people p on p.id = s.person_id
      join rota_weeks w on w.site_id = s.site_id and w.week_start = s.week_start and w.status = 'published'
      where s.cancelled_at is null and p.status = 'active' and si.status = 'open'
        and s.starts_at >= ${new Date(londonToUtc(date, "00:00"))} and s.starts_at < ${new Date(londonToUtc(addDays(until, 1), "00:00"))}`;
    return rows.map((r) => ({
      id: r.id, siteId: r.site_id, siteName: r.site_name, section: r.section, week: r.week,
      date: londonDate(r.starts_at.getTime()), start: londonHM(r.starts_at.getTime()), end: londonHM(r.ends_at.getTime()),
      published: true, cancelled: false, personId: r.person_id, staffCode: r.staff_code,
    }));
  },
  async shift(id) {
    if (!isUuid(id)) return undefined;
    const q = sql();
    const [r] = await q<{ id: string; site_id: SiteId; site_name: string; section: string; week: string; starts_at: Date; ends_at: Date; cancelled_at: Date | null; status: WeekStatus | null; person_id: string; staff_code: string }[]>`
      select s.id, s.site_id, si.name as site_name, s.section, to_char(s.week_start, 'YYYY-MM-DD') as week, s.starts_at, s.ends_at, s.cancelled_at, w.status, s.person_id, p.staff_code
      from shifts s join sites si on si.id = s.site_id join people p on p.id = s.person_id
      left join rota_weeks w on w.site_id = s.site_id and w.week_start = s.week_start
      where s.id = ${id}`;
    if (!r) return undefined;
    return {
      id: r.id, siteId: r.site_id, siteName: r.site_name, section: r.section, week: r.week,
      date: londonDate(r.starts_at.getTime()), start: londonHM(r.starts_at.getTime()), end: londonHM(r.ends_at.getTime()),
      published: r.status === "published", cancelled: !!r.cancelled_at, personId: r.person_id, staffCode: r.staff_code,
    };
  },

  async checklistsStartedOn(siteId) {
    const q = sql();
    const [first] = await q<{ d: string | null }[]>`select to_char(min(business_date), 'YYYY-MM-DD') as d from checklist_runs where site_id = ${siteId}`;
    return first?.d ?? undefined;
  },

  // ---------- library ----------
  async libraryDocs<K extends LibraryKind>(kind: K, opts?: { light?: boolean }) {
    const q = sql();
    const docs = await q<LibDocRow[]>`select id, kind, code, created_at, retired_at, retired_by, retired_note from library_docs where kind = ${kind} order by code`;
    return (await libDocsWith(q, docs, !!opts?.light)) as LibraryDoc<BodyOf<K>>[];
  },
  async libraryDoc(id) {
    if (!isUuid(id)) return undefined;
    const q = sql();
    const docs = await q<LibDocRow[]>`select id, kind, code, created_at, retired_at, retired_by, retired_note from library_docs where id = ${id}`;
    return (await libDocsWith(q, docs))[0];
  },
  async libraryVersions(docId) {
    if (!isUuid(docId)) return [];
    const q = sql();
    return (await q<LibVersionRow[]>`${libVersionSelect(q)} where v.doc_id = ${docId} order by v.created_at desc, v.id`).map(libVersionFrom);
  },
  async libraryVersion(id) {
    if (!isUuid(id)) return undefined;
    const q = sql();
    const [r] = await q<LibVersionRow[]>`${libVersionSelect(q)} where v.id = ${id}`;
    return r && libVersionFrom(r);
  },
  async createLibraryDoc(d) {
    return withTx(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('library_docs.code'))`; // one new code at a time
      const used = await tx<{ code: string }[]>`select code from library_docs where code like ${d.prefix + "%"}`;
      const code = nextCode(d.prefix, used.map((u) => u.code));
      const [doc] = await tx<{ id: string }[]>`insert into library_docs (kind, code, created_by) values (${d.kind}, ${code}, ${d.authorId}) returning id`;
      const [v] = await tx<{ id: string }[]>`insert into library_versions (doc_id, status, title, body, author_id, contributors)
        values (${doc.id}, 'draft', ${d.title}, ${tx.json(d.body as unknown as postgres.JSONValue)}, ${d.authorId}, ${[d.authorId]}::uuid[]) returning id`;
      return { docId: doc.id, versionId: v.id, code };
    });
  },
  async startLibraryDraft(docId, authorId) {
    if (!isUuid(docId)) return undefined;
    const q = sql();
    const [r] = await q<{ id: string }[]>`
      insert into library_versions (doc_id, status, title, body, author_id, contributors)
      select v.doc_id, 'draft', v.title, v.body, ${authorId}, ${[authorId]}::uuid[] from library_versions v join library_docs d on d.id = v.doc_id
      where v.doc_id = ${docId} and v.status = 'published' and d.retired_at is null
      on conflict (doc_id) where status in ('draft', 'in_review') do nothing returning id`;
    return r?.id;
  },
  async saveLibraryDraft(versionId, rev, d, personId) {
    if (!isUuid(versionId)) return undefined;
    const q = sql();
    const [r] = await q<{ rev: number }[]>`update library_versions set title = ${d.title}, body = ${q.json(d.body as unknown as postgres.JSONValue)}, updated_at = now(), rev = rev + 1,
        contributors = case when ${personId}::uuid = any(contributors) then contributors else array_append(contributors, ${personId}::uuid) end
      where id = ${versionId} and status = 'draft' and rev = ${rev} returning rev`;
    return r?.rev;
  },
  async moveLibraryVersion(versionId, move, personId, rev, note) {
    if (!isUuid(versionId)) return false;
    if (move === "discard") {
      return withTx(async (tx) => {
        // The document first, then its versions, as publishing and retiring do (so they never deadlock).
        const [ref] = await tx<{ doc_id: string }[]>`select doc_id from library_versions where id = ${versionId}`;
        if (!ref) return false;
        await tx`select id from library_docs where id = ${ref.doc_id} for update`;
        const [v] = await tx<{ doc_id: string }[]>`update library_versions set status = 'discarded', updated_at = now(), rev = rev + 1
          where id = ${versionId} and status = 'draft' and rev = ${rev} returning doc_id`;
        if (!v) return false;
        // The only draft of an SOP that was never published: the SOP goes with it (kept, retired).
        await tx`update library_docs set retired_at = now(), retired_by = ${personId}, retired_note = 'Draft discarded before it was published'
          where id = ${v.doc_id} and retired_at is null and not exists (select 1 from library_versions where doc_id = ${v.doc_id} and version is not null)`;
        return true;
      });
    }
    const q = sql();
    const r = move === "submit"
      ? await q`update library_versions set status = 'in_review', submitted_by = ${personId}, submitted_at = now(), review_note = null, reviewed_by = null, reviewed_at = null,
          updated_at = now(), rev = rev + 1, contributors = case when ${personId}::uuid = any(contributors) then contributors else array_append(contributors, ${personId}::uuid) end
          where id = ${versionId} and status = 'draft' and rev = ${rev} returning id`
      : move === "withdraw"
      ? await q`update library_versions set status = 'draft', submitted_by = null, submitted_at = null, updated_at = now(), rev = rev + 1
          where id = ${versionId} and status = 'in_review' and rev = ${rev} returning id`
      : await q`update library_versions set status = 'draft', submitted_by = null, submitted_at = null, review_note = ${note ?? null}, reviewed_by = ${personId}, reviewed_at = now(),
          updated_at = now(), rev = rev + 1 where id = ${versionId} and status = 'in_review' and rev = ${rev} returning id`;
    return r.length > 0;
  },
  async publishLibraryVersion(versionId, rev, p) {
    if (!isUuid(versionId)) return undefined;
    return withTx(async (tx) => {
      // The document first, then its versions, as discarding and retiring do (so they never deadlock).
      const [ref] = await tx<{ doc_id: string }[]>`select doc_id from library_versions where id = ${versionId}`;
      if (!ref) return undefined;
      const [doc] = await tx`select id from library_docs where id = ${ref.doc_id} and retired_at is null for update`;
      if (!doc) return undefined;
      const [v] = await tx<{ doc_id: string; author_id: string; submitted_by: string | null; contributors: string[] }[]>`
        select doc_id, author_id, submitted_by, contributors::text[] as contributors from library_versions
        where id = ${versionId} and status = 'in_review' and rev = ${rev} for update`;
      if (!v) return undefined;
      if (!p.ownerApproving && (v.author_id === p.approverId || v.submitted_by === p.approverId || v.contributors.includes(p.approverId))) return undefined;
      // A dish whose allergens are unchanged keeps the last change still to be confirmed (copied in the database, to the microsecond).
      const [prev] = await tx<{ id: string }[]>`select id from library_versions where doc_id = ${v.doc_id} and status = 'published'`;
      await tx`update library_versions set status = 'superseded', superseded_at = now() where doc_id = ${v.doc_id} and status = 'published'`;
      const [{ n }] = await tx<{ n: number }[]>`select coalesce(max(version), 0) + 1 as n from library_versions where doc_id = ${v.doc_id}`;
      await tx`update library_versions set status = 'published', version = ${n}, approved_by = ${p.approverId}, approved_at = now(), published_at = now(),
        change = ${p.change}, review_by = ${p.reviewBy}, updated_at = now(), rev = rev + 1,
        allergens_changed_at = case when ${p.allergens === "changed"} then now()
          when ${p.allergens === "same" && !!prev} then (select allergens_changed_at from library_versions where id = ${prev?.id ?? versionId}) else null end
        where id = ${versionId}`;
      await tx`insert into library_acks (version_id, person_id) values (${versionId}, ${p.approverId}) on conflict do nothing`;
      return Number(n);
    });
  },
  async retireLibraryDoc(docId, personId, note) {
    if (!isUuid(docId)) return false;
    return withTx(async (tx) => {
      const r = await tx`update library_docs set retired_at = now(), retired_by = ${personId}, retired_note = ${note} where id = ${docId} and retired_at is null returning id`;
      if (!r.length) return false;
      await tx`update library_versions set status = 'discarded', updated_at = now(), rev = rev + 1 where doc_id = ${docId} and status = 'draft'`;
      await tx`update library_versions set status = 'draft', updated_at = now(), rev = rev + 1 where doc_id = ${docId} and status = 'in_review'`;
      await tx`update library_versions set status = 'discarded', updated_at = now(), rev = rev + 1 where doc_id = ${docId} and status = 'draft'`;
      return true;
    });
  },
  async reinstateLibraryDoc(docId) {
    if (!isUuid(docId)) return false;
    const q = sql();
    return (await q`update library_docs set retired_at = null, retired_by = null, retired_note = null where id = ${docId} and retired_at is not null returning id`).length > 0;
  },
  async libraryAcks(f) {
    const ids = f.versionIds?.filter(isUuid);
    if ((ids && !ids.length) || (f.personId && !isUuid(f.personId)) || (f.docId && !isUuid(f.docId))) return [];
    const q = sql();
    const rows = await q<{ version_id: string; doc_id: string; person_id: string; acked_at: Date }[]>`
      select a.version_id, v.doc_id, a.person_id, a.acked_at from library_acks a join library_versions v on v.id = a.version_id where true
        ${ids ? q`and a.version_id = any(${ids}::uuid[])` : q``} ${f.personId ? q`and a.person_id = ${f.personId}` : q``} ${f.docId ? q`and v.doc_id = ${f.docId}` : q``}`;
    return rows.map((r) => ({ versionId: r.version_id, docId: r.doc_id, personId: r.person_id, at: r.acked_at.getTime() }));
  },
  async ackLibraryVersion(versionId, personId) {
    if (!isUuid(versionId) || !isUuid(personId)) return false;
    const q = sql();
    const r = await q`insert into library_acks (version_id, person_id)
      select ${versionId}, ${personId} where exists (select 1 from library_versions where id = ${versionId} and status = 'published')
      on conflict do nothing`;
    return r.count > 0;
  },

  // ---------- photos ----------
  async addMedia(m, cap) {
    if (!isUuid(m.createdBy)) return undefined;
    return withTx(async (tx) => {
      // One upload at a time per person, so the daily cap holds even for uploads sent together.
      await tx`select pg_advisory_xact_lock(hashtext(${"media:" + m.createdBy}))`;
      const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from media where created_by = ${m.createdBy} and created_at >= ${new Date(cap.since)}`;
      if (n >= cap.max) return undefined;
      const [r] = await tx<{ id: string }[]>`insert into media (mime, bytes, size, width, height, created_by)
        values ('image/jpeg', ${Buffer.from(m.bytes)}, ${m.bytes.byteLength}, ${m.width}, ${m.height}, ${m.createdBy}) returning id`;
      return r.id;
    });
  },
  async media(id) {
    if (!isUuid(id)) return undefined;
    const q = sql();
    const [r] = await q<{ mime: string; bytes: Buffer; erased: boolean }[]>`select mime, bytes, erased_at is not null as erased from media where id = ${id}`;
    return r && { mime: r.mime, bytes: new Uint8Array(r.bytes), erased: r.erased };
  },
  async mediaInfo(id) {
    if (!isUuid(id)) return undefined;
    const q = sql();
    const [r] = await q<{ mime: string; erased: boolean }[]>`select mime, erased_at is not null as erased from media where id = ${id}`;
    return r && { mime: r.mime, erased: r.erased };
  },
  async mediaStatus(ids) {
    const valid = Array.from(new Set(ids.filter(isUuid)));
    if (!valid.length) return new Map();
    const q = sql();
    const rows = await q<{ id: string; erased: boolean }[]>`select id, erased_at is not null as erased from media where id = any(${valid}::uuid[])`;
    return new Map(rows.map((r) => [r.id, { erased: r.erased }]));
  },
  async mediaCountSince(personId, since) {
    if (!isUuid(personId)) return 0;
    const q = sql();
    const [r] = await q<{ n: number }[]>`select count(*)::int as n from media where created_by = ${personId} and created_at >= ${new Date(since)}`;
    return r.n;
  },
  async eraseMedia(id, personId) {
    if (!isUuid(id)) return false;
    const q = sql();
    return (await q`update media set bytes = ''::bytea, size = 0, erased_at = now(), erased_by = ${personId} where id = ${id} and erased_at is null returning id`).length > 0;
  },
  async deleteUnusedMedia(before) {
    const q = sql();
    const r = await q`delete from media m where m.created_at < ${new Date(before)}
      and not exists (select 1 from library_versions v where v.status <> 'discarded' and strpos(v.body::text, m.id::text) > 0)`;
    return r.count;
  },

  // ---------- training ----------
  async trainingSkills() {
    const q = sql();
    return (await q<SkillRow[]>`
      select id, section, grp, position, title, about, hands_on, induction, links, video_url, refresher_months, pass_mark, created_at, updated_at, added_at,
        induction_from, refresher_from, refresher_was, link_since, rev, retired_at
      from training_skills order by case section when 'FOH' then 1 when 'BOH' then 2 else 3 end, position, title`).map(toSkill);
  },
  async trainingSkill(id) {
    if (!isUuid(id)) return undefined;
    const q = sql();
    const [r] = await q<SkillRow[]>`
      select id, section, grp, position, title, about, hands_on, induction, links, video_url, refresher_months, pass_mark, created_at, updated_at, added_at,
        induction_from, refresher_from, refresher_was, link_since, rev, retired_at
      from training_skills where id = ${id}`;
    return r ? toSkill(r) : undefined;
  },
  async createTrainingSkill(s, by) {
    return withTx(async (tx) => {
      await lockSkillOrder(tx);
      const [r] = await tx<{ id: string }[]>`
        insert into training_skills (section, grp, position, title, about, hands_on, induction, links, link_since, video_url, refresher_months, pass_mark, created_by)
        values (${s.section}, ${s.group}, (select coalesce(max(position), 0) + 1 from training_skills where section = ${s.section}), ${s.title}, ${s.about},
          ${s.handsOn}, ${s.induction}, ${s.links}::uuid[],
          (select coalesce(jsonb_object_agg(l::text, (extract(epoch from now()) * 1000)::bigint), '{}'::jsonb) from unnest(${s.links}::uuid[]) as l),
          ${s.videoUrl ?? null}, ${s.refresherMonths ?? null}, ${s.passMark}, ${by})
        returning id`;
      return r.id;
    });
  },
  async saveTrainingSkill(id, rev, s) {
    if (!isUuid(id)) return undefined;
    return withTx(async (tx) => {
      await lockSkillOrder(tx);
      // In SET, every column on the right is the value before the update. A new pathway puts it last there and counts as
      // joining it; becoming part of induction and a changed refresher are dated (with the refresher it had); a newly
      // linked document is dated, the others keep their dates.
      const refresher = s.refresherMonths ?? null;
      const [r] = await tx<{ rev: number }[]>`
        update training_skills set grp = ${s.group}, title = ${s.title}, about = ${s.about}, hands_on = ${s.handsOn}, induction = ${s.induction},
          links = ${s.links}::uuid[], video_url = ${s.videoUrl ?? null}, refresher_months = ${refresher}, pass_mark = ${s.passMark},
          position = case when section = ${s.section} then position
            else (select coalesce(max(o.position), 0) + 1 from training_skills o where o.section = ${s.section}) end,
          added_at = case when section = ${s.section} then added_at else now() end,
          induction_from = case when not induction and ${s.induction} then now() else induction_from end,
          refresher_from = case when refresher_months is distinct from ${refresher}::integer then now() else refresher_from end,
          refresher_was = case when refresher_months is distinct from ${refresher}::integer then refresher_months else refresher_was end,
          link_since = (select coalesce(jsonb_object_agg(l::text, coalesce(link_since -> (l::text), to_jsonb((extract(epoch from now()) * 1000)::bigint))), '{}'::jsonb)
            from unnest(${s.links}::uuid[]) as l),
          section = ${s.section}, updated_at = now(), rev = rev + 1
        where id = ${id} and rev = ${rev} and retired_at is null returning rev`;
      return r?.rev;
    });
  },
  async moveTrainingSkill(id, dir) {
    if (!isUuid(id)) return false;
    return withTx(async (tx) => {
      await lockSkillOrder(tx);
      const [me] = await tx<{ section: Area; position: number }[]>`select section, position from training_skills where id = ${id} and retired_at is null`;
      if (!me) return false;
      const [other] = await tx<{ id: string; position: number }[]>`
        select id, position from training_skills where section = ${me.section} and retired_at is null and id <> ${id}
          and ${dir < 0 ? tx`position < ${me.position}` : tx`position > ${me.position}`}
        order by ${dir < 0 ? tx`position desc` : tx`position asc`} limit 1`;
      if (!other) return false;
      await tx`update training_skills set position = ${other.position} where id = ${id}`;
      await tx`update training_skills set position = ${me.position} where id = ${other.id}`;
      return true;
    });
  },
  async retireTrainingSkill(id, by) {
    if (!isUuid(id)) return false;
    const q = sql();
    return (await q`update training_skills set retired_at = now(), retired_by = ${by}, rev = rev + 1 where id = ${id} and retired_at is null`).count === 1;
  },
  async reinstateTrainingSkill(id) {
    if (!isUuid(id)) return false;
    return withTx(async (tx) => {
      await lockSkillOrder(tx);
      // Back in everyone's training: it joins its pathway again now (deadlines run from then at the earliest).
      const r = await tx`update training_skills k set retired_at = null, retired_by = null, added_at = now(), rev = rev + 1,
          position = (select coalesce(max(o.position), 0) + 1 from training_skills o where o.section = k.section and o.retired_at is null)
        where k.id = ${id} and k.retired_at is not null`;
      return r.count === 1;
    });
  },
  async trainingQuestions(skillIds) {
    const q = sql();
    const ids = skillIds?.filter(isUuid);
    if (ids && !ids.length) return [];
    const rows = await q<QuestionRow[]>`
      select id, skill_id, position, text, options, answer, approved_at, created_at, updated_at from training_questions
      where retired_at is null ${ids ? q`and skill_id = any(${ids}::uuid[])` : q``}
      order by skill_id, position, created_at`;
    return rows.map(toQuestion);
  },
  async saveTrainingQuestion(x, by, approve) {
    if (!isUuid(x.skillId) || (x.id !== undefined && !isUuid(x.id))) return undefined;
    return withTx(async (tx) => {
      // The skill's row is locked so two new questions can't take the same place.
      const [skill] = await tx`select id from training_skills where id = ${x.skillId} and retired_at is null for update`;
      if (!skill) return undefined;
      const options = tx.json(x.options as unknown as postgres.JSONValue);
      if (x.id) {
        const [r] = await tx<{ id: string }[]>`update training_questions set text = ${x.text}, options = ${options}, answer = ${x.answer}, updated_at = now()
          where id = ${x.id} and skill_id = ${x.skillId} and retired_at is null returning id`;
        return r?.id;
      }
      const [r] = await tx<{ id: string }[]>`
        insert into training_questions (skill_id, position, text, options, answer, approved_by, approved_at, created_by)
        values (${x.skillId}, (select coalesce(max(position), 0) + 1 from training_questions where skill_id = ${x.skillId}), ${x.text}, ${options}, ${x.answer},
          ${approve ? by : null}, ${approve ? tx`now()` : null}, ${by})
        returning id`;
      return r.id;
    });
  },
  async approveTrainingQuestions(skillId, by) {
    if (!isUuid(skillId)) return 0;
    const q = sql();
    return (await q`update training_questions set approved_by = ${by}, approved_at = now()
      where skill_id = ${skillId} and approved_at is null and retired_at is null`).count;
  },
  async retireTrainingQuestion(id, by) {
    if (!isUuid(id)) return false;
    const q = sql();
    return (await q`update training_questions set retired_at = now(), retired_by = ${by} where id = ${id} and retired_at is null`).count === 1;
  },
  async trainingPathways() {
    const q = sql();
    const rows = await q<{ section: Area; induction_days: number; all_days: number; changed_at: Date | null; induction_was: number | null; all_was: number | null }[]>`
      select section, induction_days, all_days, changed_at, induction_was, all_was from training_pathways`;
    return rows.map((r): Pathway => ({
      section: r.section, inductionDays: r.induction_days, allDays: r.all_days, changedAt: ms(r.changed_at), inductionWas: opt(r.induction_was), allWas: opt(r.all_was),
    }));
  },
  async saveTrainingPathway(p, by) {
    const q = sql();
    // A change is dated, with the days it had before (training_pathways.* in DO UPDATE are the values before it).
    await q`insert into training_pathways (section, induction_days, all_days, updated_by, updated_at) values (${p.section}, ${p.inductionDays}, ${p.allDays}, ${by}, now())
      on conflict (section) do update set
        changed_at = case when (training_pathways.induction_days, training_pathways.all_days) <> (excluded.induction_days, excluded.all_days) then now() else training_pathways.changed_at end,
        induction_was = case when (training_pathways.induction_days, training_pathways.all_days) <> (excluded.induction_days, excluded.all_days) then training_pathways.induction_days else training_pathways.induction_was end,
        all_was = case when (training_pathways.induction_days, training_pathways.all_days) <> (excluded.induction_days, excluded.all_days) then training_pathways.all_days else training_pathways.all_was end,
        induction_days = excluded.induction_days, all_days = excluded.all_days, updated_by = excluded.updated_by, updated_at = now()`;
  },
  async trainingStarts(personIds) {
    const q = sql();
    const ids = personIds?.filter(isUuid);
    if (ids && !ids.length) return [];
    // The latest start in each section counts.
    const rows = await q<{ person_id: string; section: Area; started_on: string }[]>`
      select distinct on (person_id, section) person_id, section, started_on::text as started_on from training_starts
      ${ids ? q`where person_id = any(${ids}::uuid[])` : q``} order by person_id, section, started_on desc`;
    return rows.map((r) => ({ personId: r.person_id, section: r.section, startedOn: r.started_on }));
  },
  async addTrainingStarts(starts) {
    const rows = starts.filter((x) => isUuid(x.personId));
    if (!rows.length) return 0;
    const q = sql();
    return (await q`insert into training_starts (person_id, section, started_on)
      select * from unnest(${rows.map((x) => x.personId)}::uuid[], ${rows.map((x) => x.section)}::text[], ${rows.map((x) => x.startedOn)}::date[])
      on conflict do nothing`).count;
  },
  async trainingEvents(f) {
    const q = sql();
    const people = f.personIds?.filter(isUuid), skills = f.skillIds?.filter(isUuid);
    if ((people && !people.length) || (skills && !skills.length)) return [];
    const rows = await q<TrainingEventRow[]>`
      select e.id, e.person_id, e.skill_id, e.kind, e.at, e.by_id, b.display_name as by_name, e.score, e.passed, e.note
      from training_events e join people b on b.id = e.by_id
      where true ${people ? q`and e.person_id = any(${people}::uuid[])` : q``} ${skills ? q`and e.skill_id = any(${skills}::uuid[])` : q``}
      order by e.at, e.id`;
    return rows.map(toTrainingEvent);
  },
  async addTrainingEvent(e) {
    const q = sql();
    const [r] = await q<{ id: string }[]>`
      insert into training_events (person_id, skill_id, kind, by_id, score, passed, detail, note)
      values (${e.personId}, ${e.skillId}, ${e.kind}, ${e.byId}, ${e.score ?? null}, ${e.passed ?? null},
        ${e.detail === undefined ? null : q.json(e.detail as postgres.JSONValue)}, ${e.note ?? null})
      returning id`;
    return r.id;
  },
  async libraryMajorChanges(docIds) {
    const ids = docIds.filter(isUuid);
    if (!ids.length) return new Map();
    const q = sql();
    const rows = await q<{ doc_id: string; at: Date }[]>`
      select doc_id, max(published_at) as at from library_versions
      where doc_id = any(${ids}::uuid[]) and change = 'major' and status in ('published', 'superseded') group by doc_id`;
    return new Map(rows.map((r) => [r.doc_id, r.at.getTime()]));
  },

  // ---------- shift cover ----------
  async coverRequests(f) {
    if (f.personId && !isUuid(f.personId)) return [];
    const q = sql();
    const where = q`where true
      ${f.siteIds ? q`and c.site_id = any(${f.siteIds}::text[])` : q``}
      ${f.personId ? q`and c.person_id = ${f.personId}` : q``}
      ${f.shiftEndsAfter !== undefined ? q`and s.ends_at > ${new Date(f.shiftEndsAfter)}` : q``}
      ${f.live ? q`and c.status in ('open', 'approved')` : q``}`;
    return (await coverSelect(q, where)).map(coverFrom);
  },
  async coverRequest(id) {
    if (!isUuid(id)) return undefined;
    const q = sql();
    const [r] = await coverSelect(q, q`where c.id = ${id}`);
    return r ? coverFrom(r) : undefined;
  },
  async addCoverRequest(r) {
    const q = sql();
    const [row] = await q<{ id: string }[]>`
      insert into cover_requests (shift_id, site_id, person_id, section, note) values (${r.shiftId}, ${r.siteId}, ${r.personId}, ${r.section}, ${r.note ?? null})
      on conflict (shift_id) where status in ('open', 'approved') do nothing returning id`;
    return row?.id;
  },
  async decideCover(id, d) {
    if (!isUuid(id)) return false;
    const q = sql();
    if (d.status === "cancelled") {
      return (await q`update cover_requests set status = 'cancelled', cancelled_by = ${d.personId}, cancelled_at = now(), cancel_note = ${d.note ?? null}
        where id = ${id} and status = 'approved' returning id`).length > 0;
    }
    if (d.status === "withdrawn") {
      return (await q`update cover_requests set status = 'withdrawn', withdrawn_at = now() where id = ${id} and status = 'open' and person_id = ${d.personId} returning id`).length > 0;
    }
    if (d.status === "approved") {
      if (!d.coveredBy || !isUuid(d.coveredBy)) return false;
      return (await q`update cover_requests set status = 'approved', covered_by = ${d.coveredBy}, decided_by = ${d.personId}, decided_at = now(), decision_note = ${d.note ?? null}
        where id = ${id} and status = 'open'
          and exists (select 1 from cover_offers o where o.request_id = ${id} and o.person_id = ${d.coveredBy} and o.withdrawn_at is null)
        returning id`).length > 0;
    }
    return (await q`update cover_requests set status = 'declined', decided_by = ${d.personId}, decided_at = now(), decision_note = ${d.note ?? null}
      where id = ${id} and status = 'open' returning id`).length > 0;
  },
  async addCoverOffer(requestId, personId) {
    const q = sql();
    const [row] = await q<{ id: string }[]>`
      insert into cover_offers (request_id, person_id)
      select ${requestId}, ${personId} where exists (select 1 from cover_requests where id = ${requestId} and status = 'open')
      on conflict (request_id, person_id) where withdrawn_at is null do nothing returning id`;
    return row?.id;
  },
  async withdrawCoverOffer(requestId, personId) {
    if (!isUuid(requestId) || !isUuid(personId)) return undefined;
    const q = sql();
    const [row] = await q<{ id: string }[]>`update cover_offers set withdrawn_at = now()
      where request_id = ${requestId} and person_id = ${personId} and withdrawn_at is null
        and exists (select 1 from cover_requests c where c.id = ${requestId} and c.status = 'open') returning id`;
    return row?.id;
  },

  // ---------- gas off at close ----------
  async gasChecks(siteIds, from, to) {
    if (!siteIds.length) return [];
    const q = sql();
    const rows = await q<{ site_id: SiteId; business_date: string; person_id: string; name: string; on_tablet: boolean; created_at: Date }[]>`
      select g.site_id, to_char(g.business_date, 'YYYY-MM-DD') as business_date, g.person_id, p.display_name as name, g.on_tablet, g.created_at
      from gas_checks g join people p on p.id = g.person_id
      where g.site_id = any(${siteIds}::text[]) and g.business_date between ${from} and ${to} order by g.business_date`;
    return rows.map((r) => ({ siteId: r.site_id, date: r.business_date, personId: r.person_id, personName: r.name, onTablet: r.on_tablet, createdAt: r.created_at.getTime() }));
  },
  async addGasCheck(c) {
    const q = sql();
    const r = await q`insert into gas_checks (site_id, business_date, person_id, on_tablet) values (${c.siteId}, ${c.date}, ${c.personId}, ${c.onTablet})
                      on conflict (site_id, business_date) do nothing`;
    return r.count > 0;
  },

  // ---------- replies to shift reminders ----------
  async shiftReplies(shiftIds) {
    const ids = shiftIds.filter(isUuid);
    if (!ids.length) return [];
    const q = sql();
    const rows = await q<ReplyRow[]>`
      select id, shift_id, person_id, site_id, kind, late_minutes, created_at from shift_replies
      where shift_id = any(${ids}::uuid[]) order by created_at, id`;
    return rows.map(replyFrom);
  },
  async addShiftReply(r, isRepeat) {
    return withTx(async (tx) => {
      await tx`select id from shifts where id = ${r.shiftId} for update`; // one reply at a time per shift
      const [latest, before] = (await tx<ReplyRow[]>`
        select id, shift_id, person_id, site_id, kind, late_minutes, created_at from shift_replies
        where shift_id = ${r.shiftId} order by created_at desc, id desc limit 2`).map(replyFrom);
      if (latest && isRepeat(latest)) return { reply: latest, previous: before, added: false };
      const [row] = await tx<ReplyRow[]>`
        insert into shift_replies (shift_id, person_id, site_id, kind, late_minutes)
        values (${r.shiftId}, ${r.personId}, ${r.siteId}, ${r.kind}, ${r.lateMinutes ?? null})
        returning id, shift_id, person_id, site_id, kind, late_minutes, created_at`;
      return { reply: replyFrom(row), previous: latest, added: true };
    });
  },

  // ---------- messages and push ----------
  async queueNotice(n) {
    const q = sql();
    const r = await q`insert into notifications (person_id, kind, title, body, dedupe_key, send_after, url)
                      values (${n.personId}, ${n.kind}, ${n.title}, ${n.body}, ${n.dedupeKey ?? null}, ${new Date(n.sendAfter)}, ${n.url ?? null})
                      on conflict (dedupe_key) do nothing`;
    return r.count > 0;
  },
  async dueNotices(now, limit, personIds) {
    if (personIds && (!personIds.length || !personIds.every(isUuid))) return [];
    const q = sql();
    // Claim and mark in one statement; rows another sender has locked are skipped, not sent twice.
    const rows = await q<NoticeDbRow[]>`
      update notifications set sent_at = now()
      where id in (select id from notifications where sent_at is null and send_after <= ${new Date(now)}
                   ${personIds ? q`and person_id = any(${personIds}::uuid[])` : q``}
                   order by send_after limit ${limit} for update skip locked)
      returning id, person_id, kind, title, body, send_after, sent_at, created_at, url`;
    return rows.map(toNotice);
  },
  async noticeKeys(keys) {
    if (!keys.length) return new Map();
    const q = sql();
    const rows = await q<{ dedupe_key: string; created_at: Date }[]>`select dedupe_key, created_at from notifications where dedupe_key = any(${keys}::text[])`;
    return new Map(rows.map((r) => [r.dedupe_key, r.created_at.getTime()]));
  },
  async notices(personId, limit) {
    if (!isUuid(personId)) return [];
    const q = sql();
    const rows = await q<NoticeDbRow[]>`
      select id, person_id, kind, title, body, send_after, sent_at, created_at, url from notifications
      where person_id = ${personId} order by created_at desc limit ${limit}`;
    return rows.map(toNotice);
  },
  async savePushSub(sub) {
    const q = sql();
    await q`insert into push_subscriptions (person_id, endpoint, p256dh, auth) values (${sub.personId}, ${sub.endpoint}, ${sub.p256dh}, ${sub.auth})
            on conflict (endpoint) do update set person_id = excluded.person_id, p256dh = excluded.p256dh, auth = excluded.auth, failures = 0`;
  },
  async pushSubs(personId) {
    if (!isUuid(personId)) return [];
    const q = sql();
    const rows = await q<{ person_id: string; endpoint: string; p256dh: string; auth: string }[]>`
      select person_id, endpoint, p256dh, auth from push_subscriptions where person_id = ${personId}`;
    return rows.map((r) => ({ personId: r.person_id, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth }));
  },
  async peopleWithPush() {
    const q = sql();
    const rows = await q<{ person_id: string }[]>`select distinct person_id from push_subscriptions`;
    return new Set(rows.map((r) => r.person_id));
  },
  async dropPushSub(endpoint) {
    const q = sql();
    await q`delete from push_subscriptions where endpoint = ${endpoint}`;
  },
  async secret(key, make) {
    const q = sql();
    const [have] = await q<{ value: string }[]>`select value from app_secrets where key = ${key}`;
    if (have) return have.value;
    await q`insert into app_secrets (key, value) values (${key}, ${make()}) on conflict (key) do nothing`;
    const [r] = await q<{ value: string }[]>`select value from app_secrets where key = ${key}`;
    return r.value;
  },

  async audit(entry) {
    const q = sql();
    await q`insert into audit_log (actor_id, site_id, action, detail)
            values (${entry.actorId && isUuid(entry.actorId) ? entry.actorId : null}, ${entry.siteId ?? null}, ${entry.action},
                    ${q.json({ text: entry.detail })})`;
  },
  async auditLog(limit) {
    const q = sql();
    const rows = await q<{ at: Date; actor_id: string | null; site_id: SiteId | null; action: string; text: string | null }[]>`
      select at, actor_id, site_id, action, detail->>'text' as text from audit_log order by id desc limit ${limit}`;
    return rows.map((r): AuditEntry => ({ at: r.at.getTime(), actorId: opt(r.actor_id), siteId: opt(r.site_id), action: r.action, detail: r.text ?? "" }));
  },
};
