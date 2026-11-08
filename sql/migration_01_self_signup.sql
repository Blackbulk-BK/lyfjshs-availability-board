-- =====================================================================
-- Migration 01: teachers sign up themselves (Gmail or school email).
-- Run ONCE, after schema.sql. New accounts start UNAPPROVED and can do
-- nothing until an admin approves them. Students never need an account.
-- =====================================================================

alter table public.profiles add column approved boolean not null default false;

-- Accounts that already exist as admins stay usable.
update public.profiles set approved = true where role = 'admin';

create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and approved);
$$;

-- Only approved accounts can own or manage anything.
create or replace function public.is_owner(kind public.entity_kind, eid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
    or (public.is_approved() and (
          (kind = 'teacher' and exists (
             select 1 from public.teachers t where t.id = eid and t.profile_id = auth.uid()))
       or (kind = 'department' and exists (
             select 1 from public.departments d where d.id = eid and d.created_by = auth.uid()))));
$$;

create or replace function public.can_manage(kind public.entity_kind, eid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner(kind, eid)
    or (public.is_approved() and exists (
          select 1 from public.status_managers sm
          where sm.entity_type = kind and sm.entity_id = eid and sm.user_id = auth.uid()));
$$;

-- Only approved teachers (or admins) may add a department.
drop policy departments_insert on public.departments;
create policy departments_insert on public.departments for insert to authenticated
  with check (public.is_admin() or (public.is_approved() and created_by = auth.uid()));

-- Check: your admin row should show approved = true.
-- select full_name, role, approved from public.profiles;