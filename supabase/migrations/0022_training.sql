-- The Training Academy: skills in pathways (front of house, back of house, production), their quizzes, each
-- pathway's deadlines, when each person started in a section, and an append-only record of what people did (quiz
-- attempts, marking a skill done, a manager confirming it or taking it back). Skills and questions are retired,
-- never deleted; the record is never changed.

create table if not exists training_skills (
  id               uuid primary key default gen_random_uuid(),
  section          text not null check (section in ('FOH', 'BOH', 'PROD')),
  grp              text not null,                          -- the heading it sits under: Operations, Service…
  position         integer not null check (position > 0),  -- its place in the pathway
  title            text not null,
  about            text not null default '',
  hands_on         boolean not null default false,         -- a manager confirms it after watching them do it
  induction        boolean not null default false,         -- due within the pathway's induction days
  links            uuid[] not null default '{}',           -- library documents to read (SOPs, recipes)
  video_url        text check (video_url is null or video_url ~ '^https://'),
  refresher_months integer check (refresher_months between 1 and 60),
  pass_mark        integer not null default 80 check (pass_mark between 50 and 100),
  created_by       uuid not null references people(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  rev              integer not null default 1 check (rev > 0),
  retired_at       timestamptz,
  retired_by       uuid references people(id),
  check ((retired_at is null) = (retired_by is null))
);
create index if not exists training_skills_order on training_skills (section, position);
alter table training_skills enable row level security;

-- A skill is retired, never deleted, and keeps who made it and when.
create or replace function training_skill_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'training skills are retired, never deleted' using errcode = 'check_violation';
  end if;
  if row(new.id, new.created_by, new.created_at) is distinct from row(old.id, old.created_by, old.created_at) then
    raise exception 'a training skill keeps who made it and when' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create or replace trigger training_skills_guard before update or delete on training_skills
  for each row execute function training_skill_guard();

create table if not exists training_questions (
  id          uuid primary key default gen_random_uuid(),
  skill_id    uuid not null references training_skills(id),
  position    integer not null check (position > 0),
  text        text not null,
  options     jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6),
  answer      integer not null check (answer >= 0),
  approved_by uuid references people(id),                 -- a drafted question is only asked once approved
  approved_at timestamptz,
  created_by  uuid not null references people(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  retired_at  timestamptz,
  retired_by  uuid references people(id),
  check (answer < jsonb_array_length(options)),
  check ((approved_at is null) = (approved_by is null)),
  check ((retired_at is null) = (retired_by is null))
);
create index if not exists training_questions_skill on training_questions (skill_id, position);
alter table training_questions enable row level security;

create or replace function training_question_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'training questions are retired, never deleted' using errcode = 'check_violation';
  end if;
  if row(new.id, new.skill_id, new.created_by, new.created_at) is distinct from row(old.id, old.skill_id, old.created_by, old.created_at) then
    raise exception 'a training question stays with its skill' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create or replace trigger training_questions_guard before update or delete on training_questions
  for each row execute function training_question_guard();

-- Each pathway's deadlines, in days from the day someone started in that section.
create table if not exists training_pathways (
  section        text primary key check (section in ('FOH', 'BOH', 'PROD')),
  induction_days integer not null default 7 check (induction_days between 1 and 60),
  all_days       integer not null default 42 check (all_days between 1 and 365),
  updated_by     uuid references people(id),
  updated_at     timestamptz not null default now(),
  check (induction_days <= all_days)
);
insert into training_pathways (section) values ('FOH'), ('BOH'), ('PROD') on conflict (section) do nothing;
alter table training_pathways enable row level security;

-- When someone started in a section: their pathway's deadlines run from then. Added when they're given the section;
-- never changed.
create table if not exists training_starts (
  person_id  uuid not null references people(id),
  section    text not null check (section in ('FOH', 'BOH', 'PROD')),
  started_on date not null,
  primary key (person_id, section)
);
create or replace trigger training_starts_append_only before update or delete on training_starts
  for each row execute function refuse_change();
alter table training_starts enable row level security;
-- Everyone working now starts today, the day training goes live.
insert into training_starts (person_id, section, started_on)
select distinct ps.person_id, s.section, (now() at time zone 'Europe/London')::date
from person_sites ps cross join lateral unnest(ps.sections) as s(section)
where ps.role in ('staff', 'manager') and s.section in ('FOH', 'BOH', 'PROD')
on conflict (person_id, section) do nothing;

-- What people did. A quiz keeps the questions as asked and the answers given (detail).
create table if not exists training_events (
  id        uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id),
  skill_id  uuid not null references training_skills(id),
  kind      text not null check (kind in ('quiz', 'done', 'confirmed', 'reset')),
  at        timestamptz not null default now(),
  by_id     uuid not null references people(id),           -- the person, or the manager who confirmed or took it back
  score     integer check (score between 0 and 100),
  passed    boolean,
  detail    jsonb,
  note      text,
  check ((kind = 'quiz') = (score is not null and passed is not null)),
  check (kind <> 'reset' or note is not null)
);
create index if not exists training_events_person on training_events (person_id, skill_id, at);
create index if not exists training_events_skill on training_events (skill_id);
create or replace trigger training_events_append_only before update or delete on training_events
  for each row execute function refuse_change();
alter table training_events enable row level security;

-- Phone messages: refreshers coming up or due, and skills to do again.
alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in ('published', 'changed', 'evening', 'notice', 'leave', 'cert', 'report', 'fault', 'service', 'task', 'shift', 'reply',
                  'gas', 'ready', 'daily', 'cover', 'training'));
