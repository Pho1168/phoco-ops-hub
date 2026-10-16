-- Stock & Purchasing. Rules in src/lib/domain/stock.ts.
-- Staff report what's low or out (stock_reports); each line becomes a request (stock_requests, SR-…). The owner gives
-- what's still needed to someone as a purchase task (stock_tasks, PT-…; production orders PO-…) of lines
-- (stock_task_lines: one request and a quantity each, so a combined buy keeps every restaurant's share). What happens
-- next is only ever added: events (stock_events) and what each restaurant confirms arrived (stock_receipts).
-- Nothing here is deleted. A line ends once (bought, unavailable, dispatched or cancelled): a unique index.

create table if not exists stock_suppliers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 2 and 60),
  method     text not null check (method in ('shop', 'online', 'delivery', 'production')),
  site_id    text references sites (id),
  note       text check (note is null or length(note) <= 300),
  link       text check (link is null or link ~ '^https://'),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  check (method <> 'production' or site_id is not null)
);
create unique index if not exists stock_suppliers_name on stock_suppliers (lower(name));
alter table stock_suppliers enable row level security;

create table if not exists stock_products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 2 and 80),
  size        text check (size is null or length(size) <= 40),
  category    text check (category is null or length(category) <= 40),
  supplier_id uuid references stock_suppliers (id),
  active      boolean not null default true,
  link        text check (link is null or link ~ '^https://'),
  import_name text,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);
-- The same name and size from the same supplier is one product; other sizes or suppliers stay separate products.
create unique index if not exists stock_products_same on stock_products (lower(name), lower(coalesce(size, '')), coalesce(supplier_id::text, ''));
alter table stock_products enable row level security;

-- Reference prices: history (pence, ex VAT, on a date), added and never changed.
create table if not exists stock_prices (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references stock_products (id),
  pence      integer not null check (pence >= 0),
  on_date    date not null,
  note       text check (note is null or length(note) <= 120),
  created_by uuid references people (id),
  created_at timestamptz not null default now()
);
create index if not exists stock_prices_product on stock_prices (product_id, on_date desc);
alter table stock_prices enable row level security;

-- A person's report at a site: a draft (one open at a time) until it's sent.
create table if not exists stock_reports (
  id            uuid primary key default gen_random_uuid(),
  site_id       text not null references sites (id),
  person_id     uuid not null references people (id),
  business_date date not null,
  lines         jsonb not null default '[]'::jsonb,
  no_issues     boolean not null default false,
  submitted_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists stock_reports_one_draft on stock_reports (site_id, person_id) where submitted_at is null;
create index if not exists stock_reports_site on stock_reports (site_id, business_date desc);
alter table stock_reports enable row level security;

create sequence if not exists stock_request_code;
create table if not exists stock_requests (
  id            uuid primary key default gen_random_uuid(),
  code          integer not null unique default nextval('stock_request_code'),
  site_id       text not null references sites (id),
  product_id    uuid not null references stock_products (id),
  level         text not null check (level in ('low', 'out')),
  qty           numeric(10, 2) check (qty is null or qty > 0),
  fixed_qty     numeric(10, 2) check (fixed_qty is null or fixed_qty > 0),
  note          text check (note is null or length(note) <= 200),
  photo_id      uuid references media (id),
  report_id     uuid references stock_reports (id),
  requested_by  uuid not null references people (id),
  supplier_id   uuid references stock_suppliers (id),
  created_at    timestamptz not null default now(),
  cancelled_at  timestamptz,
  cancelled_by  uuid references people (id),
  cancel_reason text
);
create index if not exists stock_requests_site on stock_requests (site_id, created_at desc);
create index if not exists stock_requests_open on stock_requests (created_at) where cancelled_at is null;
alter table stock_requests enable row level security;

create sequence if not exists stock_task_code;
create table if not exists stock_tasks (
  id            uuid primary key default gen_random_uuid(),
  code          integer not null unique default nextval('stock_task_code'),
  supplier_id   uuid references stock_suppliers (id),
  method        text not null check (method in ('shop', 'online', 'delivery', 'production')),
  assignee_id   uuid references people (id),
  driver_id     uuid references people (id),
  required_by   date,
  priority      text not null default 'normal' check (priority in ('normal', 'urgent')),
  note          text check (note is null or length(note) <= 500),
  destination   text references sites (id),
  created_by    uuid not null references people (id),
  created_at    timestamptz not null default now(),
  cancelled_at  timestamptz,
  cancelled_by  uuid references people (id),
  cancel_reason text
);
create index if not exists stock_tasks_assignee on stock_tasks (assignee_id) where cancelled_at is null;
create index if not exists stock_tasks_driver on stock_tasks (driver_id) where cancelled_at is null;
alter table stock_tasks enable row level security;

create table if not exists stock_task_lines (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references stock_tasks (id),
  request_id uuid not null references stock_requests (id),
  qty        numeric(10, 2) not null check (qty > 0),
  created_at timestamptz not null default now()
);
create index if not exists stock_task_lines_task on stock_task_lines (task_id);
create index if not exists stock_task_lines_request on stock_task_lines (request_id);
alter table stock_task_lines enable row level security;

create table if not exists stock_events (
  id         uuid primary key default gen_random_uuid(),
  at         timestamptz not null default now(),
  by         uuid not null references people (id),
  kind       text not null check (kind in ('bought', 'unavailable', 'dispatched', 'line_cancelled', 'reported_again', 'qty_changed',
               'supplier_changed', 'request_cancelled', 'assigned', 'acknowledged', 'ordered', 'cost', 'collected', 'delivered',
               'task_cancelled', 'picked', 'packed', 'substitute', 'substitute_ok', 'substitute_no', 'note')),
  task_id    uuid references stock_tasks (id),
  line_id    uuid references stock_task_lines (id),
  request_id uuid references stock_requests (id),
  qty        numeric(10, 2),
  pence      integer check (pence is null or pence >= 0),
  text       text check (text is null or length(text) <= 500),
  media_id   uuid references media (id),
  ref        text check (ref is null or length(ref) <= 80),
  on_date    date
);
-- A line ends once: no double purchase, no double dispatch.
create unique index if not exists stock_events_one_end on stock_events (line_id) where kind in ('bought', 'unavailable', 'dispatched', 'line_cancelled');
create index if not exists stock_events_task on stock_events (task_id);
create index if not exists stock_events_request on stock_events (request_id);
alter table stock_events enable row level security;

create table if not exists stock_receipts (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null references stock_requests (id),
  qty        numeric(10, 2) not null check (qty > 0),
  by         uuid not null references people (id),
  at         timestamptz not null default now(),
  note       text check (note is null or length(note) <= 200)
);
create index if not exists stock_receipts_request on stock_receipts (request_id);
alter table stock_receipts enable row level security;

-- Who can be given purchasing work (the Assign Driver / Buyer lists), and whether closers are asked for a stock report.
alter table people add column if not exists purchaser boolean not null default false;
alter table sites add column if not exists stock_reminder boolean not null default true;

-- Records are only added. Requests change only in their owner-set quantity, supplier and cancellation; tasks in who
-- has them, when, priority, note and cancellation; reports only while they're drafts (and once, to send them).
create or replace function stock_only_added() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'stock records are only added' using errcode = 'check_violation';
end $$;

create or replace function stock_request_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'stock records are kept' using errcode = 'check_violation'; end if;
  if old.cancelled_at is not null then raise exception 'that request is cancelled' using errcode = 'check_violation'; end if;
  if row(new.id, new.code, new.site_id, new.product_id, new.level, new.qty, new.note, new.photo_id, new.report_id, new.requested_by, new.created_at)
       is distinct from row(old.id, old.code, old.site_id, old.product_id, old.level, old.qty, old.note, old.photo_id, old.report_id, old.requested_by, old.created_at) then
    raise exception 'a request keeps what was reported' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function stock_task_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'stock records are kept' using errcode = 'check_violation'; end if;
  if old.cancelled_at is not null or row(new.id, new.code, new.method, new.created_by, new.created_at) is distinct from row(old.id, old.code, old.method, old.created_by, old.created_at) then
    raise exception 'that task can''t be changed' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function stock_report_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'stock records are kept' using errcode = 'check_violation'; end if;
  if old.submitted_at is not null then raise exception 'a sent report is kept as it was' using errcode = 'check_violation'; end if;
  return new;
end $$;

drop trigger if exists stock_events_guard on stock_events;
create trigger stock_events_guard before update or delete on stock_events for each row execute function stock_only_added();
drop trigger if exists stock_receipts_guard on stock_receipts;
create trigger stock_receipts_guard before update or delete on stock_receipts for each row execute function stock_only_added();
drop trigger if exists stock_prices_guard on stock_prices;
create trigger stock_prices_guard before update or delete on stock_prices for each row execute function stock_only_added();
drop trigger if exists stock_task_lines_guard on stock_task_lines;
create trigger stock_task_lines_guard before update or delete on stock_task_lines for each row execute function stock_only_added();
drop trigger if exists stock_requests_guard on stock_requests;
create trigger stock_requests_guard before update or delete on stock_requests for each row execute function stock_request_guard();
drop trigger if exists stock_tasks_guard on stock_tasks;
create trigger stock_tasks_guard before update or delete on stock_tasks for each row execute function stock_task_guard();
drop trigger if exists stock_reports_guard on stock_reports;
create trigger stock_reports_guard before update or delete on stock_reports for each row execute function stock_report_guard();

-- Messages about stock (a task given to you, an urgent request nobody has).
alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in ('published', 'changed', 'evening', 'notice', 'leave', 'cert', 'report', 'fault', 'service', 'task', 'shift', 'reply',
                  'gas', 'ready', 'daily', 'cover', 'training', 'stock'));
