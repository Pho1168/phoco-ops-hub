-- Tasks: one-off jobs a manager gives to a person, a section or everyone at a site, with a priority
-- (1 critical to 4 improvement) and a date. Nothing is deleted: a task is done or cancelled, with who and when.
create table if not exists tasks (
  id            uuid primary key default gen_random_uuid(),
  site_id       text not null references sites(id),
  title         text not null check (char_length(title) between 1 and 120),
  detail        text check (char_length(detail) <= 1000),
  priority      smallint not null check (priority between 1 and 4),
  category      text not null check (category in ('cleaning', 'maintenance', 'food_safety', 'stock', 'training', 'admin', 'other')),
  assignee_id   uuid references people(id),
  section       text check (section in ('FOH', 'BOH', 'PROD')),
  due_on        date,
  status        text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  created_by    uuid not null references people(id),
  created_at    timestamptz not null default now(),
  done_by       uuid references people(id),
  done_at       timestamptz,
  done_note     text check (char_length(done_note) <= 300),
  cancelled_by  uuid references people(id),
  cancelled_at  timestamptz,
  check (assignee_id is null or section is null)
);
create index if not exists tasks_open on tasks (site_id, priority, due_on) where status = 'open';
create index if not exists tasks_recent on tasks (site_id, created_at desc);
alter table tasks enable row level security;

-- Phone messages: a task given to someone.
alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in ('published', 'changed', 'evening', 'notice', 'leave', 'cert', 'report', 'fault', 'service', 'task'));
