-- Run AFTER schema.sql. Edit names to match your school, then Run.

-- 1) Starting departments (the four units in the questionnaire).
insert into public.departments (name, category) values
  ('Clinic',               'clinic'),
  ('Library',              'library'),
  ('Stockroom',            'stockroom'),
  ('Computer Laboratory 1','computer_lab'),
  ('Computer Laboratory 2','computer_lab');

-- 2) Make YOUR account the first admin.
--    First create it: Supabase > Authentication > Users > Add user (tick Auto Confirm).
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'YOUR-EMAIL@example.com');

-- 3) Add a teacher (repeat per teacher, or import many later with tools/import_data.py).
--    Link profile_id only for teachers who have a login account.
-- insert into public.teachers (full_name) values ('Teacher Full Name');
-- insert into public.teachers (full_name, profile_id)
--   values ('Teacher With Account', (select id from auth.users where email = 'teacher@example.com'));

-- 4) Check the board views.
-- select * from public.departments_board;
-- select * from public.teachers_board;