-- 1. Ensure schedule & unavailable_reason columns exist on public.teachers
ALTER TABLE public.teachers
  ADD COLUMN IF NOT EXISTS unavailable_reason text,
  ADD COLUMN IF NOT EXISTS schedule jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2. Add teacher_id to public.profiles matching the exact data type of teachers.id
DO $$
DECLARE
  v_tid_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO v_tid_type
    FROM pg_attribute a
    JOIN pg_class c ON a.attrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
   WHERE n.nspname = 'public'
     AND c.relname = 'teachers'
     AND a.attname = 'id'
     AND a.attnum > 0
     AND NOT a.attisdropped;

  IF v_tid_type IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'profiles'
       AND column_name = 'teacher_id'
  ) THEN
    EXECUTE format(
      'ALTER TABLE public.profiles ADD COLUMN teacher_id %s REFERENCES public.teachers(id) ON DELETE SET NULL',
      v_tid_type
    );
  END IF;
END $$;

-- 3. Backfill profiles.teacher_id if an unlinked teacher row already matches by name or existing link column
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'teachers' AND column_name = 'profile_id'
  ) THEN
    EXECUTE '
      UPDATE public.profiles p
         SET teacher_id = t.id
        FROM public.teachers t
       WHERE t.profile_id = p.id
         AND p.teacher_id IS NULL
    ';
  END IF;

  UPDATE public.profiles p
     SET teacher_id = t.id
    FROM public.teachers t
   WHERE lower(trim(p.full_name)) = lower(trim(t.full_name))
     AND p.teacher_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles p2 WHERE p2.teacher_id = t.id
     );
END $$;

-- 4. RLS policies for public.teachers
DROP POLICY IF EXISTS "teachers_admin_all" ON public.teachers;
CREATE POLICY "teachers_admin_all" ON public.teachers
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin' AND approved = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin' AND approved = true
    )
  );

DROP POLICY IF EXISTS "teachers_self_update" ON public.teachers;
CREATE POLICY "teachers_self_update" ON public.teachers
  FOR UPDATE TO authenticated
  USING (
    id = (
      SELECT teacher_id FROM public.profiles
      WHERE id = auth.uid() AND approved = true
    )
  )
  WITH CHECK (
    id = (
      SELECT teacher_id FROM public.profiles
      WHERE id = auth.uid() AND approved = true
    )
  );

-- 5. RLS policy for public.department_staff (adapts to teacher_id or profile_id)
DO $$
BEGIN
  DROP POLICY IF EXISTS "dept_staff_self_manage" ON public.department_staff;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'department_staff' AND column_name = 'teacher_id'
  ) THEN
    EXECUTE '
      CREATE POLICY "dept_staff_self_manage" ON public.department_staff
        FOR ALL TO authenticated
        USING (
          teacher_id = (
            SELECT teacher_id FROM public.profiles
            WHERE id = auth.uid() AND approved = true
          )
          OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = ''admin'' AND approved = true
          )
        )
        WITH CHECK (
          teacher_id = (
            SELECT teacher_id FROM public.profiles
            WHERE id = auth.uid() AND approved = true
          )
          OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = ''admin'' AND approved = true
          )
        )
    ';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'department_staff' AND column_name = 'profile_id'
  ) THEN
    EXECUTE '
      CREATE POLICY "dept_staff_self_manage" ON public.department_staff
        FOR ALL TO authenticated
        USING (
          profile_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = ''admin'' AND approved = true
          )
        )
        WITH CHECK (
          profile_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = ''admin'' AND approved = true
          )
        )
    ';
  END IF;
END $$;

-- 6. Safe RPC to auto-create and link a teacher row for any approved user
CREATE OR REPLACE FUNCTION public.ensure_my_teacher_record()
RETURNS public.teachers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prof public.profiles;
  v_teacher public.teachers;
BEGIN
  SELECT * INTO v_prof FROM public.profiles WHERE id = auth.uid();
  IF NOT FOUND OR NOT COALESCE(v_prof.approved, false) THEN
    RAISE EXCEPTION 'Your account is not approved yet.';
  END IF;

  IF v_prof.teacher_id IS NOT NULL THEN
    SELECT * INTO v_teacher FROM public.teachers WHERE id = v_prof.teacher_id;
    IF FOUND THEN
      RETURN v_teacher;
    END IF;
  END IF;

  SELECT t.* INTO v_teacher
  FROM public.teachers t
  WHERE lower(trim(t.full_name)) = lower(trim(v_prof.full_name))
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.teacher_id = t.id
    )
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.teachers (full_name, is_active)
    VALUES (v_prof.full_name, true)
    RETURNING * INTO v_teacher;
  END IF;

  UPDATE public.profiles
  SET teacher_id = v_teacher.id
  WHERE id = auth.uid();

  RETURN v_teacher;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_my_teacher_record() TO authenticated;

-- 7. Refresh Supabase PostgREST schema cache immediately
NOTIFY pgrst, 'reload schema';