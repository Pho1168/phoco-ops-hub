-- Shift reminders (2 hours before each shift, or when the owner presses "Send reminders now") and the replies
-- to them: on my way, running late (15, 30 or 45 minutes) or can't make it. A reply is never changed: a new one
-- is added and the latest one counts. The reminders themselves are rows in notifications ('shift').
create table if not exists shift_replies (
  id            uuid primary key default gen_random_uuid(),
  shift_id      uuid not null references shifts(id),
  person_id     uuid not null references people(id),
  site_id       text not null references sites(id),
  kind          text not null check (kind in ('on_my_way', 'late', 'cant_make_it')),
  late_minutes  smallint check (late_minutes in (15, 30, 45)),
  created_at    timestamptz not null default now(),
  check ((kind = 'late') = (late_minutes is not null))
);
create index if not exists shift_replies_shift on shift_replies (shift_id, created_at);
create or replace trigger shift_replies_append_only before update or delete on shift_replies
  for each row execute function refuse_change();
alter table shift_replies enable row level security;

-- Phone messages: the shift reminder, and replies passed on to managers.
alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in ('published', 'changed', 'evening', 'notice', 'leave', 'cert', 'report', 'fault', 'service', 'task', 'shift', 'reply'));
