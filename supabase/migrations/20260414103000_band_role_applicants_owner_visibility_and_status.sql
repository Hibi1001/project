-- Add applicant status + owner-only visibility for full applicant lists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'band_role_applicants'
  ) THEN
    ALTER TABLE public.band_role_applicants
      ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

    ALTER TABLE public.band_role_applicants
      DROP CONSTRAINT IF EXISTS band_role_applicants_status_check;

    ALTER TABLE public.band_role_applicants
      ADD CONSTRAINT band_role_applicants_status_check
      CHECK (status IN ('pending', 'accepted', 'declined'));
  END IF;
END $$;

ALTER TABLE public.band_role_applicants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "band_role_applicants_select_authenticated" ON public.band_role_applicants;
DROP POLICY IF EXISTS "band_role_applicants_select_owner_or_self" ON public.band_role_applicants;
CREATE POLICY "band_role_applicants_select_owner_or_self"
  ON public.band_role_applicants FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.band_roles br
      JOIN public.band_projects bp ON bp.id = br.project_id
      WHERE br.id = band_role_applicants.role_id
        AND bp.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "band_role_applicants_insert_self" ON public.band_role_applicants;
DROP POLICY IF EXISTS "band_role_applicants_insert_self_non_owner" ON public.band_role_applicants;
CREATE POLICY "band_role_applicants_insert_self_non_owner"
  ON public.band_role_applicants FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.band_roles br
      JOIN public.band_projects bp ON bp.id = br.project_id
      WHERE br.id = band_role_applicants.role_id
        AND bp.owner_id <> auth.uid()
    )
  );

DROP POLICY IF EXISTS "band_role_applicants_delete_self" ON public.band_role_applicants;
DROP POLICY IF EXISTS "band_role_applicants_delete_self_or_owner" ON public.band_role_applicants;
CREATE POLICY "band_role_applicants_delete_self_or_owner"
  ON public.band_role_applicants FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.band_roles br
      JOIN public.band_projects bp ON bp.id = br.project_id
      WHERE br.id = band_role_applicants.role_id
        AND bp.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "band_role_applicants_update_owner_status" ON public.band_role_applicants;
CREATE POLICY "band_role_applicants_update_owner_status"
  ON public.band_role_applicants FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.band_roles br
      JOIN public.band_projects bp ON bp.id = br.project_id
      WHERE br.id = band_role_applicants.role_id
        AND bp.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.band_roles br
      JOIN public.band_projects bp ON bp.id = br.project_id
      WHERE br.id = band_role_applicants.role_id
        AND bp.owner_id = auth.uid()
    )
    AND status IN ('pending', 'accepted', 'declined')
  );
