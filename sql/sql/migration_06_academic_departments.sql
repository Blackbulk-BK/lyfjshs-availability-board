-- =====================================================================
-- Migration 06: Official Academic/Admin Departments, Expanded Ranks,
-- and Department-Teacher Roster View.
-- Run in Supabase SQL Editor. Safe to re-run.
-- =====================================================================

-- 1) Update Rank Options (adds Special Science Teacher I-V and ADMIN)
create or replace function public.rank_options() returns text[]
language sql immutable as $$
  select array[
    'Teacher I','Teacher II','Teacher III','Teacher IV','Teacher V','Teacher VI','Teacher VII',
    'Master Teacher I','Master Teacher II','Master Teacher III','Master Teacher IV','Master Teacher V',
    'Special Science Teacher I','Special Science Teacher II','Special Science Teacher III','Special Science Teacher IV','Special Science Teacher V',
    'School Principal I','School Principal II','School Principal III','School Principal IV',
    'ADMIN'
  ];
$$;

-- 2) Keep ONLY the 10 official departments
delete from public.departments
where name not in (
  'ABM', 'ENGLISH', 'HUMSS', 'ICT', 'PE',
  'RESEARCH', 'SCIENCE', 'TVL', 'MATH', 'ADMIN'
);

insert into public.departments (name, category, is_active) values
  ('ABM',      'academic', true),
  ('ENGLISH',  'academic', true),
  ('HUMSS',    'academic', true),
  ('ICT',      'academic', true),
  ('PE',       'academic', true),
  ('RESEARCH', 'academic', true),
  ('SCIENCE',  'academic', true),
  ('TVL',      'academic', true),
  ('MATH',     'academic', true),
  ('ADMIN',    'admin',    true)
on conflict (name) do update
  set category  = excluded.category,
      is_active = true,
      building  = null,
      floor_level = null;

-- 3) Upgrade departments_board view to include structured assigned_teachers
drop view if exists public.departments_board;

create view public.departments_board with (security_invoker = true) as
select d.id,
       d.name,
       d.category,
       case
         when d.status::text = 'under_maintenance' then 'under_maintenance'
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
              'updated_at', t.updated_at,
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