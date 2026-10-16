-- New items: staff ask for something that isn't in the catalogue yet. While the report is a draft they sit in
-- stock_reports.extras; sending turns each into a stock_new_items row for the owner, who either adds it to the
-- catalogue (a product with a supplier, then a request for the restaurant, so it's ordered like anything else and is
-- on the list next time) or says it isn't needed. Rules in src/lib/domain/stock.ts (cleanNewItems). Rows are kept:
-- a decision is recorded once and never changed.

alter table stock_reports add column if not exists extras jsonb not null default '[]'::jsonb check (jsonb_typeof(extras) = 'array');

create table if not exists stock_new_items (
  id             uuid primary key default gen_random_uuid(),
  site_id        text not null references sites (id),
  report_id      uuid references stock_reports (id),
  name           text not null check (length(name) between 2 and 80),
  size           text check (size is null or length(size) <= 40),
  qty            numeric(10, 2) not null check (qty > 0),
  note           text check (note is null or length(note) <= 200),
  requested_by   uuid not null references people (id),
  created_at     timestamptz not null default now(),
  -- The owner's decision: added (the product and the request it made) or not needed (with a reason).
  decided_at     timestamptz,
  decided_by     uuid references people (id),
  product_id     uuid references stock_products (id),
  request_id     uuid references stock_requests (id),
  dismissed      text check (dismissed is null or length(dismissed) <= 200),
  check ((decided_at is null and decided_by is null and product_id is null and request_id is null and dismissed is null)
      or (decided_at is not null and decided_by is not null and ((product_id is not null and dismissed is null) or (product_id is null and dismissed is not null))))
);
create index if not exists stock_new_items_open on stock_new_items (created_at) where decided_at is null;
alter table stock_new_items enable row level security;

-- Kept as asked for; the decision is made once.
create or replace function stock_new_item_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'stock records are kept' using errcode = 'check_violation'; end if;
  if old.decided_at is not null then raise exception 'that new item has already been decided' using errcode = 'check_violation'; end if;
  if new.site_id is distinct from old.site_id or new.report_id is distinct from old.report_id or new.name is distinct from old.name
     or new.size is distinct from old.size or new.qty is distinct from old.qty or new.note is distinct from old.note
     or new.requested_by is distinct from old.requested_by or new.created_at is distinct from old.created_at then
    raise exception 'a new item is kept as it was asked for' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create or replace trigger stock_new_items_guard before update or delete on stock_new_items for each row execute function stock_new_item_guard();
