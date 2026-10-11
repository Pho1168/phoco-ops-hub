-- Team notices with read receipts, and the new kinds of phone message the app sends.
create table if not exists announcements (
  id          uuid primary key default gen_random_uuid(),
  site_id     text references sites(id),                         -- null: every site
  sections    text[] not null default '{}',                      -- empty: everyone; else FOH / BOH / PROD
  title       text not null check (char_length(title) between 1 and 120),
  body        text not null check (char_length(body) between 1 and 2000),
  important   boolean not null default false,                    -- also sent to phones
  created_by  uuid not null references people(id),
  created_at  timestamptz not null default now(),
  show_until  date,                                              -- last London day it shows; null: until taken down
  ended_at    timestamptz,
  ended_by    uuid references people(id)
);
create index if not exists announcements_recent on announcements (created_at desc);

create table if not exists announcement_reads (
  announcement_id uuid not null references announcements(id),
  person_id       uuid not null references people(id),
  read_at         timestamptz not null default now(),
  primary key (announcement_id, person_id)
);

alter table announcements enable row level security;
alter table announcement_reads enable row level security;

-- Phone messages: team notices, time-off decisions, certificate reminders and the weekly report.
alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in ('published', 'changed', 'evening', 'notice', 'leave', 'cert', 'report'));
