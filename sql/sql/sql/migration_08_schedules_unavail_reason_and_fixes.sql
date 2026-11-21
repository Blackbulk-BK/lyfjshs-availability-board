-- =====================================================================
-- Migration 08: Teacher Weekly Schedule, Unavailability Reason,
-- Single-Department Enforcement, and No Under Maintenance on Departments
-- Run in Supabase SQL Editor. Safe to re-run.
-- =====================================================================

-- 1) Add schedule (JSONB) and unavailable_reason (TEXT) to teachers
alter table public.teachers
  add column if not exists unavailable_reason text,
  add column if not exists schedule jsonb not null default '{}'::jsonb;

alter table public.teachers
  drop constraint if exists teachers_unavailable_reason_len;
alter table public.teachers
  add constraint teachers_unavailable_reason_len
  check (unavailable_reason is null or char_length(unavailable_reason) <= 200);

-- 2) Remove 'under_maintenance' from academic/admin departments
update public.departments
set status = 'unavailable'
where category in ('academic', 'admin')
  and status::text = 'under_maintenance';

create or replace function public.guard_department_status() returns trigger
language plpgsql as $$
begin
  if new.category in ('academic', 'admin') and new.status::text = 'under_maintenance' then
    raise exception 'Academic and administrative departments cannot be set to under_maintenance.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_department_status on public.departments;
create trigger trg_guard_department_status
  before insert or update of status, category on public.departments
  for each row execute function public.guard_department_status();

-- 3) Enforce that a teacher can belong to ONLY ONE department (academic/admin)
--    while still allowing multiple physical facilities in department_staff.
with ranked_depts as (
  select ds.teacher_id,
         ds.department_id,
         row_number() over (partition by ds.teacher_id order by d.name) as rn
  from public.department_staff ds
  join public.departments d on d.id = ds.department_id
  where d.category in ('academic', 'admin')
)
delete from public.department_staff ds
using ranked_depts rd
where ds.teacher_id = rd.teacher_id
  and ds.department_id = rd.department_id
  and rd.rn > 1;

create or replace function public.enforce_single_teacher_department() returns trigger
language plpgsql as $$
declare
  v_cat text;
begin
  select category into v_cat from public.departments where id = new.department_id;
  if v_cat in ('academic', 'admin') then
    delete from public.department_staff ds
    using public.departments d
    where ds.department_id = d.id
      and ds.teacher_id = new.teacher_id
      and ds.department_id <> new.department_id
      and d.category in ('academic', 'admin');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_single_teacher_department on public.department_staff;
create trigger trg_enforce_single_teacher_department
  before insert or update on public.department_staff
  for each row execute function public.enforce_single_teacher_department();

-- 4) Update teachers_board view with department_name, handles, unavailable_reason, and schedule
drop view if exists public.teachers_board;

create view public.teachers_board with (security_invoker = true) as
select t.id,
       t.full_name as name,
       case
         when t.status is null or t.updated_at is null
              or (t.updated_at at time zone public.school_tz())::date
                 <> (now() at time zone public.school_tz())::date
         then 'not_updated'
         else t.status::text
       end as display_status,
       t.updated_at,
       t.avatar_path,
       t.rank_level,
       t.description,
       t.unavailable_reason,
       t.schedule,
       (select d.name
          from public.department_staff ds join public.departments d on d.id = ds.department_id
         where ds.teacher_id = t.id and d.is_active and d.category in ('academic', 'admin')
         limit 1) as department_name,
       (select string_agg(d.name, ', ' order by d.name)
          from public.department_staff ds join public.departments d on d.id = ds.department_id
         where ds.teacher_id = t.id and d.is_active and d.category = 'facility') as handles
from public.teachers t
where t.is_active;

grant select on public.teachers_board to anon, authenticated;

-- 5) Update departments_board view so assigned_teachers includes schedule, unavailable_reason, description, and facilities
drop view if exists public.departments_board;

create view public.departments_board with (security_invoker = true) as
select d.id,
       d.name,
       d.category,
       case
         when d.category = 'facility' and d.status::text = 'under_maintenance' then 'under_maintenance'
         when d.status is null or d.updated_at is null
              or (d.updated_at at time zone public.school_tz())::date
                 <> (now() at time zone public.school_tz())::date
         then 'not_updated'
         else d.status::text
       end as display_status,
       d.updated_at,
       d.building,
       d.floor_level,
       (select string_agg(t.full_name, ', ' order by t.full_name)
          from public.department_staff ds join public.teachers t on t.id = ds.teacher_id
         where ds.department_id = d.id and t.is_active) as handlers,
       d.open_time,
       d.close_time,
       coalesce(
         (select jsonb_agg(
            jsonb_build_object(
              'id', t.id,
              'name', t.full_name,
              'rank_level', t.rank_level,
              'avatar_path', t.avatar_path,
              'description', t.description,
              'unavailable_reason', t.unavailable_reason,
              'schedule', t.schedule,
              'department_name', d.name,
              'updated_at', t.updated_at,
              'handles', (
                select string_agg(f.name, ', ' order by f.name)
                from public.department_staff ds2 join public.departments f on f.id = ds2.department_id
                where ds2.teacher_id = t.id and f.is_active and f.category = 'facility'
              ),
              'display_status',
                case
                  when t.status is null or t.updated_at is null
                       or (t.updated_at at time zone public.school_tz())::date
                          <> (now() at time zone public.school_tz())::date
                  then 'not_updated'
                  else t.status::text
                end
            )
            order by
              case
                when t.status = 'available'
                     and t.updated_at is not null
                     and (t.updated_at at time zone public.school_tz())::date
                         = (now() at time zone public.school_tz())::date
                then 0 else 1
              end,
              t.full_name
          )
          from public.department_staff ds
          join public.teachers t on t.id = ds.teacher_id
          where ds.department_id = d.id and t.is_active),
         '[]'::jsonb
       ) as assigned_teachers
from public.departments d
where d.is_active;

grant select on public.departments_board to anon, authenticated;