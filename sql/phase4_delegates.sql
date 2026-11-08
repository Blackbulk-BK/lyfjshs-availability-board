-- =====================================================================
-- Phase 4: Status Delegation (Let someone else update this for me)
-- Enables teachers and department owners to delegate update permissions
-- to another verified faculty or staff member.
-- Safe to re-run in Supabase SQL Editor.
-- =====================================================================

-- 1) Function to list active accounts that can be assigned as delegates
create or replace function public.assignable_users()
returns table (id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select id, full_name
  from public.profiles
  where approved = true
  order by full_name;
$$;

grant execute on function public.assignable_users() to authenticated;

-- 2) Update status_managers RLS policies so owners can manage delegates properly
alter table public.status_managers enable row level security;

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
