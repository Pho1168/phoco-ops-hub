-- Sites the owner adds: codes are no longer a fixed list in the app. The order sites are shown in is a column, so a
-- new one goes last. Codes stay 2–5 capital letters; records are keyed by them and they never change.
alter table sites add column if not exists position integer not null default 100;
update sites set position = case id when 'EAS' then 1 when 'WEM' then 2 when 'SYD' then 3 else position end where position = 100;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sites_id_format') then
    alter table sites add constraint sites_id_format check (id ~ '^[A-Z]{2,5}$');
  end if;
end $$;
