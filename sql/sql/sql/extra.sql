-- 1. Remove the old restrictive BEFORE UPDATE trigger on public.teachers
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT t.tgname
      FROM pg_trigger t
      JOIN pg_class c ON t.tgrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      JOIN pg_proc p ON t.tgfoid = p.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'teachers'
       AND NOT t.tgisinternal
       AND p.prosrc ILIKE '%Only status, picture, description, rank, and hours can be changed%'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.teachers', r.tgname);
  END LOOP;
END $$;

-- 2. Create an updated trigger function that permits schedule & unavailable_reason
CREATE OR REPLACE FUNCTION public.guard_teachers_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Refresh updated_at only when availability status or reason changes
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.unavailable_reason IS DISTINCT FROM OLD.unavailable_reason THEN
    NEW.updated_at := now();
  END IF;

  -- Admins can update any field
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND approved = true
  ) THEN
    RETURN NEW;
  END IF;

  -- Non-admins cannot alter identity or visibility fields
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.full_name IS DISTINCT FROM OLD.full_name
     OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'Only status, picture, description, rank, reason, and schedule can be changed.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_teachers_update ON public.teachers;
CREATE TRIGGER trg_guard_teachers_update
  BEFORE UPDATE ON public.teachers
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_teachers_update();

-- 3. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';