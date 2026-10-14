-- The owner edits the operational checklists in the app (rules in src/lib/domain/checklist-edit.ts).
-- Items are versioned: a draft is saved as a whole and published as the next version; the one in use before it is
-- retired. Runs are signed against a version, so a published version's items never change. Settings on the
-- template (name, when, due time, on/off) take effect at once.

-- A draft can be dropped (kept as discarded, like library versions); who wrote and published a version.
alter table checklist_versions drop constraint if exists checklist_versions_status_check;
alter table checklist_versions add constraint checklist_versions_status_check
  check (status in ('draft', 'published', 'retired', 'discarded'));
alter table checklist_versions
  add column if not exists created_by uuid references people(id),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- One draft and one published version per checklist.
create unique index if not exists checklist_versions_one_draft on checklist_versions (template_id) where status = 'draft';
create unique index if not exists checklist_versions_one_published on checklist_versions (template_id) where status = 'published';

-- Versions only move draft → published, draft → discarded, published → retired; nothing else on a version in use changes; none is deleted.
create or replace function checklist_versions_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'checklist versions are retired or discarded, never deleted' using errcode = 'check_violation';
  end if;
  if new.id <> old.id or new.template_id <> old.template_id or new.version <> old.version then
    raise exception 'a checklist version keeps its id and number' using errcode = 'check_violation';
  end if;
  if new.status <> old.status and not (
    (old.status = 'draft' and new.status in ('published', 'discarded')) or
    (old.status = 'published' and new.status = 'retired')) then
    raise exception 'a checklist version goes draft → published → retired, or draft → discarded' using errcode = 'check_violation';
  end if;
  if old.status <> 'draft' and (new.source_note is distinct from old.source_note or new.approved_by is distinct from old.approved_by
      or new.published_at is distinct from old.published_at or new.created_by is distinct from old.created_by) and new.status = old.status then
    raise exception 'only a draft changes' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create or replace trigger checklist_versions_guard before update or delete on checklist_versions
  for each row execute function checklist_versions_guard();

-- Items change only while their version is a draft (or published but never run: that's how the seed loads them).
create or replace function checklist_items_guard() returns trigger language plpgsql set search_path = '' as $$
declare v_id uuid := coalesce(new.version_id, old.version_id); v_status text;
begin
  select status into v_status from public.checklist_versions where id = v_id;
  if v_status is distinct from 'draft' and not (v_status = 'published' and not exists (select 1 from public.checklist_runs r where r.version_id = v_id)) then
    raise exception 'the checks of a checklist in use never change: publish a new version' using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create or replace trigger checklist_items_guard before insert or update or delete on checklist_items
  for each row execute function checklist_items_guard();

-- Templates are switched off, never deleted.
create or replace function checklist_templates_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'checklists are switched off, never deleted' using errcode = 'check_violation';
  end if;
  if new.id <> old.id or new.site_id <> old.site_id or new.area <> old.area then
    raise exception 'a checklist keeps its id, site and area' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create or replace trigger checklist_templates_guard before update or delete on checklist_templates
  for each row execute function checklist_templates_guard();
