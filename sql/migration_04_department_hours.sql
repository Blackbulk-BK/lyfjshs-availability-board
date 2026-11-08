-- =====================================================================
-- Migration 04: department opening/closing hours, and a teacher record for
-- accounts created before migration 03 (for example your developer account).
-- Run AFTER migration 03. Safe to re-run.
-- =====================================================================

-- 1) Hours
alter table public.departments add column if not exists open_time time;
alter table public.departments add column if not exists close_time time;
alter table public.departments drop constraint if exists departments_hours_check;
alter table public.departments add constraint departments_hours_check
  check (open_time is null or close_time is null or close_time > open_time);

-- 2) Teachers who handle a department may set its hours. Other columns stay locked.
create or replace function public.guard_columns() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  skip text[] := array['status', 'avatar_path', 'description', 'rank_level', 'open_time', 'close_time'];
  kind public.entity_kind := case tg_table_name when 'teachers' then 'teacher'::public.entity_kind
                                                else 'department'::public.entity_kind end;
begin
  if auth.uid() is not null and not public.is_admin() then
    if (to_jsonb(new) - skip) is distinct from (to_jsonb(old) - skip) then
      raise exception 'Only status, picture, description, rank, and hours can be changed.';
    end if;
    -- Everything except the status needs the owner (a delegate may only change the status).
    if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status')
       and not public.is_owner(kind, old.id) then
      raise exception 'Only the owner can change this.';
    end if;
  end if;
  return new;
end;
$$;

-- 3) Board view now includes the hours (new columns go last)
create or replace view public.departments_board with (security_invoker = true) as
select d.id,
       d.name,
       d.category,
       case when d.status is null or d.updated_at is null
              or (d.updated_at at time zone public.school_tz())::date
                 <> (now() at time zone public.school_tz())::date
            then 'not_updated' else d.status::text end as display_status,
       d.updated_at,
       d.building,
       d.floor_level,
       (select string_agg(t.full_name, ', ' order by t.full_name)
          from public.department_staff ds join public.teachers t on t.id = ds.teacher_id
         where ds.department_id = d.id and t.is_active) as handlers,
       d.open_time,
       d.close_time
from public.departments d
where d.is_active;

-- 4) Give every older account a teacher record (this fixes "Your account has no teacher record").
insert into public.teachers (profile_id, full_name)
select p.id, p.full_name from public.profiles p
where not exists (select 1 from public.teachers t where t.profile_id = p.id);

-- Check: select full_name, profile_id from public.teachers;