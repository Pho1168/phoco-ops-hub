-- My Day: the owner's own to-do list, private to the person it belongs to. Rules in src/lib/domain/my-day.ts.
-- A task happens once (on a date or whenever) or repeats every week (ISO weekday) or every month (day of the month;
-- the last day in a shorter month). Tasks are changed or stopped, never deleted. Ticks (done, skipped, undone) are
-- only added; the latest for a task and date counts, so anything not ticked is carried forward.

create table if not exists my_tasks (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references people(id),
  title       text not null check (char_length(title) between 1 and 120),
  note        text check (char_length(note) <= 500),
  priority    smallint not null check (priority between 1 and 3),
  repeat      text not null check (repeat in ('once', 'weekly', 'monthly')),
  repeat_day  smallint,
  due_on      date,
  starts_on   date not null,
  alert_days  smallint check (alert_days between 0 and 14),
  top         boolean not null default false,
  status      text not null default 'open' check (status in ('open', 'stopped')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check ((repeat = 'once' and repeat_day is null)
      or (repeat = 'weekly' and repeat_day between 1 and 7 and due_on is null)
      or (repeat = 'monthly' and repeat_day between 1 and 31 and due_on is null)),
  check (alert_days is null or repeat <> 'once' or due_on is not null)
);
create index if not exists my_tasks_person on my_tasks (person_id, status);
create or replace trigger my_tasks_no_delete before delete on my_tasks
  for each row execute function refuse_change();
alter table my_tasks enable row level security;

create table if not exists my_task_marks (
  id        uuid primary key default gen_random_uuid(),
  task_id   uuid not null references my_tasks(id),
  due_on    date not null,
  kind      text not null check (kind in ('done', 'skipped', 'undone')),
  at        timestamptz not null default now()
);
create index if not exists my_task_marks_task on my_task_marks (task_id, due_on, at);
create or replace trigger my_task_marks_append_only before update or delete on my_task_marks
  for each row execute function refuse_change();
alter table my_task_marks enable row level security;

-- Phone messages: a heads-up before a task is due, and on the day.
alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in ('published', 'changed', 'evening', 'notice', 'leave', 'cert', 'report', 'fault', 'service', 'task', 'shift', 'reply',
                  'gas', 'ready', 'daily', 'cover', 'training', 'stock', 'cleaning', 'availability', 'myday'));
