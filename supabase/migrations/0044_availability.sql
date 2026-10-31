-- Weekly availability: staff say when they can work in the week ahead, day by day (morning, evening, all day or off,
-- with a short note), before the rota is written. Rules in src/lib/domain/availability.ts.
-- Answers are only ever added; the latest for a person and week counts. `week` is that week's Monday.

create table if not exists availability (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references people(id),
  week        date not null check (extract(isodow from week) = 1),
  days        jsonb not null check (jsonb_typeof(days) = 'array' and jsonb_array_length(days) = 7),
  created_at  timestamptz not null default now()
);
create index if not exists availability_week on availability (week, person_id, created_at);

create or replace trigger availability_append_only before update or delete on availability
  for each row execute function refuse_change();
alter table availability enable row level security;

-- Phone messages: the Wednesday and Thursday reminders.
alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in ('published', 'changed', 'evening', 'notice', 'leave', 'cert', 'report', 'fault', 'service', 'task', 'shift', 'reply',
                  'gas', 'ready', 'daily', 'cover', 'training', 'stock', 'cleaning', 'availability'));
