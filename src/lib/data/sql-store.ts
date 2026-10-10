import postgres from "postgres";
import type { Answer, Area, Checklist, Outcome, Person, Role, Site, SiteId, TempRule } from "@/lib/domain/types";
import type { Alert, AuditEntry, HandoverItem, NoticeRow, PrepEntryView, PrepHandover, Run, RotaResult, Session, SessionScope, ShiftView, Store } from "./store";
import type { PrepCategory, PrepEntry, PrepItem, PrepShift } from "@/lib/domain/prep";
import type { StoredShift, WeekStatus } from "@/lib/domain/rota";
import { addDays, londonDate, londonHM, londonToUtc } from "@/lib/domain/time";
import type { Device } from "@/lib/domain/devices";

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
    // prepare:false keeps it compatible with Supabase's transaction pooler (port 6543).
    g.__phocoSql = postgres(url, { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 10 });
  }
  return g.__phocoSql;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string) => UUID.test(s);
const ms = (d: Date | null | undefined) => (d ? d.getTime() : undefined);
const num = (v: string | null) => (v === null ? undefined : Number(v));
const opt = <T,>(v: T | null) => (v === null ? undefined : v);
// The database stores an un-ticked item as 'cleared'; the app calls it 'todo'.
const toDbOutcome = (o: Outcome) => (o === "todo" ? "cleared" : o);
const fromDbOutcome = (o: string): Outcome => (o === "cleared" ? "todo" : (o as Outcome));

interface PersonRow {
  id: string; staff_code: string; display_name: string; status: Person["status"]; frozen_reason: string | null;
  pin_hash: string | null; pin_failed: number; pin_locked_until: Date | null; pin_must_change: boolean;
  access: { site_id: SiteId; role: Role; sections: Area[] }[] | null;
}

function toPerson(r: PersonRow): Person {
  return {
    id: r.id, staffCode: r.staff_code, name: r.display_name, status: r.status, frozenReason: opt(r.frozen_reason),
    pinHash: opt(r.pin_hash), pinFailed: r.pin_failed, pinLockedUntil: ms(r.pin_locked_until), pinMustChange: r.pin_must_change,
    access: (r.access ?? []).map((a) => ({ siteId: a.site_id, role: a.role, sections: a.sections })),
  };
}

function toSite(r: { id: SiteId; name: string; kind: Site["kind"]; status: Site["status"]; closed_reason: string | null }): Site {
  return { id: r.id, name: r.name, kind: r.kind, status: r.status, closedReason: opt(r.closed_reason) };
}

async function selectPeople(where: postgres.PendingQuery<postgres.Row[]> | null): Promise<Person[]> {
  const q = sql();
  const rows = await q<PersonRow[]>`
    select p.id, p.staff_code, p.display_name, p.status, p.frozen_reason, p.pin_hash, p.pin_failed, p.pin_locked_until, p.pin_must_change,
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

interface NoticeDbRow { id: string; person_id: string; kind: NoticeRow["kind"]; title: string; body: string; send_after: Date; sent_at: Date | null; created_at: Date }
const toNotice = (r: NoticeDbRow): NoticeRow => ({ id: r.id, personId: r.person_id, kind: r.kind, title: r.title, body: r.body, sendAfter: r.send_after.getTime(), sentAt: ms(r.sent_at), createdAt: r.created_at.getTime() });

interface DeviceRow { id: string; site_id: SiteId; label: string; status: Device["status"]; last_seen: Date | null; created_at: Date }
const toDevice = (r: DeviceRow): Device => ({ id: r.id, siteId: r.site_id, label: r.label, status: r.status, lastSeen: ms(r.last_seen), createdAt: r.created_at.getTime() });

// ---------- kitchen prep ----------
interface PrepEntryRow {
  id: string; handover_id: string; site_id: SiteId; item_id: string; status: PrepEntry["status"]; urgent: boolean; note: string | null;
  carried_from: string | null; created_by: string; created_at: Date; completed_by: string | null; completed_at: Date | null;
  created_by_name?: string | null; completed_by_name?: string | null;
}
const toPrepEntry = (r: PrepEntryRow): PrepEntryView => ({
  id: r.id, handoverId: r.handover_id, siteId: r.site_id, itemId: r.item_id, status: r.status, urgent: r.urgent, note: opt(r.note),
  carriedFrom: opt(r.carried_from), createdBy: r.created_by, createdAt: r.created_at.getTime(), completedBy: opt(r.completed_by),
  completedAt: ms(r.completed_at), createdByName: r.created_by_name ?? "", completedByName: opt(r.completed_by_name ?? null),
});
interface PrepHandoverRow {
  id: string; site_id: SiteId; shift: PrepShift; status: "draft" | "submitted"; created_by: string; created_by_name: string | null;
  created_at: Date; updated_at: Date; submitted_by: string | null; submitted_by_name: string | null; submitted_at: Date | null; stocked_count: number | null;
}
async function prepEntriesOf(ids: string[]): Promise<PrepEntryView[]> {
  if (!ids.length) return [];
  const q = sql();
  const rows = await q<PrepEntryRow[]>`
    select e.*, c.display_name as created_by_name, d.display_name as completed_by_name
    from prep_entries e join people c on c.id = e.created_by left join people d on d.id = e.completed_by
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

export const sqlStore: Store = {
  async sites() {
    const q = sql();
    return (await q`select id, name, kind, status, closed_reason from sites order by case id when 'EAS' then 1 when 'WEM' then 2 else 3 end`)
      .map((r) => toSite(r as Parameters<typeof toSite>[0]));
  },
  async site(id) {
    const q = sql();
    const [r] = await q`select id, name, kind, status, closed_reason from sites where id = ${id}`;
    return r ? toSite(r as Parameters<typeof toSite>[0]) : undefined;
  },
  async setSiteStatus(id, status, reason) {
    const q = sql();
    if (status === "closed") await q`update sites set status = 'closed', closed_reason = ${reason ?? null}, closed_at = now() where id = ${id}`;
    else await q`update sites set status = 'open', closed_reason = null, closed_at = null, closed_by = null where id = ${id}`;
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
    const q = sql();
    await q`update people set ${q(cols as Record<string, postgres.ParameterOrJSON<never>>, ...keys)} where id = ${id}`;
  },

  async createPerson({ staffCode, name, pinHash, pinMustChange, access }) {
    return sql().begin(async (tx) => {
      const [p] = await tx<{ id: string }[]>`
        insert into people (staff_code, display_name, pin_hash, pin_must_change)
        values (${staffCode}, ${name}, ${pinHash}, ${pinMustChange}) returning id`;
      for (const a of access) {
        await tx`insert into person_sites (person_id, site_id, role, sections) values (${p.id}, ${a.siteId}, ${a.role}, ${a.sections})`;
      }
      return p.id;
    });
  },
  async setAccess(personId, access) {
    if (!isUuid(personId)) return;
    await sql().begin(async (tx) => {
      await tx`delete from person_sites where person_id = ${personId}`;
      for (const a of access) {
        await tx`insert into person_sites (person_id, site_id, role, sections) values (${personId}, ${a.siteId}, ${a.role}, ${a.sections})`;
      }
    });
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
    return sql().begin(async (tx) => {
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
    await sql().begin(async (tx) => {
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

  async handover(siteId) {
    const q = sql();
    const rows = await q<{ id: string; site_id: SiteId; category: string; body: string; needs_action: boolean; created_by: string; created_by_name: string | null; created_at: Date; closed_at: Date | null; closed_by: string | null }[]>`
      select h.id, h.site_id, h.category, h.body, h.needs_action, h.created_by, p.display_name as created_by_name,
             h.created_at, h.closed_at, h.closed_by
      from handover_items h left join people p on p.id = h.created_by
      where h.site_id = ${siteId} and (h.closed_at is null or h.closed_at > now() - interval '7 days')
      order by h.created_at desc`;
    return rows.map((r): HandoverItem => ({
      id: r.id, siteId: r.site_id, category: r.category, body: r.body, needsAction: r.needs_action,
      createdBy: r.created_by, createdByName: r.created_by_name ?? "", createdAt: r.created_at.getTime(),
      closedAt: ms(r.closed_at), closedBy: opt(r.closed_by),
    }));
  },
  async addHandover(h) {
    const q = sql();
    await q`insert into handover_items (site_id, category, body, needs_action, created_by)
            values (${h.siteId}, ${h.category}, ${h.body}, ${h.needsAction}, ${h.createdBy})`;
  },
  async closeHandover(id, personId) {
    if (!isUuid(id)) return;
    const q = sql();
    await q`update handover_items set closed_at = now(), closed_by = ${personId} where id = ${id} and closed_at is null`;
  },

  async prepItems() {
    const q = sql();
    const rows = await q<{ id: string; name: string; category: PrepCategory; position: number; active: boolean }[]>`
      select id, name, category, position, active from prep_items order by position`;
    return rows.map((r): PrepItem => ({ id: r.id, name: r.name, category: r.category, position: r.position, active: r.active }));
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
    const q = sql();
    await q.begin(async (tx) => {
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
    });
  },
  async prepOutstanding(siteId) {
    const q = sql();
    const rows = await q<PrepEntryRow[]>`
      select e.*, c.display_name as created_by_name, null as completed_by_name
      from prep_entries e join prep_handovers h on h.id = e.handover_id join people c on c.id = e.created_by
      where e.site_id = ${siteId} and e.status = 'outstanding' and h.status = 'submitted'`;
    return rows.map(toPrepEntry);
  },
  async prepSubmit(siteId, personId, makePlan) {
    const q = sql();
    return q.begin(async (tx) => {
      const [h] = await tx<{ id: string }[]>`select id from prep_handovers where site_id = ${siteId} and status = 'draft' for update`;
      if (!h) return undefined;
      const draft = (await tx<PrepEntryRow[]>`select * from prep_entries where handover_id = ${h.id}`).map(toPrepEntry);
      const outstanding = (await tx<PrepEntryRow[]>`
        select e.* from prep_entries e join prep_handovers ph on ph.id = e.handover_id
        where e.site_id = ${siteId} and e.status = 'outstanding' and ph.status = 'submitted' for update of e`).map(toPrepEntry);
      const active = (await tx<{ id: string }[]>`select id from prep_items where active`).map((r) => r.id);
      const plan = makePlan(draft, outstanding, active);
      for (const c of plan.carryIn) {
        await tx`insert into prep_entries (handover_id, site_id, item_id, urgent, note, carried_from, created_by)
                 values (${h.id}, ${siteId}, ${c.itemId}, ${c.urgent}, ${c.note ?? null}, ${c.from}, ${personId})`;
      }
      for (const m of plan.merge) {
        await tx`update prep_entries set carried_from = ${m.from}, urgent = ${m.urgent}, note = ${m.note ?? null} where id = ${m.entryId}`;
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
    await sql().begin(async (tx) => {
      for (const [week, status] of Array.from(statuses.entries())) {
        await tx`insert into rota_weeks (site_id, week_start, status) values (${siteId}, ${week}, ${status})
                 on conflict (site_id, week_start) do update set status = excluded.status, imported_at = now()`;
      }
    });
  },
  async siteShifts(siteId) {
    const q = sql();
    const rows = await q<{ source_key: string; staff_code: string; section: string; week: string; starts_at: Date; ends_at: Date; cancelled_at: Date | null }[]>`
      select s.source_key, p.staff_code, s.section, to_char(s.week_start, 'YYYY-MM-DD') as week, s.starts_at, s.ends_at, s.cancelled_at
      from shifts s join people p on p.id = s.person_id where s.site_id = ${siteId}`;
    return rows.map((r): StoredShift => {
      const date = londonDate(r.starts_at.getTime());
      const start = londonHM(r.starts_at.getTime()), end = londonHM(r.ends_at.getTime());
      return { sourceKey: r.source_key, staffCode: r.staff_code, section: r.section, week: r.week, date, start, end, endsNextDay: end <= start, cancelled: !!r.cancelled_at };
    });
  },
  async applyShiftSync(siteId, plan, personIdByCode) {
    const times = (s: { date: string; start: string; end: string; endsNextDay: boolean }) => ({
      starts: new Date(londonToUtc(s.date, s.start)),
      ends: new Date(londonToUtc(s.endsNextDay ? addDays(s.date, 1) : s.date, s.end)),
    });
    await sql().begin(async (tx) => {
      for (const s of [...plan.added, ...plan.changed.map((c) => c.after)]) {
        const personId = personIdByCode.get(s.staffCode);
        if (!personId) continue;
        const t = times(s);
        await tx`
          insert into shifts (site_id, person_id, section, starts_at, ends_at, source_key, week_start)
          values (${siteId}, ${personId}, ${s.section}, ${t.starts}, ${t.ends}, ${s.sourceKey}, ${s.week})
          on conflict (source_key) do update set person_id = excluded.person_id, section = excluded.section,
            starts_at = excluded.starts_at, ends_at = excluded.ends_at, week_start = excluded.week_start,
            changed_at = now(), cancelled_at = null`;
      }
      for (const s of plan.cancelled) {
        await tx`update shifts set cancelled_at = now(), changed_at = now() where source_key = ${s.sourceKey} and cancelled_at is null`;
      }
    });
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
  async shiftsOnDate(date) {
    const q = sql();
    const rows = await q<{ id: string; site_id: SiteId; site_name: string; section: string; week: string; starts_at: Date; ends_at: Date; person_id: string; staff_code: string }[]>`
      select s.id, s.site_id, si.name as site_name, s.section, to_char(s.week_start, 'YYYY-MM-DD') as week, s.starts_at, s.ends_at, s.person_id, p.staff_code
      from shifts s join sites si on si.id = s.site_id join people p on p.id = s.person_id
      join rota_weeks w on w.site_id = s.site_id and w.week_start = s.week_start and w.status = 'published'
      where s.cancelled_at is null and p.status = 'active' and si.status = 'open'
        and s.starts_at >= ${new Date(londonToUtc(date, "00:00"))} and s.starts_at < ${new Date(londonToUtc(addDays(date, 1), "00:00"))}`;
    return rows.map((r) => ({
      id: r.id, siteId: r.site_id, siteName: r.site_name, section: r.section, week: r.week,
      date: londonDate(r.starts_at.getTime()), start: londonHM(r.starts_at.getTime()), end: londonHM(r.ends_at.getTime()),
      published: true, cancelled: false, personId: r.person_id, staffCode: r.staff_code,
    }));
  },

  // ---------- messages and push ----------
  async queueNotice(n) {
    const q = sql();
    const r = await q`insert into notifications (person_id, kind, title, body, dedupe_key, send_after)
                      values (${n.personId}, ${n.kind}, ${n.title}, ${n.body}, ${n.dedupeKey ?? null}, ${new Date(n.sendAfter)})
                      on conflict (dedupe_key) do nothing`;
    return r.count > 0;
  },
  async dueNotices(now, limit) {
    const q = sql();
    const rows = await q<NoticeDbRow[]>`
      select id, person_id, kind, title, body, send_after, sent_at, created_at from notifications
      where sent_at is null and send_after <= ${new Date(now)} order by send_after limit ${limit}`;
    return rows.map(toNotice);
  },
  async markNoticeSent(id) {
    if (!isUuid(id)) return;
    const q = sql();
    await q`update notifications set sent_at = now() where id = ${id}`;
  },
  async notices(personId, limit) {
    if (!isUuid(personId)) return [];
    const q = sql();
    const rows = await q<NoticeDbRow[]>`
      select id, person_id, kind, title, body, send_after, sent_at, created_at from notifications
      where person_id = ${personId} and send_after <= now() order by send_after desc limit ${limit}`;
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
