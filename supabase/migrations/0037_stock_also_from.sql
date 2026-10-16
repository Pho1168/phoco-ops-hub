-- Some products can be bought at more than one shop. Besides its preferred supplier (supplier_id), a product lists the
-- other suppliers that also sell it (also_from), set by the owner in the catalogue. On Stock needed the owner or
-- operations manager can move an item to one of them before a shop run, and a driver can say they bought it at one of
-- them instead. Checked by cleanAlsoFrom in src/lib/domain/stock.ts (active, non-production suppliers, not the
-- preferred one, at most 6).

alter table stock_products add column if not exists also_from uuid[] not null default '{}';
