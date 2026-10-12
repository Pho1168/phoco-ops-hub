-- Time-off requests: staff ask, a manager of their site approves or declines. Nothing is deleted:
-- a withdrawn request is marked cancelled.
create table if not exists time_off (
  id            uuid primary key default gen_random_uuid(),
  person_id     uuid not null references people(id),
  site_id       text not null references sites(id),
  starts_on     date not null,
  ends_on       date not null,
  kind          text not null check (kind in ('holiday', 'unpaid', 'other')),
  note          text check (char_length(note) <= 300),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'cancelled')),
  created_at    timestamptz not null default now(),
  decided_by    uuid references people(id),
  decided_at    timestamptz,
  decision_note text check (char_length(decision_note) <= 300),
  cancelled_at  timestamptz,
  check (ends_on >= starts_on)
);
create index if not exists time_off_person on time_off (person_id, starts_on);
create index if not exists time_off_site on time_off (site_id, starts_on) where status in ('pending', 'approved');
alter table time_off enable row level security;
