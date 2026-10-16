-- Unticking. A tick on Stock needed (or on a driver's list) is saved at once and stays on the list, crossed out, until
-- 05:00, with Untick. Records are only added, so an untick never deletes or changes the tick: it adds what puts the item
-- back. A bought or sent item gets a new request for the same restaurant, product and amount (reopens_line: the line
-- it puts back); on a driver's list it also gets a new line on the same list (redoes: the line it replaces). Each line
-- can be unticked once (unique). Rules in src/lib/domain/stock.ts (untickedLines, canUntick).

alter table stock_requests add column if not exists reopens_line uuid references stock_task_lines (id);
create unique index if not exists stock_requests_reopens_line on stock_requests (reopens_line) where reopens_line is not null;

alter table stock_task_lines add column if not exists redoes uuid references stock_task_lines (id);
create unique index if not exists stock_task_lines_redoes on stock_task_lines (redoes) where redoes is not null;

-- A request keeps what was reported, and what it puts back.
create or replace function stock_request_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'stock records are kept' using errcode = 'check_violation'; end if;
  if old.cancelled_at is not null then raise exception 'that request is cancelled' using errcode = 'check_violation'; end if;
  if row(new.id, new.code, new.site_id, new.product_id, new.level, new.qty, new.note, new.photo_id, new.report_id, new.requested_by, new.created_at, new.reopens_line)
       is distinct from row(old.id, old.code, old.site_id, old.product_id, old.level, old.qty, old.note, old.photo_id, old.report_id, old.requested_by, old.created_at, old.reopens_line) then
    raise exception 'a request keeps what was reported' using errcode = 'check_violation';
  end if;
  return new;
end $$;
