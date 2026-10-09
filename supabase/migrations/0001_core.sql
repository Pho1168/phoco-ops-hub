-- PHO & CO Ops Hub · core schema (MVP slice 1)
-- Sites, people and access, checklists, runs and evidence, alerts, handover, shifts, audit.
--
-- Security model
--   * Staff sign in on shared site devices with a personal PIN. The Next.js server checks the PIN,
--     opens an app_session row and sets an httpOnly cookie. Every server request re-checks the
--     session, the person's status and the site's status, so freezing an account or closing a
--     site takes effect on the next request.
--   * The server talks to Postgres with the service role. Row level security is ENABLED on every
--     table with NO policies for anon/authenticated, so the public API keys can read nothing.
--   * Evidence (answers, audit) is append-only: triggers refuse UPDATE and DELETE.

create extension if not exists pgcrypto;

-- ---------- sites ----------
create table sites (
  id            text primary key,                      -- 'EAS', 'WEM', 'SYD'
  name          text not null,
  kind          text not null check (kind in ('restaurant','production')),
  timezone      text not null default 'Europe/London',
  status        text not null default 'open' check (status in ('open','closed')),
  closed_reason text,
  closed_at     timestamptz,
  closed_by     uuid,
  created_at    timestamptz not null default now()
);

-- ---------- people and access ----------
create table people (
  id             uuid primary key default gen_random_uuid(),
  staff_code     text not null unique,                 -- 'PC-0001', matches the rota Staff ID column
  display_name   text not null,
  language       text not null default 'en' check (language in ('en','vi')),
  status         text not null default 'active' check (status in ('active','frozen','left')),
  frozen_reason  text,                                 -- 'owner' or 'site:EAS' (site closure)
  pin_hash       text,                                 -- scrypt hash, never the PIN
  pin_failed     int not null default 0,
  pin_locked_until timestamptz,
  created_at     timestamptz not null default now()
);

create table person_sites (
  person_id  uuid not null references people(id) on delete cascade,
  site_id    text not null references sites(id),
  role       text not null check (role in ('owner','manager','staff')),
  sections   text[] not null default '{}',            -- 'FOH','BOH','PROD'
  primary key (person_id, site_id)
);

create table devices (
  id         uuid primary key default gen_random_uuid(),
  site_id    text not null references sites(id),
  label      text not null,                           -- 'Eastcote kitchen tablet'
  status     text not null default 'active' check (status in ('active','locked')),
  last_seen  timestamptz
);

create table app_sessions (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references people(id),
  site_id     text not null references sites(id),
  device_id   uuid references devices(id),
  started_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  revoked_reason text
);
create index on app_sessions (person_id) where revoked_at is null;
create index on app_sessions (site_id) where revoked_at is null;

-- ---------- approved temperature rules (limits come from the HACCP plan, never from code) ----------
create table temp_rules (
  code        text primary key,                       -- 'F' fridge, 'Z' freezer, 'C' cook, 'L' cooling
  label       text not null,
  target_max  numeric, target_min numeric,            -- above target = warning
  legal_max   numeric, legal_min  numeric,            -- beyond legal = critical
  approved_by text,
  approved_at date
);

-- ---------- checklists ----------
create table checklist_templates (
  id          text primary key,                       -- 'EAS-FOH-OPEN'
  site_id     text not null references sites(id),
  name        text not null,
  area        text not null check (area in ('FOH','BOH','PROD')),
  when_label  text not null,
  due_time    time,
  is_suggested boolean not null default false,
  active      boolean not null default true
);

create table checklist_versions (
  id           uuid primary key default gen_random_uuid(),
  template_id  text not null references checklist_templates(id),
  version      int not null,
  status       text not null default 'draft' check (status in ('draft','published','retired')),
  source_note  text,
  approved_by  uuid references people(id),
  published_at timestamptz,
  unique (template_id, version)
);

create table checklist_items (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references checklist_versions(id) on delete cascade,
  position    int not null,
  section     text not null,
  text        text not null,
  answer_type text not null check (answer_type in ('tick','temp','number','text','photo')),
  rule_code   text references temp_rules(code),
  hint        text,
  tag         text,                                   -- 'from SYD', 'new', 'name to confirm'
  unique (version_id, position)
);

create table checklist_runs (
  id            uuid primary key default gen_random_uuid(),
  template_id   text not null references checklist_templates(id),
  version_id    uuid not null references checklist_versions(id),
  site_id       text not null references sites(id),
  business_date date not null,
  status        text not null default 'open' check (status in ('open','signed','missed')),
  signed_by     uuid references people(id),
  signed_at     timestamptz,
  missed_reason text,
  unique (template_id, business_date)
);

-- every reading/tick is a new row; a correction supersedes, it never overwrites
create table run_answers (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references checklist_runs(id),
  item_id      uuid not null references checklist_items(id),
  value        text,
  numeric_value numeric,
  outcome      text not null check (outcome in ('done','ok','warn','bad','cleared')),
  source       text not null default 'manual' check (source in ('manual','probe','sensor')),
  recorded_by  uuid not null references people(id),
  captured_at  timestamptz not null,                  -- device time, kept for offline capture
  synced_at    timestamptz not null default now(),
  supersedes   uuid references run_answers(id)
);
create index on run_answers (run_id, item_id, synced_at desc);

create table corrective_actions (
  id          uuid primary key default gen_random_uuid(),
  answer_id   uuid not null references run_answers(id),
  action      text not null,
  note        text,
  recorded_by uuid not null references people(id),
  recorded_at timestamptz not null default now()
);

create table alerts (
  id              uuid primary key default gen_random_uuid(),
  site_id         text not null references sites(id),
  level           text not null check (level in ('warning','critical')),
  title           text not null,
  detail          text,
  answer_id       uuid references run_answers(id),
  dedupe_key      text not null,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references people(id),
  resolution_note text
);
create unique index alerts_open_dedupe on alerts (dedupe_key) where resolved_at is null;

-- ---------- handover ----------
create table handover_items (
  id           uuid primary key default gen_random_uuid(),
  site_id      text not null references sites(id),
  category     text not null,
  body         text not null,
  needs_action boolean not null default false,
  created_by   uuid not null references people(id),
  created_at   timestamptz not null default now(),
  closed_by    uuid references people(id),
  closed_at    timestamptz
);

-- ---------- shifts imported from the rota Google Sheets (read-only copy) ----------
create table rota_weeks (
  site_id      text not null references sites(id),
  week_start   date not null,
  status       text not null check (status in ('draft','published')),
  imported_at  timestamptz not null default now(),
  primary key (site_id, week_start)
);

create table shifts (
  id           uuid primary key default gen_random_uuid(),
  site_id      text not null references sites(id),
  person_id    uuid not null references people(id),
  section      text not null,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  source_key   text not null unique,                  -- site|week|row|day, makes imports idempotent
  changed_at   timestamptz not null default now(),
  cancelled_at timestamptz
);

create table shift_acks (
  shift_id   uuid not null references shifts(id) on delete cascade,
  person_id  uuid not null references people(id),
  acked_at   timestamptz not null default now(),
  primary key (shift_id, person_id)
);

-- ---------- audit ----------
create table audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor_id   uuid references people(id),
  site_id    text references sites(id),
  action     text not null,                           -- 'site.close', 'person.freeze', 'run.sign' ...
  entity     text,
  entity_id  text,
  detail     jsonb not null default '{}'
);

-- ---------- append-only guards ----------
create or replace function refuse_change() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only: add a new record instead of changing or deleting', tg_table_name;
end $$;

create trigger run_answers_append_only before update or delete on run_answers
  for each row execute function refuse_change();
create trigger audit_log_append_only before update or delete on audit_log
  for each row execute function refuse_change();
create trigger corrective_actions_append_only before update or delete on corrective_actions
  for each row execute function refuse_change();

-- ---------- row level security: deny by default ----------
do $$
declare t text;
begin
  foreach t in array array['sites','people','person_sites','devices','app_sessions','temp_rules',
    'checklist_templates','checklist_versions','checklist_items','checklist_runs','run_answers',
    'corrective_actions','alerts','handover_items','rota_weeks','shifts','shift_acks','audit_log']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
