-- =====================================================================
-- Migration 07: Restore Facilities + Allow Teachers to Add Missing Facilities
-- Run in Supabase SQL Editor. Safe to re-run.
-- =====================================================================

-- 1) Ensure the 10 official departments exist
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
      is_active = true;

-- 2) Restore school facilities (Clinic, Library, Computer Laboratories, etc.)
insert into public.departments (name, category, building, floor_level, is_active) values
  ('Clinic',                'facility', 'Main Building', 'Ground Floor', true),
  ('Library',               'facility', 'Main Building', '2nd Floor',    true),
  ('Computer Laboratory 1', 'facility', 'ICT Building',  '1st Floor',    true),
  ('Computer Laboratory 2', 'facility', 'ICT Building',  '2nd Floor',    true),
  ('Science Laboratory',    'facility', 'ACAD Building', '2nd Floor',    true),
  ('TVL Workshop Room',     'facility', 'TVL Building',  '1st Floor',    true),
  ('Supply Room',           'facility', 'Main Building', 'Ground Floor', true),
  ('Guidance Office',       'facility', 'Main Building', 'Ground Floor', true)
on conflict (name) do update
  set category    = excluded.category,
      building    = excluded.building,
      floor_level = excluded.floor_level,
      is_active   = true;

-- 3) Allow approved teachers to add a missing facility (category = 'facility')
drop policy if exists "departments_insert_facility" on public.departments;
create policy "departments_insert_facility" on public.departments
  for insert to authenticated
  with check (public.is_approved() and category = 'facility');