-- =====================================================================
-- LYFJSHS Availability Board: database schema (Supabase / PostgreSQL)
-- Run ONCE in Supabase: SQL Editor > New query > paste all > Run.
-- =====================================================================

-- ---------- Types ----------
create type public.user_role as enum ('admin', 'teacher');
create type public.availability_status as enum ('available', 'unavailable');
create type public.entity_kind as enum ('teacher', 'department');

-- ---------- Tables ----------
create table public.settings (
  key   text primary key,
  value text not null
);
insert into public.settings (key, value) values ('timezone', 'Asia/Manila');

-- One profile per login account. Delegates are ordinary 'teacher' accounts.
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null,
  role       public.user_role not null default 'teacher',
  created_at timestamptz not null default now()
);

create table public.teachers (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles (id) on delete set null,
  full_name  text not null,
  status     public.availability_status,          -- null until first update
  updated_at timestamptz,
  updated_by uuid references public.profiles (id) on delete set null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.departments (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  category   text not null default 'other',        -- clinic, library, stockroom, computer_lab, other
  status     public.availability_status,
  updated_at timestamptz,
  updated_by uuid references public.profiles (id) on delete set null,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- Delegates: who may update a teacher/department besides its owner and admins.
create table public.status_managers (
  id          uuid primary key default gen_random_uuid(),
  entity_type public.entity_kind not null,
  entity_id   uuid not null,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (entity_type, entity_id, user_id)
);

-- Append-only history, filled by a trigger. Evidence for testing (SOP 3).
create table public.status_log (
  id          bigint generated always as identity primary key,
  entity_type public.entity_kind not null,
  entity_id   uuid not null,
  old_status  public.availability_status,
  new_status  public.availability_status,
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);
create index on public.status_log (entity_type, entity_id, changed_at desc);
create index on public.status_managers (user_id);

-- ---------- Helper functions ----------
create function public.school_tz() returns text
language sql stable as $$
  select coalesce((select value from public.settings where key = 'timezone'), 'Asia/Manila');
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Owner = admin, the teacher themself, or the department's creator.
create function public.is_owner(kind public.entity_kind, eid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
    or (kind = 'teacher' and exists (
          select 1 from public.teachers t where t.id = eid and t.profile_id = auth.uid()))
    or (kind = 'department' and exists (
          select 1 from public.departments d where d.id = eid and d.created_by = auth.uid()));
$$;

-- Can update status = owner or an assigned delegate.
create function public.can_manage(kind public.entity_kind, eid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner(kind, eid)
    or exists (select 1 from public.status_managers sm
               where sm.entity_type = kind and sm.entity_id = eid and sm.user_id = auth.uid());
$$;

-- ---------- Triggers ----------
-- 1) Non-admins may change ONLY the status (blocks renaming, forged timestamps).
create function public.guard_columns() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
      raise exception 'Only the status can be changed by non-admin users.';
    end if;
  end if;
  return new;
end;
$$;

-- 2) Whenever status is set, stamp the time and who did it, and log it.
create function public.stamp_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  insert into public.status_log (entity_type, entity_id, old_status, new_status, changed_by)
  values (
    case tg_table_name when 'teachers' then 'teacher'::public.entity_kind
                       else 'department'::public.entity_kind end,
    new.id, old.status, new.status, auth.uid());
  return new;
end;
$$;

create trigger t1_guard before update on public.teachers
  for each row execute function public.guard_columns();
create trigger t2_stamp before update of status on public.teachers
  for each row execute function public.stamp_status();
create trigger t1_guard before update on public.departments
  for each row execute function public.guard_columns();
create trigger t2_stamp before update of status on public.departments
  for each row execute function public.stamp_status();

-- 3) Every new login account gets a profile automatically.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Views: the ONE place the "Status Not Updated" rule lives ----------
-- Rule: a status is valid only for the school day (Philippine time) on which it was set.
create view public.teachers_board with (security_invoker = true) as
select t.id,
       t.full_name as name,
       case when t.status is null or t.updated_at is null
              or (t.updated_at at time zone public.school_tz())::date
                 <> (now() at time zone public.school_tz())::date
            then 'not_updated' else t.status::text end as display_status,
       t.updated_at
from public.teachers t
where t.is_active;

create view public.departments_board with (security_invoker = true) as
select d.id,
       d.name,
       d.category,
       case when d.status is null or d.updated_at is null
              or (d.updated_at at time zone public.school_tz())::date
                 <> (now() at time zone public.school_tz())::date
            then 'not_updated' else d.status::text end as display_status,
       d.updated_at
from public.departments d
where d.is_active;

grant select on public.teachers_board, public.departments_board to anon, authenticated;

-- ---------- Row Level Security ----------
alter table public.settings        enable row level security;
alter table public.profiles        enable row level security;
alter table public.teachers        enable row level security;
alter table public.departments     enable row level security;
alter table public.status_managers enable row level security;
alter table public.status_log      enable row level security;

-- settings: everyone reads, admin writes
create policy settings_read  on public.settings for select using (true);
create policy settings_admin on public.settings for all
  using (public.is_admin()) with check (public.is_admin());

-- profiles: see your own, admin sees and edits all
create policy profiles_read  on public.profiles for select
  using (id = auth.uid() or public.is_admin());
create policy profiles_admin on public.profiles for update
  using (public.is_admin()) with check (public.is_admin());

-- teachers: public read; admin creates/deletes; owner/delegate/admin update status
create policy teachers_read   on public.teachers for select using (true);
create policy teachers_insert on public.teachers for insert with check (public.is_admin());
create policy teachers_update on public.teachers for update
  using (public.can_manage('teacher', id)) with check (public.can_manage('teacher', id));
create policy teachers_delete on public.teachers for delete using (public.is_admin());

-- departments: public read; any logged-in teacher may add one (becomes its owner)
create policy departments_read   on public.departments for select using (true);
create policy departments_insert on public.departments for insert to authenticated
  with check (public.is_admin() or created_by = auth.uid());
create policy departments_update on public.departments for update
  using (public.can_manage('department', id)) with check (public.can_manage('department', id));
create policy departments_delete on public.departments for delete using (public.is_admin());

-- delegates: only owners/admins assign or remove
create policy managers_read on public.status_managers for select to authenticated
  using (public.is_admin() or user_id = auth.uid() or assigned_by = auth.uid());
create policy managers_insert on public.status_managers for insert to authenticated
  with check (public.is_owner(entity_type, entity_id) and assigned_by = auth.uid());
create policy managers_delete on public.status_managers for delete to authenticated
  using (public.is_owner(entity_type, entity_id));

-- history: admin reads; nobody writes directly (the trigger does)
create policy log_read on public.status_log for select using (public.is_admin());

-- ---------- Realtime (live updates on open boards) ----------
alter publication supabase_realtime add table public.teachers, public.departments;