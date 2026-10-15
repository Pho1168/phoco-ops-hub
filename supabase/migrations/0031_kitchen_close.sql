-- Gas off at kitchen close: a site's kitchen-close time. The gas check is due then (button from 15 minutes before,
-- managers alerted 30 minutes after) for everyone still on shift. Null: when the last shift on the rota ends, as before.
alter table sites add column if not exists gas_by time;
-- Eastcote's kitchen closes at 21:30 every day (the owner, 15 Oct 2026).
update sites set gas_by = '21:30' where id = 'EAS' and gas_by is null;
