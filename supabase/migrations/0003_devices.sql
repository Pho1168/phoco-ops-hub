-- Registered site devices and one-time pairing codes.
-- A device holds a long random token in an httpOnly cookie; only its SHA-256 hash is stored.
alter table devices add column if not exists token_hash text unique;
alter table devices add column if not exists created_at timestamptz not null default now();
alter table devices add column if not exists created_by uuid references people(id);

create table if not exists device_pairings (
  id          uuid primary key default gen_random_uuid(),
  code_hash   text not null unique,
  site_id     text not null references sites(id),
  label       text not null,
  created_by  uuid not null references people(id),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  device_id   uuid references devices(id)
);
alter table device_pairings enable row level security;
create index if not exists app_sessions_device on app_sessions (device_id) where revoked_at is null;
