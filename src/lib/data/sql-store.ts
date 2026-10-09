import postgres from "postgres";
import type { Answer, Area, Checklist, Outcome, Person, Role, Site, SiteId, TempRule } from "@/lib/domain/types";
import type { Alert, AuditEntry, HandoverItem, Run, Session, Store } from "./store";

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
  pin_hash: string | null; pin_failed: number; pin_locked_until: Date | null;
  access: { site_id: SiteId; role: Role; sections: Area[] }[] | null;
}

function toPerson(r: PersonRow): Person {
  return {
    id: r.id, staffCode: r.staff_code, name: r.display_name, status: r.status, frozenReason: opt(r.frozen_reason),
    pinHash: opt(r.pin_hash), pinFailed: r.pin_failed, pinLockedUntil: ms(r.pin_locked_until),
    access: (r.access ?? []).map((a) => ({ siteId: a.site_id, role: a.role, sections: a.sections })),
  };
}

function toSite(r: { id: SiteId; name: string; kind: Site["kind"]; status: Site["status"]; closed_reason: string | null }): Site {
  return { id: r.id, name: r.name, kind: r.kind, status: r.status, closedReason: opt(r.closed_reason) };
}

async function selectPeople(where: postgres.PendingQuery<postgres.Row[]> | null): Promise<Person[]> {
  const q = sql();
  const rows = await q<PersonRow[]>`
    select p.id, p.staff_code, p.display_name, p.status, p.frozen_reason, p.pin_hash, p.pin_failed, p.pin_locked_until,
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

  async createSession(personId, siteId, ttlMs) {
    const q = sql();
    const [r] = await q<{ id: string; started_at: Date; expires_at: Date }[]>`
      insert into app_sessions (person_id, site_id, expires_at) values (${personId}, ${siteId}, ${new Date(Date.now() + ttlMs)})
      returning id, started_at, expires_at`;
    return { id: r.id, personId, siteId, startedAt: r.started_at.getTime(), expiresAt: r.expires_at.getTime() };
  },
  async session(id) {
    if (!isUuid(id)) return undefined;
    const q = sql();
    const [r] = await q<{ id: string; person_id: string; site_id: SiteId; started_at: Date; expires_at: Date; revoked_at: Date | null; revoked_reason: string | null }[]>`
      select id, person_id, site_id, started_at, expires_at, revoked_at, revoked_reason from app_sessions where id = ${id}`;
    if (!r) return undefined;
    const s: Session = { id: r.id, personId: r.person_id, siteId: r.site_id, startedAt: r.started_at.getTime(), expiresAt: r.expires_at.getTime() };
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
        ${except.length ? q`and not (person_id = any(${except}::uuid[]))` : q``}`;
    return res.count;
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
