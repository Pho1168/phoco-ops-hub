-- The library: SOPs (and later recipes) as versioned documents. Managers write drafts; an owner or operations manager
-- approves and publishes. Only published versions reach staff. A published version is never changed: an edit is a
-- new draft, and publishing it marks the old one superseded. Documents are retired, never deleted; versions and
-- read confirmations are never deleted either.
create table if not exists library_docs (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('sop')),
  code         text not null unique,                      -- SOP-BOH-012: never changes
  created_by   uuid not null references people(id),
  created_at   timestamptz not null default now(),
  retired_at   timestamptz,
  retired_by   uuid references people(id),
  retired_note text,
  check ((retired_at is null) = (retired_by is null))
);
alter table library_docs enable row level security;

-- A document's code, kind and creator never change, and documents are never deleted (only retired).
create or replace function library_doc_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'library documents are retired, never deleted' using errcode = 'check_violation';
  end if;
  if row(new.id, new.kind, new.code, new.created_by, new.created_at) is distinct from row(old.id, old.kind, old.code, old.created_by, old.created_at) then
    raise exception 'a library document''s code and kind never change' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create or replace trigger library_docs_guard before update or delete on library_docs
  for each row execute function library_doc_guard();

create table if not exists library_versions (
  id            uuid primary key default gen_random_uuid(),
  doc_id        uuid not null references library_docs(id),
  status        text not null check (status in ('draft', 'in_review', 'published', 'superseded', 'discarded')),
  version       integer check (version > 0),              -- 1, 2, 3 … once published
  title         text not null,
  body          jsonb not null,                           -- checked by the app (sections, purpose, steps with photos)
  author_id     uuid not null references people(id),
  contributors  uuid[] not null default '{}',             -- everyone who wrote, changed or sent it: they can't approve it
  rev           integer not null default 1 check (rev > 0), -- goes up with every change, so nobody acts on a version they haven't seen
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  submitted_by  uuid references people(id),
  submitted_at  timestamptz,
  review_note   text,                                     -- why an approver sent it back
  reviewed_by   uuid references people(id),
  reviewed_at   timestamptz,
  approved_by   uuid references people(id),
  approved_at   timestamptz,
  published_at  timestamptz,
  change        text check (change in ('new', 'minor', 'major')),
  review_by     date,
  superseded_at timestamptz,
  check ((status in ('published', 'superseded')) = (version is not null and approved_by is not null and published_at is not null and change is not null)),
  check ((status = 'superseded') = (superseded_at is not null))
);
-- One live version per document, and one draft (or version waiting for approval) at a time.
create unique index if not exists library_one_published on library_versions (doc_id) where status = 'published';
create unique index if not exists library_one_open on library_versions (doc_id) where status in ('draft', 'in_review');
create unique index if not exists library_version_number on library_versions (doc_id, version) where version is not null;
create index if not exists library_versions_doc on library_versions (doc_id, created_at);
alter table library_versions enable row level security;

-- Only these moves: a draft is saved, sent for approval or discarded; a version waiting for approval goes back to
-- draft or is published; a published version is superseded, and nothing else about it changes. Superseded and
-- discarded versions never change. Nothing is deleted.
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
             new.review_note, new.reviewed_by, new.reviewed_at, new.approved_by, new.approved_at, new.published_at, new.change, new.review_by)
         is not distinct from
         row(old.id, old.version, old.title, old.body, old.contributors, old.rev, old.updated_at, old.submitted_by, old.submitted_at,
             old.review_note, old.reviewed_by, old.reviewed_at, old.approved_by, old.approved_at, old.published_at, old.change, old.review_by) then
    return new;
  end if;
  raise exception 'a published library version can''t be changed: make a new draft' using errcode = 'check_violation';
end $$;
create or replace trigger library_versions_guard before update or delete on library_versions
  for each row execute function library_version_guard();

-- "I've read it", once per person per version.
create table if not exists library_acks (
  version_id uuid not null references library_versions(id),
  person_id  uuid not null references people(id),
  acked_at   timestamptz not null default now(),
  primary key (version_id, person_id)
);
create index if not exists library_acks_person on library_acks (person_id);
create or replace trigger library_acks_append_only before update or delete on library_acks
  for each row execute function refuse_change();
alter table library_acks enable row level security;

-- Photos for SOP steps, resized on the device before upload (JPEG). Kept in the database so they're backed up and only
-- reach signed-in people. A photo no version uses is cleared away after a week; one that's in use is never changed,
-- except that the owner can erase it (privacy: say it shows someone), which empties it and leaves a placeholder.
create table if not exists media (
  id         uuid primary key default gen_random_uuid(),
  mime       text not null check (mime in ('image/jpeg')),
  bytes      bytea not null,
  size       integer not null,
  width      integer not null check (width > 0 and width <= 4096),
  height     integer not null check (height > 0 and height <= 4096),
  created_by uuid not null references people(id),
  created_at timestamptz not null default now(),
  erased_at  timestamptz,
  erased_by  uuid references people(id),
  check ((erased_at is null and size > 0 and size <= 2000000 and size = length(bytes))
      or (erased_at is not null and erased_by is not null and size = 0 and length(bytes) = 0))
);
create index if not exists media_by_person on media (created_by, created_at);
alter table media enable row level security;

create or replace function media_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.library_versions v where strpos(v.body::text, old.id::text) > 0) then
      raise exception 'that photo is used by an SOP' using errcode = 'check_violation';
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
create or replace trigger media_guard before update or delete on media
  for each row execute function media_guard();
