-- Rota import from the site Google Sheets, "My shifts" on personal phones, and reminders.

-- Which week a shift belongs to, so an import only touches the weeks it contains.
alter table shifts add column if not exists week_start date;
create index if not exists shifts_person_time on shifts (person_id, starts_at) where cancelled_at is null;
create index if not exists shifts_site_week on shifts (site_id, week_start);

-- Personal-phone sessions only see the person's own shifts.
alter table app_sessions add column if not exists scope text not null default 'full' check (scope in ('full', 'shifts'));

-- Each site's rota sheet signs its uploads with a token; only the hash is kept.
create table if not exists rota_sources (
  site_id        text primary key references sites(id),
  token_hash     text not null unique,
  created_by     uuid references people(id),
  created_at     timestamptz not null default now(),
  last_import_at timestamptz,
  last_result    jsonb
);

-- Messages to staff: shown under "My shifts" and sent as push notifications.
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references people(id),
  kind        text not null check (kind in ('published', 'changed', 'evening')),
  title       text not null,
  body        text not null,
  dedupe_key  text unique,
  send_after  timestamptz not null default now(),
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_due on notifications (send_after) where sent_at is null;
create index if not exists notifications_person on notifications (person_id, created_at desc);

create table if not exists push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references people(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  failures   int not null default 0
);

-- Server-generated secrets (web push keys, scheduler token). Readable only by the app server.
create table if not exists app_secrets (
  key        text primary key,
  value      text not null,
  created_at timestamptz not null default now()
);

alter table rota_sources enable row level security;
alter table notifications enable row level security;
alter table push_subscriptions enable row level security;
alter table app_secrets enable row level security;
