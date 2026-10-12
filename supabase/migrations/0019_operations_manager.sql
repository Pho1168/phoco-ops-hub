-- Operations manager ('ops'): runs a group of sites, above the site managers and below the owner. Set per site like
-- every role. At those sites they do everything a manager does, plus the overview, staff and manager accounts, and
-- the shop tablets, on their own phone or laptop too. Closing sites, rota sheet connections, right to work and owner
-- and operations manager accounts stay with the owner (enforced in the app). One statement, so the old check is
-- never gone without the new one.
alter table person_sites
  drop constraint if exists person_sites_role_check,
  add constraint person_sites_role_check check (role in ('owner', 'ops', 'manager', 'staff'));
