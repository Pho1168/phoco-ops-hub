-- The handover master list, edited in the app (Manage → Handover list): things to do and things to prep, each in a
-- group. Managers add and edit items; the owner and operations managers take them off the list (active = false) and
-- put them back. Items are never deleted and their ids never change, so past handovers still point at them.
-- The "Bar & Counter Prep" checklist is retired: its jobs join the list as the "Bar & counter" group.
-- Rules in src/lib/domain/prep.ts.

alter table prep_items
  add column if not exists kind text not null default 'prep' check (kind in ('todo', 'prep')),
  add column if not exists grp text,
  add column if not exists created_by uuid references people(id),
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by uuid references people(id),
  add column if not exists retired_by uuid references people(id);

-- The original five categories become groups (category is kept for history; new items have none).
update prep_items set grp = case category
    when 'cooking' then 'Cooking & kitchen prep' when 'fresh' then 'Fresh prep & vegetables' when 'sauces' then 'Sauces & condiments'
    when 'defrost' then 'Defrosting & replenishment' when 'drinks' then 'Drinks & desserts' else 'Other' end
  where grp is null;
alter table prep_items alter column grp set not null;
alter table prep_items alter column category drop not null;
alter table prep_items drop constraint if exists prep_items_category_check;
alter table prep_items drop constraint if exists prep_items_grp_check;
alter table prep_items add constraint prep_items_grp_check check (char_length(grp) between 1 and 40 and char_length(name) between 1 and 80);

-- Never deleted, never renumbered.
create or replace function prep_items_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'handover list items are taken off the list, never deleted' using errcode = 'check_violation';
  end if;
  if new.id <> old.id then
    raise exception 'a handover list item keeps its id' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create or replace trigger prep_items_guard before update or delete on prep_items
  for each row execute function prep_items_guard();

-- The bar and counter jobs (BAR_ITEMS in src/lib/domain/prep.ts).
insert into prep_items (id, name, kind, grp, position) values
  ('kp-064', 'Cut limes into wedges', 'prep', 'Bar & counter', 64),
  ('kp-065', 'Cut coriander stalks to length', 'prep', 'Bar & counter', 65),
  ('kp-066', 'Slice cucumber', 'prep', 'Bar & counter', 66),
  ('kp-067', 'Slice chillies', 'prep', 'Bar & counter', 67),
  ('kp-068', 'Shred spring onions finely', 'prep', 'Bar & counter', 68),
  ('kp-069', 'Pick coriander leaves', 'prep', 'Bar & counter', 69),
  ('kp-070', 'Pick mint leaves', 'prep', 'Bar & counter', 70),
  ('kp-071', 'Cut romaine to size', 'prep', 'Bar & counter', 71),
  ('kp-072', 'Portion bun', 'prep', 'Bar & counter', 72),
  ('kp-073', 'Slice lemons', 'prep', 'Bar & counter', 73),
  ('kp-074', 'Break ice', 'prep', 'Bar & counter', 74),
  ('kp-075', 'Check sweet chilli onions', 'todo', 'Bar & counter', 75),
  ('kp-076', 'Restock packaging', 'todo', 'Bar & counter', 76),
  ('kp-077', 'Restock drinks', 'todo', 'Bar & counter', 77),
  ('kp-078', 'Check banh mi stock', 'todo', 'Bar & counter', 78),
  ('kp-079', 'Check house mayo', 'todo', 'Bar & counter', 79),
  ('kp-080', 'Restock pickle', 'todo', 'Bar & counter', 80),
  ('kp-081', 'Restock pate', 'todo', 'Bar & counter', 81),
  ('kp-082', 'Restock sauces', 'todo', 'Bar & counter', 82),
  ('kp-083', 'Refill and freeze water containers', 'todo', 'Bar & counter', 83),
  ('kp-084', 'Check mix jugs', 'todo', 'Bar & counter', 84),
  ('kp-085', 'Restock che', 'todo', 'Bar & counter', 85)
on conflict (id) do nothing;

-- The checklist they came from is switched off (kept, as checklists are; it was never run).
update checklist_templates set active = false where id = 'EAS-BAR-PREP';
