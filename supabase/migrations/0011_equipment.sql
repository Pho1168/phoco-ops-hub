-- Equipment and maintenance: each site's kit, and its history of faults, updates, fixes and services.
-- Kit that's no longer used is retired, never deleted. The history is append-only.
create table if not exists equipment (
  id                   uuid primary key default gen_random_uuid(),
  site_id              text not null references sites(id),
  name                 text not null check (char_length(name) between 1 and 60),
  kind                 text not null check (kind in ('fridge', 'freezer', 'cooking', 'hot_holding', 'dishwasher', 'ice_machine',
                                                     'probe', 'extraction', 'coffee', 'till', 'other')),
  location             text check (char_length(location) <= 60),
  make_model           text check (char_length(make_model) <= 80),
  serial               text check (char_length(serial) <= 60),
  service_every_months int check (service_every_months between 1 and 60),
  service_contact      text check (char_length(service_contact) <= 200),
  instructions         text check (char_length(instructions) <= 1000),
  created_by           uuid not null references people(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz,
  retired_at           timestamptz,
  retired_by           uuid references people(id)
);
create index if not exists equipment_site on equipment (site_id) where retired_at is null;

create table if not exists equipment_events (
  id            uuid primary key default gen_random_uuid(),
  equipment_id  uuid not null references equipment(id),
  site_id       text not null references sites(id),
  kind          text not null check (kind in ('fault', 'update', 'fixed', 'service')),
  fault_id      uuid references equipment_events(id),
  severity      text check (severity in ('down', 'attention')),
  body          text not null check (char_length(body) between 1 and 500),
  done_on       date,
  created_by    uuid not null references people(id),
  created_at    timestamptz not null default now(),
  check ((kind = 'fault') = (severity is not null)),
  check ((kind in ('update', 'fixed')) = (fault_id is not null)),
  check ((kind = 'service') = (done_on is not null))
);
create index if not exists equipment_events_equipment on equipment_events (equipment_id, created_at);
create index if not exists equipment_events_site on equipment_events (site_id, created_at);
-- A fault is fixed once.
create unique index if not exists equipment_events_one_fix on equipment_events (fault_id) where kind = 'fixed';
create or replace trigger equipment_events_append_only before update or delete on equipment_events
  for each row execute function refuse_change();

alter table equipment enable row level security;
alter table equipment_events enable row level security;
