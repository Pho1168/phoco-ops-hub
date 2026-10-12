-- The library: SOPs (and later recipes) as versioned documents. Managers write drafts; an owner or operations manager
-- approves and publishes. Only published versions reach staff. A published version is never changed: an edit is a
-- new draft, and publishing it marks the old one superseded. Documents are retired, never deleted; versions,
-- read confirmations and photos are never deleted either.
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

create table if not exists library_versions (
  id            uuid primary key default gen_random_uuid(),
  doc_id        uuid not null references library_docs(id),
  status        text not null check (status in ('draft', 'in_review', 'published', 'superseded', 'discarded')),
  version       integer check (version > 0),              -- 1, 2, 3 … once published
  title         text not null,
  body          jsonb not null,                           -- checked by the app (sections, purpose, steps with photos)
  author_id     uuid not null references people(id),
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

-- Drafts and versions waiting for approval can change; a published version can only become superseded (nothing else
-- about it changes); superseded and discarded versions never change. Nothing is deleted.
create or replace function library_version_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'library versions are kept' using errcode = 'check_violation';
  end if;
  if old.status in ('draft', 'in_review') then
    return new;
  end if;
  if old.status = 'published' and new.status = 'superseded' and new.superseded_at is not null
     and row(new.id, new.doc_id, new.version, new.title, new.body, new.author_id, new.created_at, new.submitted_by, new.submitted_at,
             new.approved_by, new.approved_at, new.published_at, new.change, new.review_by)
         is not distinct from
         row(old.id, old.doc_id, old.version, old.title, old.body, old.author_id, old.created_at, old.submitted_by, old.submitted_at,
             old.approved_by, old.approved_at, old.published_at, old.change, old.review_by) then
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

-- Photos (SOP steps today), resized on the phone before upload. Kept in the database so they're backed up and only
-- reach signed-in people; never changed or deleted, so an old version still shows its photos.
create table if not exists media (
  id         uuid primary key default gen_random_uuid(),
  mime       text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  bytes      bytea not null,
  size       integer not null check (size > 0 and size <= 2000000),
  width      integer not null check (width > 0),
  height     integer not null check (height > 0),
  created_by uuid not null references people(id),
  created_at timestamptz not null default now()
);
create or replace trigger media_append_only before update or delete on media
  for each row execute function refuse_change();
alter table media enable row level security;
