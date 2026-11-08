-- =====================================================================
-- Migration 03: teachers register themselves (NO admin approval) with rank,
-- description, and the departments they handle. Run AFTER migrations 01 and 02.
-- Safe to re-run.
-- =====================================================================

-- 1) Accounts are active right away. (The developer can still block one by setting approved = false.)
alter table public.profiles alter column approved set default true;
update public.profiles set approved = true;

-- 2) Rank list (edit here if the school adds ranks).
create or replace function public.rank_options() returns text[]
language sql immutable as $$
  select array[
    'Teacher I','Teacher II','Teacher III','Teacher IV','Teacher V','Teacher VI','Teacher VII',
    'Master Teacher I','Master Teacher II','Master Teacher III','Master Teacher IV','Master Teacher V',
    'School Principal I','School Principal II','School Principal III','School Principal IV'];
$$;

-- 3) New teacher fields
alter table public.teachers add column if not exists rank_level text;
alter table public.teachers add column if not exists description text;
alter table public.teachers drop constraint if exists teachers_rank_check;
alter table public.teachers add constraint teachers_rank_check
  check (rank_level is null or rank_level = any (public.rank_options()));
alter table public.teachers drop constraint if exists teachers_description_len;
alter table public.teachers add constraint teachers_description_len
  check (description is null or char_length(description) <= 500);

-- 4) Where each department is
alter table public.departments add column if not exists building text;
alter table public.departments add column if not exists floor_level text;

-- 5) Which teachers handle which departments
create table if not exists public.department_staff (
  department_id uuid not null references public.departments (id) on delete cascade,
  teacher_id    uuid not null references public.teachers (id) on delete cascade,
  primary key (department_id, teacher_id)
);
alter table public.department_staff enable row level security;
drop policy if exists staff_read on public.department_staff;
drop policy if exists staff_insert on public.department_staff;
drop policy if exists staff_delete on public.department_staff;
create policy staff_read on public.department_staff for select using (true);
create policy staff_insert on public.department_staff for insert to authenticated
  with check (public.is_admin() or (public.is_approved() and exists (
    select 1 from public.teachers t where t.id = teacher_id and t.profile_id = auth.uid())));
create policy staff_delete on public.department_staff for delete to authenticated
  using (public.is_admin() or (public.is_approved() and exists (
    select 1 from public.teachers t where t.id = teacher_id and t.profile_id = auth.uid())));

-- 6) A department's owners are the teachers who handle it (or an admin).
create or replace function public.is_owner(kind public.entity_kind, eid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
    or (public.is_approved() and (
         (kind = 'teacher' and exists (
            select 1 from public.teachers t where t.id = eid and t.profile_id = auth.uid()))
      or (kind = 'department' and exists (
            select 1 from public.department_staff ds
            join public.teachers t on t.id = ds.teacher_id
            where ds.department_id = eid and t.profile_id = auth.uid()))));
$$;

-- Only the developer (admin) adds departments now.
drop policy if exists departments_insert on public.departments;
create policy departments_insert on public.departments for insert to authenticated
  with check (public.is_admin());

-- 7) Teachers may change their status, picture, description, and rank. Nothing else.
create or replace function public.guard_columns() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  skip text[] := array['status', 'avatar_path', 'description', 'rank_level'];
  rest_changed boolean := (to_jsonb(new) - skip) is distinct from (to_jsonb(old) - skip);
  profile_changed boolean :=
    (to_jsonb(new) ->> 'avatar_path', to_jsonb(new) ->> 'description', to_jsonb(new) ->> 'rank_level')
    is distinct from
    (to_jsonb(old) ->> 'avatar_path', to_jsonb(old) ->> 'description', to_jsonb(old) ->> 'rank_level');
begin
  if auth.uid() is not null and not public.is_admin() then
    if rest_changed then
      raise exception 'Only your status, picture, description, and rank can be changed.';
    end if;
    if profile_changed and tg_table_name = 'teachers'
       and not public.is_owner('teacher', old.id) then
      raise exception 'Only the teacher can change their own profile.';
    end if;
  end if;
  return new;
end;
$$;

-- 8) Sign-up creates the profile, the teacher record, and the handled departments.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  nm   text  := coalesce(nullif(trim(meta ->> 'full_name'), ''), new.email);
  rk   text  := meta ->> 'rank_level';
  tid  uuid;
begin
  insert into public.profiles (id, full_name) values (new.id, nm);
  if rk is null or not (rk = any (public.rank_options())) then rk := null; end if;
  insert into public.teachers (profile_id, full_name, rank_level, description)
  values (new.id, nm, rk, left(nullif(trim(meta ->> 'description'), ''), 500))
  returning id into tid;
  if jsonb_typeof(meta -> 'departments') = 'array' then
    insert into public.department_staff (department_id, teacher_id)
    select d.id, tid from public.departments d
    where d.id::text in (select jsonb_array_elements_text(meta -> 'departments'))
    on conflict do nothing;
  end if;
  return new;
end;
$$;

-- 9) Board views (new columns go last)
create or replace view public.teachers_board with (security_invoker = true) as
select t.id,
       t.full_name as name,
       case when t.status is null or t.updated_at is null
              or (t.updated_at at time zone public.school_tz())::date
                 <> (now() at time zone public.school_tz())::date
            then 'not_updated' else t.status::text end as display_status,
       t.updated_at,
       t.avatar_path,
       t.rank_level,
       t.description,
       (select string_agg(d.name, ', ' order by d.name)
          from public.department_staff ds join public.departments d on d.id = ds.department_id
         where ds.teacher_id = t.id and d.is_active) as handles
from public.teachers t
where t.is_active;

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
         where ds.department_id = d.id and t.is_active) as handlers
from public.departments d
where d.is_active;

-- 10) The school's departments. Earlier sample rows are renamed or updated, not duplicated.
update public.departments set name = 'Supply Room'
 where name = 'Stockroom' and not exists (select 1 from public.departments where name = 'Supply Room');

insert into public.departments (name, category, building, floor_level) values
  ('Resource Room | Home Economics 4 (Laboratory)', 'other',        'TVL Building',  '1st floor'),
  ('Home Economics 3 (Laboratory)',                 'other',        'TVL Building',  '1st floor'),
  ('Home Economics 2 (Laboratory)',                 'other',        'TVL Building',  '1st floor'),
  ('Home Economics 1 (Laboratory)',                 'other',        'TVL Building',  '1st floor'),
  ('Computer Laboratory 1',                         'computer_lab', 'TVL Building',  '2nd floor'),
  ('Computer Laboratory 2',                         'computer_lab', 'TVL Building',  '2nd floor'),
  ('Computer Laboratory 3',                         'computer_lab', 'TVL Building',  '2nd floor'),
  ('Electrical Installation Maintenance (Laboratory)', 'other',     'TVL Building',  '3rd floor'),
  ('CSS Lab',                                       'computer_lab', 'TVL Building',  '3rd floor'),
  ('Technical Drafting',                            'other',        'TVL Building',  '3rd floor'),
  ('Library',                                       'library',      'ACAD Building', '1st floor'),
  ('Resource Room',                                 'other',        'ACAD Building', '1st floor'),
  ('Clinic',                                        'clinic',       'ACAD Building', '1st floor'),
  ('Supply Room',                                   'stockroom',    'ACAD Building', '1st floor')
on conflict (name) do update
  set category = excluded.category, building = excluded.building, floor_level = excluded.floor_level;

-- Check:
-- select name, building, floor_level from public.departments_board order by building, floor_level, name;