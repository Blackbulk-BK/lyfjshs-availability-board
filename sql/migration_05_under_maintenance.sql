-- =====================================================================
-- Migration 05: Add 'under_maintenance' status & delegate management
-- Safe to re-run in Supabase SQL Editor.
-- =====================================================================

-- 1) Extend public.availability_status enum type with 'under_maintenance'
alter type public.availability_status add value if not exists 'under_maintenance';

-- 2) Update departments_board view
-- Note: Uses d.status::text = 'under_maintenance' to avoid PostgreSQL error 55P04
-- (unsafe use of new enum value in the same transaction).
create or replace view public.departments_board with (security_invoker = true) as
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
       d.close_time
from public.departments d
where d.is_active;

grant select on public.departments_board to anon, authenticated;

-- 3) Function for delegates: lists verified users who can be assigned (fixes "Could not load delegates")
create or replace function public.assignable_users()
returns table (id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select id, full_name
  from public.profiles
  where approved = true
  order by full_name;
$$;

grant execute on function public.assignable_users() to authenticated;

-- 4) Allow owners to view and manage delegates for their departments and teachers
drop policy if exists managers_read on public.status_managers;
create policy managers_read on public.status_managers for select to authenticated
  using (
    public.is_admin()
    or user_id = auth.uid()
    or assigned_by = auth.uid()
    or public.is_owner(entity_type, entity_id)
  );

drop policy if exists managers_insert on public.status_managers;
create policy managers_insert on public.status_managers for insert to authenticated
  with check (
    public.is_admin()
    or (public.is_owner(entity_type, entity_id) and assigned_by = auth.uid())
  );

drop policy if exists managers_delete on public.status_managers;
create policy managers_delete on public.status_managers for delete to authenticated
  using (
    public.is_admin()
    or public.is_owner(entity_type, entity_id)
  );
