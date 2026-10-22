-- Cleaning jobs done every few months (the air con every 6 months). Such a job is due `every_months` after it was
-- last done, or on `first_due` until it's first done; it shows on the board 14 days before and the managers get a
-- reminder then. Never "missed": it stays on the board until it's done. Rules in src/lib/domain/cleaning.ts.

alter table cleaning_jobs drop constraint if exists cleaning_jobs_per_check;
alter table cleaning_jobs add constraint cleaning_jobs_per_check check (per in ('week', 'month', 'every'));
alter table cleaning_jobs add column if not exists every_months int check (every_months is null or every_months between 1 and 24);
alter table cleaning_jobs add column if not exists first_due date;
alter table cleaning_jobs drop constraint if exists cleaning_jobs_every_has_dates;
alter table cleaning_jobs add constraint cleaning_jobs_every_has_dates
  check ((per = 'every') = (every_months is not null and first_due is not null));

-- The owner, 22 October 2026: air con every 6 months, first due 6 months from today; the fly killer off the board.
update cleaning_jobs set per = 'every', times = 1, every_months = 6, first_due = '2027-04-22'
  where id in ('EAS-FOH-AIRCON', 'WEM-PROD-AIRCON');
update cleaning_jobs set active = false where id in ('EAS-BOH-FLY', 'WEM-PROD-FLY');
