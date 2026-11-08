-- Run AFTER schema.sql and the migrations. (Departments are now added by migration_03.)

-- 1) Make YOUR account the first admin (the developer).
--    First create it: Supabase > Authentication > Users > Add user (tick Auto Confirm).
update public.profiles set role = 'admin', approved = true
where id = (select id from auth.users where email = 'YOUR-EMAIL@example.com');

-- 2) Teachers register themselves on login.html; do NOT add them by hand.
--    If you do not want your own account on the board, hide it:
-- update public.teachers set is_active = false
-- where profile_id = (select id from auth.users where email = 'YOUR-EMAIL@example.com');

-- 3) Check the board views.
-- select * from public.departments_board;
-- select * from public.teachers_board;