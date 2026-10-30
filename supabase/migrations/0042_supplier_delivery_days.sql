-- Suppliers ordered as a round on set delivery days (Surelygrow delivers to the Wembley kitchen on Monday and
-- Friday). Their items are kept off Stock needed and have their own order page, one order per delivery, closing at
-- the end of the day before. ISO weekdays: 1 = Monday … 7 = Sunday. Rules in src/lib/domain/stock.ts
-- (`ordersByRound`, `nextDelivery`).
alter table stock_suppliers add column if not exists delivery_days smallint[] not null default '{}';
alter table stock_suppliers drop constraint if exists stock_suppliers_delivery_days_check;
alter table stock_suppliers add constraint stock_suppliers_delivery_days_check
  check (delivery_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]);
