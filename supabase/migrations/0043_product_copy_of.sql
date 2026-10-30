-- A production kitchen's copy of a supplier's product (what restaurants order from the kitchen) remembers the product
-- it was copied from, so the supplier's order page can show how much the restaurants want of it, even after renaming.
alter table stock_products add column if not exists copy_of uuid references stock_products (id);

-- The Surelygrow copies made on go-live: same name, supplier Production.
update stock_products c set copy_of = s.id
from stock_products s
join stock_suppliers ss on ss.id = s.supplier_id and ss.delivery_days is not null and cardinality(ss.delivery_days) > 0
where c.copy_of is null and c.id <> s.id and lower(c.name) = lower(s.name) and s.active
  and c.supplier_id in (select id from stock_suppliers where method = 'production');
