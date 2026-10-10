-- Temporary PINs: set when an owner adds a person or resets their PIN.
-- The person must choose their own PIN before they can use the app.
alter table people add column if not exists pin_must_change boolean not null default false;
