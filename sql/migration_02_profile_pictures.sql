-- =====================================================================
-- Migration 02: teacher profile pictures (maximum 2 MB).
-- Run AFTER schema.sql and migration_01_self_signup.sql (it needs is_approved()). Safe to re-run.
-- =====================================================================

-- 1) Where the picture is stored (a path inside the 'avatars' bucket).
alter table public.teachers add column if not exists avatar_path text;

-- 2) Non-admins may change ONLY the status, plus their OWN picture.
create or replace function public.guard_columns() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rest_changed   boolean := (to_jsonb(new) - 'status' - 'avatar_path')
                            is distinct from (to_jsonb(old) - 'status' - 'avatar_path');
  avatar_changed boolean := (to_jsonb(new) ->> 'avatar_path')
                            is distinct from (to_jsonb(old) ->> 'avatar_path');
begin
  if auth.uid() is not null and not public.is_admin() then
    if rest_changed then
      raise exception 'Only the status and your own picture can be changed.';
    end if;
    if avatar_changed and tg_table_name = 'teachers'
       and not public.is_owner('teacher', old.id) then
      raise exception 'Only the teacher can change their own picture.';
    end if;
  end if;
  return new;
end;
$$;

-- 3) The public board view now includes the picture path (new column goes last).
create or replace view public.teachers_board with (security_invoker = true) as
select t.id,
       t.full_name as name,
       case when t.status is null or t.updated_at is null
              or (t.updated_at at time zone public.school_tz())::date
                 <> (now() at time zone public.school_tz())::date
            then 'not_updated' else t.status::text end as display_status,
       t.updated_at,
       t.avatar_path
from public.teachers t
where t.is_active;

-- 4) Storage bucket: public, 2 MB limit, images only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 5) Storage rules: files live in a folder named after the user's id.
--    Anyone can VIEW pictures (public bucket). Only an approved user can
--    upload into their OWN folder. Admins can also remove pictures.
drop policy if exists avatars_select on storage.objects;
drop policy if exists avatars_insert on storage.objects;
drop policy if exists avatars_update on storage.objects;
drop policy if exists avatars_delete on storage.objects;

create policy avatars_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and public.is_approved()
              and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and public.is_approved()
              and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- Check: select name, avatar_path from public.teachers_board;