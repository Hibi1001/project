-- If an older migration created `band_projects.name`, align with `band_name` (no-op if already renamed).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'band_projects'
      AND column_name = 'name'
  ) THEN
    ALTER TABLE public.band_projects RENAME COLUMN name TO band_name;
  END IF;
END $$;
