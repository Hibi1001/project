-- Align `band_roles` FK column name with app (`project_id`).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'band_roles'
      AND column_name = 'band_project_id'
  ) THEN
    ALTER TABLE public.band_roles RENAME COLUMN band_project_id TO project_id;
  END IF;
END $$;

-- Recreate index name if old name exists (optional cleanup)
DROP INDEX IF EXISTS public.band_roles_band_project_id_idx;
CREATE INDEX IF NOT EXISTS band_roles_project_id_idx
  ON public.band_roles (project_id);
