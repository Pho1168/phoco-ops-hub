-- Staff certificates and checks: food hygiene, allergens, first aid, right to work and so on. The app keeps
-- what was done and when it runs out, not copies of documents. Nothing is deleted: a record added by mistake
-- is marked removed, with who removed it and when.
create table if not exists staff_certificates (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references people(id),
  kind        text not null check (kind in ('food_hygiene_l2', 'food_hygiene_l3', 'allergen', 'first_aid', 'fire_marshal',
                                             'health_safety', 'manual_handling', 'coshh', 'personal_licence', 'right_to_work')),
  issued_on   date not null,
  expires_on  date,
  provider    text check (char_length(provider) <= 120),
  reference   text check (char_length(reference) <= 120),
  note        text check (char_length(note) <= 300),
  created_by  uuid not null references people(id),
  created_at  timestamptz not null default now(),
  removed_at  timestamptz,
  removed_by  uuid references people(id),
  check (expires_on is null or expires_on >= issued_on),
  -- document numbers for right to work stay off the app
  check (kind <> 'right_to_work' or reference is null)
);
create index if not exists staff_certificates_person on staff_certificates (person_id) where removed_at is null;
alter table staff_certificates enable row level security;
