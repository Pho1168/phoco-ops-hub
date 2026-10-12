-- The daily loop: ready to open, gas off at close, and yesterday at a glance.

-- The time each site's opening checks must be signed by. A site is only checked on days it has published shifts.
alter table sites add column if not exists ready_by time;
update sites set ready_by = '12:00' where id = 'EAS' and ready_by is null;
update sites set ready_by = '08:00' where id = 'WEM' and ready_by is null;

-- Gas off at close: who confirmed it, when, and whether on the shop tablet. One per site per day (the first tap
-- counts); never changed or deleted.
create table if not exists gas_checks (
  id             uuid primary key default gen_random_uuid(),
  site_id        text not null references sites(id),
  business_date  date not null,
  person_id      uuid not null references people(id),
  on_tablet      boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (site_id, business_date)
);
create or replace trigger gas_checks_append_only before update or delete on gas_checks
  for each row execute function refuse_change();
alter table gas_checks enable row level security;

-- Phone messages: gas check reminders and alerts, not ready to open, and the 08:00 summary.
alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in ('published', 'changed', 'evening', 'notice', 'leave', 'cert', 'report', 'fault', 'service', 'task', 'shift', 'reply',
                  'gas', 'ready', 'daily'));
