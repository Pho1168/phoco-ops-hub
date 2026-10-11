-- Paid hours for each shift, from the rota sheet's Export tab (shift length minus break).
-- Shown to owners and managers on the team rota. Filled in by the next rota sync.
alter table shifts add column if not exists paid_hours numeric(5,2) check (paid_hours is null or (paid_hours >= 0 and paid_hours <= 24));
