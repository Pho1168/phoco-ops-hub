-- Training guides: each skill can carry a written card (why it matters, when, numbered steps with pictures, the
-- never-do list, what a manager looks for) in the Pho & Co poster style. Rules in src/lib/domain/training.ts
-- (cleanGuide). Pictures are library photos (media), so a photo a guide uses is kept like one an SOP uses.
alter table training_skills add column if not exists guide jsonb;

create or replace function media_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.library_versions v where v.status <> 'discarded' and strpos(v.body::text, old.id::text) > 0) then
      raise exception 'that photo is used by an SOP' using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.training_skills s where s.guide is not null and strpos(s.guide::text, old.id::text) > 0) then
      raise exception 'that photo is used by a training guide' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if old.erased_at is null and new.erased_at is not null
     and row(new.id, new.mime, new.width, new.height, new.created_by, new.created_at)
         is not distinct from row(old.id, old.mime, old.width, old.height, old.created_by, old.created_at) then
    return new;
  end if;
  raise exception 'photos aren''t changed, only erased' using errcode = 'check_violation';
end $$;
