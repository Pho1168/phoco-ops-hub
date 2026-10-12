-- Right to work checks are private to the owner who asked for them. Being an owner isn't enough: a person needs
-- this flag. It's set for the one owner on the system today; anyone else only if that owner decides.
alter table people add column if not exists sees_right_to_work boolean not null default false;

update people set sees_right_to_work = true
where id in (select person_id from person_sites where role = 'owner')
  and (select count(distinct person_id) from person_sites where role = 'owner') = 1;
