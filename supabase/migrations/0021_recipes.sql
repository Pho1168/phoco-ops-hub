-- The recipe handbook: prep recipes (batch recipes for the kitchen and Wembley) and dish specs (how a menu item is
-- built, with its allergens) join SOPs in the library, with the same drafts, approval and versions. Rules are in
-- src/lib/domain/recipes.ts. A dish version records when its allergens last changed, so everyone at its sites
-- confirms they've seen the change.
alter table library_docs
  drop constraint if exists library_docs_kind_check,
  add constraint library_docs_kind_check check (kind in ('sop', 'prep', 'dish'));

alter table library_versions add column if not exists allergens_changed_at timestamptz;

-- The same moves as before (0020); a published version still can't change, and that now includes when its allergens
-- last changed.
create or replace function library_version_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'library versions are kept' using errcode = 'check_violation';
  end if;
  if new.doc_id is distinct from old.doc_id or new.author_id is distinct from old.author_id or new.created_at is distinct from old.created_at then
    raise exception 'a library version stays with its document and author' using errcode = 'check_violation';
  end if;
  if (old.status = 'draft' and new.status in ('draft', 'in_review', 'discarded'))
     or (old.status = 'in_review' and new.status in ('draft', 'published')) then
    return new;
  end if;
  if old.status = 'published' and new.status = 'superseded' and new.superseded_at is not null
     and row(new.id, new.version, new.title, new.body, new.contributors, new.rev, new.updated_at, new.submitted_by, new.submitted_at,
             new.review_note, new.reviewed_by, new.reviewed_at, new.approved_by, new.approved_at, new.published_at, new.change, new.review_by,
             new.allergens_changed_at)
         is not distinct from
         row(old.id, old.version, old.title, old.body, old.contributors, old.rev, old.updated_at, old.submitted_by, old.submitted_at,
             old.review_note, old.reviewed_by, old.reviewed_at, old.approved_by, old.approved_at, old.published_at, old.change, old.review_by,
             old.allergens_changed_at) then
    return new;
  end if;
  raise exception 'a published library version can''t be changed: make a new draft' using errcode = 'check_violation';
end $$;
