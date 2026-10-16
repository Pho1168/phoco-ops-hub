-- Production stock count. At a production kitchen the team counts what is on the shelf (stock_counts, at close), and
-- the people who plan the day set a target per product (stock_targets). The plan works out what to make: the target,
-- plus what the restaurants have ordered and not yet been sent, less what is on the shelf. Rules in
-- src/lib/domain/stock-count.ts. Both tables are only ever added to: a recount or a new target is a new row, and the
-- latest one counts.

create table if not exists stock_counts (
  id            uuid primary key default gen_random_uuid(),
  site_id       text not null references sites (id),
  counted_by    uuid not null references people (id),
  business_date date not null,
  -- [{ "productId": uuid, "qty": number }], one per product counted. A product left out was not counted.
  lines         jsonb not null check (jsonb_typeof(lines) = 'array'),
  note          text check (note is null or length(note) <= 300),
  created_at    timestamptz not null default now()
);
create index if not exists stock_counts_site on stock_counts (site_id, created_at desc);
alter table stock_counts enable row level security;

create table if not exists stock_targets (
  id         uuid primary key default gen_random_uuid(),
  site_id    text not null references sites (id),
  product_id uuid not null references stock_products (id),
  -- Null: no target any more.
  qty        numeric(10, 2) check (qty is null or qty >= 0),
  set_by     uuid not null references people (id),
  set_at     timestamptz not null default now()
);
create index if not exists stock_targets_latest on stock_targets (site_id, product_id, set_at desc);
alter table stock_targets enable row level security;

create or replace trigger stock_counts_guard before update or delete on stock_counts for each row execute function stock_only_added();
create or replace trigger stock_targets_guard before update or delete on stock_targets for each row execute function stock_only_added();
