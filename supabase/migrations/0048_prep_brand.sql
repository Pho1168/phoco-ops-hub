-- Each business keeps its own handover list: an item belongs to PHO & CO or Cafe La Viet, and a site's closing shift
-- only picks from its own business's list. Ids stay one sequence (kp-…), so past handovers keep pointing at them.
alter table prep_items add column if not exists brand text not null default 'phoco' check (brand in ('phoco', 'clv'));
create index if not exists prep_items_brand on prep_items (brand, position);
