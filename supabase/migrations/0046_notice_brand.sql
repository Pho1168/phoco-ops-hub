-- A notice "for all sites" is for all the sites of one business (PHO & CO or Cafe La Viet), never both: Cafe La Viet
-- staff must not see PHO & CO's notices. Notices posted to all sites before Cafe La Viet opened were PHO & CO's.
alter table announcements add column if not exists brand text default 'phoco' check (brand in ('phoco', 'clv'));
update announcements set brand = 'phoco' where site_id is null and brand is null;
alter table announcements add constraint announcements_all_sites_brand check (site_id is not null or brand is not null);
