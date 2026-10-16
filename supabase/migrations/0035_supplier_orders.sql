-- Scheduled supplier orders (first: Surelygrow). A supplier can be given order days (cut-off and delivery, UK time),
-- the people who order from it, and a production kitchen it delivers to. Its products are then counted at that kitchen
-- on order days against par levels (stock_targets), and ordered once per round (stock_tasks.round_at, unique). A
-- restaurant asking for one of its products gets it from the kitchen (the kitchen's production order), never from the
-- supplier. Rules in src/lib/domain/supplier-orders.ts.

create table if not exists stock_supplier_orders (
  supplier_id uuid primary key references stock_suppliers (id),
  -- The production kitchen it delivers to. Null: to each restaurant, as before.
  delivers_to text references sites (id),
  -- [{ "cutDow": 0-6 (Sunday 0), "cutHm": "20:00", "delDow": 0-6, "delHm": "08:00" }]
  order_days  jsonb not null default '[]'::jsonb check (jsonb_typeof(order_days) = 'array'),
  orderers    uuid[] not null default '{}',
  updated_by  uuid references people (id),
  updated_at  timestamptz not null default now()
);
alter table stock_supplier_orders enable row level security;

-- Whether a restaurant can ask for this product (from the kitchen) when its supplier delivers only to the kitchen.
alter table stock_products add column if not exists for_restaurants boolean not null default true;

-- A count is either the kitchen's own production list (no supplier) or one supplier's products.
alter table stock_counts add column if not exists supplier_id uuid references stock_suppliers (id);
create index if not exists stock_counts_supplier on stock_counts (site_id, supplier_id, created_at desc);

-- One order per supplier and round: the round is its cut-off moment.
alter table stock_tasks add column if not exists round_at timestamptz;
create unique index if not exists stock_tasks_one_per_round on stock_tasks (supplier_id, round_at) where round_at is not null and cancelled_at is null;

-- What a delivery didn't bring (short, not delivered, wrong): recorded on the line, the rest goes back to waiting.
alter table stock_events drop constraint if exists stock_events_kind_check;
alter table stock_events add constraint stock_events_kind_check check (kind in ('bought', 'unavailable', 'dispatched', 'line_cancelled', 'reported_again', 'qty_changed',
  'supplier_changed', 'request_cancelled', 'assigned', 'acknowledged', 'ordered', 'cost', 'collected', 'delivered',
  'task_cancelled', 'picked', 'packed', 'substitute', 'substitute_ok', 'substitute_no', 'note', 'short'));
