-- Who each handover item is for. Anyone on a site tablet can give a prep item, or a note that needs doing, to
-- someone who works at the site, or change who it's for, at any time; anyone can still tick it done. assigned_by and
-- assigned_at say who last changed it and when (every change is also in the activity log). assigned_to is null when
-- it's for nobody in particular: never given, or taken off someone. An item carried into a newer handover keeps all
-- three. Rules in src/lib/domain/assign.ts.

alter table prep_entries
  add column if not exists assigned_to uuid references people(id),
  add column if not exists assigned_by uuid references people(id),
  add column if not exists assigned_at timestamptz;
alter table prep_entries drop constraint if exists prep_entries_assigned_check;
alter table prep_entries add constraint prep_entries_assigned_check
  check ((assigned_by is null) = (assigned_at is null) and (assigned_to is null or assigned_by is not null));

alter table handover_items
  add column if not exists assigned_to uuid references people(id),
  add column if not exists assigned_by uuid references people(id),
  add column if not exists assigned_at timestamptz;
alter table handover_items drop constraint if exists handover_items_assigned_check;
alter table handover_items add constraint handover_items_assigned_check
  check ((assigned_by is null) = (assigned_at is null) and (assigned_to is null or assigned_by is not null));

-- What's waiting for someone: their reminders and My shifts.
create index if not exists prep_entries_assigned on prep_entries (assigned_to) where status = 'outstanding' and assigned_to is not null;
create index if not exists handover_items_assigned on handover_items (assigned_to) where closed_at is null and assigned_to is not null;
