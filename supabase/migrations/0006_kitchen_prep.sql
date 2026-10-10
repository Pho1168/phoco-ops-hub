-- Kitchen prep handover.
-- One master list (prep_items) shared by every restaurant; prep_sites switches the board on per site.
-- A handover is a draft while the outgoing shift taps what's needed, then it is submitted. Its entries keep
-- who asked, who completed and when. Outstanding entries carry into the next handover (status 'carried'),
-- so nothing is deleted once a handover is submitted.

create table prep_items (
  id         text primary key,                 -- stable: never reuse or renumber
  name       text not null,
  category   text not null check (category in ('cooking','fresh','sauces','defrost','drinks')),
  position   int  not null,
  active     boolean not null default true,    -- retire with active = false; never delete a referenced item
  created_at timestamptz not null default now(),
  retired_at timestamptz
);

create table prep_sites (
  site_id    text primary key references sites(id),
  enabled_at timestamptz not null default now()
);

create table prep_handovers (
  id            uuid primary key default gen_random_uuid(),
  site_id       text not null references sites(id),
  shift         text not null check (shift in ('next','tomorrow_am','tomorrow_pm')),
  status        text not null default 'draft' check (status in ('draft','submitted')),
  created_by    uuid not null references people(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  submitted_by  uuid references people(id),
  submitted_at  timestamptz,
  stocked_count int,                            -- items the outgoing shift confirmed as stocked
  check ((status = 'submitted') = (submitted_at is not null))
);
create unique index prep_handovers_one_draft on prep_handovers (site_id) where status = 'draft';
create index prep_handovers_site on prep_handovers (site_id, submitted_at desc);

create table prep_entries (
  id           uuid primary key default gen_random_uuid(),
  handover_id  uuid not null references prep_handovers(id),
  site_id      text not null references sites(id),
  item_id      text not null references prep_items(id),
  status       text not null default 'outstanding' check (status in ('outstanding','completed','carried')),
  urgent       boolean not null default false,
  note         text check (char_length(note) <= 200),
  carried_from uuid references prep_entries(id),
  created_by   uuid not null references people(id),
  created_at   timestamptz not null default now(),
  completed_by uuid references people(id),
  completed_at timestamptz,
  unique (handover_id, item_id)                 -- one entry per item per handover
);
create index prep_entries_outstanding on prep_entries (site_id) where status = 'outstanding';

-- Guards: entries stay with their handover's site; once a handover is submitted its entries can't be removed
-- or re-pointed (only their status and completion change), and the handover can't go back to draft or be deleted.
create or replace function prep_entries_guard() returns trigger language plpgsql set search_path = '' as $$
declare h_site text; h_status text;
begin
  select site_id, status into h_site, h_status from public.prep_handovers
    where id = case when tg_op = 'DELETE' then old.handover_id else new.handover_id end;
  if tg_op = 'INSERT' then
    if new.site_id <> h_site then raise exception 'prep entry site does not match its handover'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if h_status = 'submitted' then raise exception 'prep_entries of a submitted handover are kept: complete them instead'; end if;
    return old;
  end if;
  if new.handover_id <> old.handover_id or new.site_id <> old.site_id or new.item_id <> old.item_id
     or new.created_by <> old.created_by or new.created_at <> old.created_at then
    raise exception 'prep entries cannot be moved to another handover, site or item';
  end if;
  return new;
end $$;
create trigger prep_entries_guard before insert or update or delete on prep_entries
  for each row execute function prep_entries_guard();

create or replace function prep_handovers_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'submitted' then raise exception 'submitted prep handovers are kept'; end if;
    return old;
  end if;
  if old.status = 'submitted' and (new.status <> 'submitted' or new.site_id <> old.site_id or new.submitted_at <> old.submitted_at) then
    raise exception 'a submitted prep handover cannot be changed';
  end if;
  return new;
end $$;
create trigger prep_handovers_guard before update or delete on prep_handovers
  for each row execute function prep_handovers_guard();

alter table prep_items enable row level security;
alter table prep_sites enable row level security;
alter table prep_handovers enable row level security;
alter table prep_entries enable row level security;

-- The master list. Same list as PREP_MASTER in src/lib/domain/prep.ts.
insert into prep_items (id, name, category, position) values
  ('kp-001', 'Change oil – left', 'cooking', 1),
  ('kp-002', 'Change oil – right', 'cooking', 2),
  ('kp-003', 'Change oil – large fryer', 'cooking', 3),
  ('kp-004', 'Cook bun', 'cooking', 4),
  ('kp-005', 'Cook prawns', 'cooking', 5),
  ('kp-006', 'Soak pho noodles', 'cooking', 6),
  ('kp-007', 'Cook rice', 'cooking', 7),
  ('kp-008', 'Smash ice', 'cooking', 8),
  ('kp-009', 'Fry chicken wings', 'cooking', 9),
  ('kp-010', 'Fry chicken bombs', 'cooking', 10),
  ('kp-011', 'Fry chicken thigh', 'cooking', 11),
  ('kp-012', 'Marinated chicken thigh', 'cooking', 12),
  ('kp-013', 'Marinated wings', 'cooking', 13),
  ('kp-014', 'Banh mi – sausage', 'cooking', 14),
  ('kp-015', 'Banh mi – char siu', 'cooking', 15),
  ('kp-016', 'Banh mi – cold pork fat', 'cooking', 16),
  ('kp-017', 'Vegetarian pho', 'cooking', 17),
  ('kp-018', 'Salad', 'fresh', 18),
  ('kp-019', 'Bun/rice – cucumber', 'fresh', 19),
  ('kp-020', 'Pho – spring onion', 'fresh', 20),
  ('kp-021', 'Pho – onion', 'fresh', 21),
  ('kp-022', 'Pho – coriander', 'fresh', 22),
  ('kp-023', 'Rice – red cabbage', 'fresh', 23),
  ('kp-024', 'Rice – white cabbage', 'fresh', 24),
  ('kp-025', 'Rice – shredded carrot (pickle)', 'fresh', 25),
  ('kp-026', 'Papaya', 'fresh', 26),
  ('kp-027', 'Lime wedges (cut white part in between)', 'fresh', 27),
  ('kp-028', 'Pickles', 'fresh', 28),
  ('kp-029', 'Pickled onions', 'fresh', 29),
  ('kp-030', 'Carrot – papaya', 'fresh', 30),
  ('kp-031', 'Carrot – shred', 'fresh', 31),
  ('kp-032', 'Banh mi/summer roll – spring onion (use shredder tool)', 'fresh', 32),
  ('kp-033', 'Banh mi – red chilli (slices)', 'fresh', 33),
  ('kp-034', 'Banh mi/summer roll – cucumber (long way)', 'fresh', 34),
  ('kp-035', 'Fish sauce', 'sauces', 35),
  ('kp-036', 'Soy sauce', 'sauces', 36),
  ('kp-037', 'Peanut sauce', 'sauces', 37),
  ('kp-038', 'Chilli mayo', 'sauces', 38),
  ('kp-039', 'Egg mayo', 'sauces', 39),
  ('kp-040', 'Crushed peanuts', 'sauces', 40),
  ('kp-041', 'Defrost – banh mi', 'defrost', 41),
  ('kp-042', 'Refill – fish sauce', 'defrost', 42),
  ('kp-043', 'Refill – hoisin/sriracha/chilli oil/chilli mayo', 'defrost', 43),
  ('kp-044', 'Refill – takeaway containers', 'defrost', 44),
  ('kp-045', 'Defrost – prawns', 'defrost', 45),
  ('kp-046', 'Defrost – pho soup', 'defrost', 46),
  ('kp-047', 'Defrost – brisket', 'defrost', 47),
  ('kp-048', 'Defrost – corn chicken', 'defrost', 48),
  ('kp-049', 'Defrost – beef balls', 'defrost', 49),
  ('kp-050', 'Defrost – S/V chicken', 'defrost', 50),
  ('kp-051', 'Defrost – S/V pork', 'defrost', 51),
  ('kp-052', 'Defrost – S/V lamb', 'defrost', 52),
  ('kp-053', 'Defrost – S/V pork chop', 'defrost', 53),
  ('kp-054', 'Defrost – S/V char siu', 'defrost', 54),
  ('kp-055', 'Red bean', 'drinks', 55),
  ('kp-056', 'Black sugar', 'drinks', 56),
  ('kp-057', 'Sugar syrup', 'drinks', 57),
  ('kp-058', 'Grass jelly', 'drinks', 58),
  ('kp-059', 'Sago pearls', 'drinks', 59),
  ('kp-060', 'Basil seed', 'drinks', 60),
  ('kp-061', 'Coffee', 'drinks', 61),
  ('kp-062', 'Lemon tea', 'drinks', 62),
  ('kp-063', 'Lemonade', 'drinks', 63)
on conflict (id) do update set name = excluded.name, category = excluded.category, position = excluded.position, active = true, retired_at = null;

-- Eastcote first. Other restaurants: insert into prep_sites (site_id) values ('...').
insert into prep_sites (site_id) select id from sites where id = 'EAS' on conflict do nothing;
