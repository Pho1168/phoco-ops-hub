-- Shift cover: someone asks for cover on a published shift, colleagues in the same section offer, a manager approves
-- one or declines (and can cancel an approval). The rota sheet is changed by the manager, never by the app. Nothing
-- is deleted: a request is withdrawn, decided or cancelled; an offer is withdrawn. The reason (note) is for managers.
create table if not exists cover_requests (
  id             uuid primary key default gen_random_uuid(),
  shift_id       uuid not null references shifts(id),
  site_id        text not null references sites(id),
  person_id      uuid not null references people(id),
  section        text not null check (char_length(section) between 1 and 10),
  note           text check (char_length(note) <= 200),
  status         text not null default 'open' check (status in ('open', 'approved', 'declined', 'withdrawn', 'cancelled')),
  covered_by     uuid references people(id),
  decided_by     uuid references people(id),
  decided_at     timestamptz,
  decision_note  text check (char_length(decision_note) <= 200),
  withdrawn_at   timestamptz,
  cancelled_by   uuid references people(id),
  cancelled_at   timestamptz,
  cancel_note    text check (char_length(cancel_note) <= 200),
  created_at     timestamptz not null default now(),
  -- who covers is kept after an approval is cancelled
  check ((status in ('approved', 'cancelled')) = (covered_by is not null))
);
-- One request in play per shift.
create unique index if not exists cover_requests_one_live on cover_requests (shift_id) where status in ('open', 'approved');
create index if not exists cover_requests_site on cover_requests (site_id, created_at desc);

create table if not exists cover_offers (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references cover_requests(id),
  person_id     uuid not null references people(id),
  created_at    timestamptz not null default now(),
  withdrawn_at  timestamptz
);
-- One live offer per person per request.
create unique index if not exists cover_offers_one_live on cover_offers (request_id, person_id) where withdrawn_at is null;
create index if not exists cover_offers_request on cover_offers (request_id);

alter table cover_requests enable row level security;
alter table cover_offers enable row level security;

-- Phone messages about cover.
alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in ('published', 'changed', 'evening', 'notice', 'leave', 'cert', 'report', 'fault', 'service', 'task', 'shift', 'reply',
                  'gas', 'ready', 'daily', 'cover'));
