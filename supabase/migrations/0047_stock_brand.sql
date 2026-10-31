-- Each business keeps its own stock catalogue: a supplier or product belongs to PHO & CO or Cafe La Viet, and a site
-- only orders from its own business's. Names only have to be unique within a business (both can have "Surelygrow").
alter table stock_suppliers add column if not exists brand text not null default 'phoco' check (brand in ('phoco', 'clv'));
alter table stock_products add column if not exists brand text not null default 'phoco' check (brand in ('phoco', 'clv'));
drop index if exists stock_suppliers_name;
create unique index stock_suppliers_name on stock_suppliers (brand, lower(name));
drop index if exists stock_products_same;
create unique index stock_products_same on stock_products (brand, lower(name), lower(coalesce(size, '')), coalesce(supplier_id::text, ''));

-- A product's suppliers are in its own business's catalogue.
create or replace function stock_product_brand_check() returns trigger language plpgsql as $$
begin
  if new.supplier_id is not null and (select brand from stock_suppliers where id = new.supplier_id) is distinct from new.brand then
    raise exception 'A product''s supplier must be in the same business''s catalogue';
  end if;
  if exists (select 1 from stock_suppliers s where s.id = any(coalesce(new.also_from, '{}')) and s.brand <> new.brand) then
    raise exception 'A product''s other suppliers must be in the same business''s catalogue';
  end if;
  return new;
end $$;
drop trigger if exists stock_product_brand on stock_products;
create trigger stock_product_brand before insert or update on stock_products for each row execute function stock_product_brand_check();
