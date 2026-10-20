-- The cleaning board: jobs done once or twice a week (or once a month) on no fixed day. Whoever takes one this week
-- claims it, then ticks it done; until then it stays on the board for everyone. A job not done in its week or month
-- is marked missed once, and the site's managers are told. Rules in src/lib/domain/cleaning.ts.
--
-- Jobs are kept (never deleted; `active` takes one off). Events are only ever added: claimed, released (let go),
-- done, missed. `period` is the week's Monday or the month's 1st it counts for. One "missed" per job per period.

create table if not exists cleaning_jobs (
  id          text primary key,
  site_id     text not null references sites(id),
  area        text not null check (area in ('BOH', 'FOH', 'PROD')),
  name        text not null check (length(name) between 1 and 120),
  per         text not null check (per in ('week', 'month')),
  times       int  not null default 1 check (times between 1 and 7),
  position    int  not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists cleaning_events (
  id          uuid primary key default gen_random_uuid(),
  job_id      text not null references cleaning_jobs(id),
  period      date not null,
  kind        text not null check (kind in ('claimed', 'released', 'done', 'missed')),
  person_id   uuid references people(id),
  note        text check (note is null or length(note) <= 300),
  at          timestamptz not null default now(),
  -- Missed is the app's own record; everything else is someone's.
  check ((kind = 'missed') = (person_id is null))
);
create unique index if not exists cleaning_events_missed_once on cleaning_events (job_id, period) where kind = 'missed';
create index if not exists cleaning_events_period on cleaning_events (period);

create or replace trigger cleaning_events_append_only before update or delete on cleaning_events
  for each row execute function refuse_change();

create or replace function cleaning_jobs_kept() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'cleaning jobs are kept: take one off instead' using errcode = 'check_violation';
end $$;
create or replace trigger cleaning_jobs_no_delete before delete on cleaning_jobs
  for each row execute function cleaning_jobs_kept();

alter table cleaning_jobs enable row level security;
alter table cleaning_events enable row level security;

-- Phone messages: cleaning missed.
alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in ('published', 'changed', 'evening', 'notice', 'leave', 'cert', 'report', 'fault', 'service', 'task', 'shift', 'reply',
                  'gas', 'ready', 'daily', 'cover', 'training', 'stock', 'cleaning'));

-- The jobs, as agreed with the owner (October 2026). Taken off the daily cleaning checklists at the same time.
insert into cleaning_jobs (id, site_id, area, name, per, times, position) values
  ('EAS-BOH-GREASE',   'EAS', 'BOH', 'Grease traps', 'week', 2, 1),
  ('EAS-BOH-CANOPY',   'EAS', 'BOH', 'Canopy / extraction grills and hood', 'week', 1, 2),
  ('EAS-BOH-BURNER',   'EAS', 'BOH', '6 ring burner', 'week', 1, 3),
  ('EAS-BOH-FRIDGES',  'EAS', 'BOH', 'Inside fridges and freezers', 'week', 1, 4),
  ('EAS-BOH-BEHIND',   'EAS', 'BOH', 'Behind cooking station', 'week', 1, 5),
  ('EAS-BOH-DRAIN',    'EAS', 'BOH', 'Clean drain', 'week', 1, 6),
  ('EAS-BOH-FLY',      'EAS', 'BOH', 'Electronic fly killer', 'month', 1, 7),
  ('EAS-FOH-PENDANTS', 'EAS', 'FOH', 'Light pendants wiped', 'week', 1, 11),
  ('EAS-FOH-TILES',    'EAS', 'FOH', 'Wall tiles wiped', 'week', 1, 12),
  ('EAS-FOH-PANELS',   'EAS', 'FOH', 'Door and window panels cleaned', 'week', 1, 13),
  ('EAS-FOH-AIRCON',   'EAS', 'FOH', 'Air con cleaned', 'week', 1, 14),
  ('EAS-FOH-WINDOWS',  'EAS', 'FOH', 'Main windows cleaned', 'week', 1, 15),
  ('WEM-PROD-GREASE',  'WEM', 'PROD', 'Grease traps', 'week', 2, 1),
  ('WEM-PROD-BEHIND',  'WEM', 'PROD', 'Behind cooking station', 'week', 1, 2),
  ('WEM-PROD-FRIDGES', 'WEM', 'PROD', 'Inside fridges and freezers', 'week', 1, 3),
  ('WEM-PROD-CANOPY',  'WEM', 'PROD', 'Extraction grills and hood', 'week', 1, 4),
  ('WEM-PROD-DISH',    'WEM', 'PROD', 'Dishwasher, spray arms, sink tap and hand spray', 'week', 1, 5),
  ('WEM-PROD-DRAIN',   'WEM', 'PROD', 'Drain treatment', 'week', 1, 6),
  ('WEM-PROD-FLY',     'WEM', 'PROD', 'Electronic fly killer', 'month', 1, 7),
  ('WEM-PROD-WALLS',   'WEM', 'PROD', 'Upper walls', 'month', 1, 8),
  ('WEM-PROD-EVAP',    'WEM', 'PROD', 'Cold room evaporators', 'month', 1, 9),
  ('WEM-PROD-AIRCON',  'WEM', 'PROD', 'Air con', 'month', 1, 10)
on conflict (id) do nothing;
