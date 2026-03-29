-- Structured band recruitment: projects owned by a user + open/filled instrument slots

CREATE TABLE IF NOT EXISTS public.band_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS band_projects_owner_id_idx
  ON public.band_projects (owner_id);

CREATE TABLE IF NOT EXISTS public.band_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  band_project_id uuid NOT NULL REFERENCES public.band_projects (id) ON DELETE CASCADE,
  instrument_type text NOT NULL CHECK (
    instrument_type IN ('vocal', 'guitar', 'bass', 'drum', 'keyboard')
  ),
  applicant_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (band_project_id, instrument_type)
);

CREATE INDEX IF NOT EXISTS band_roles_band_project_id_idx
  ON public.band_roles (band_project_id);

CREATE INDEX IF NOT EXISTS band_roles_applicant_id_idx
  ON public.band_roles (applicant_id);

ALTER TABLE public.band_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.band_roles ENABLE ROW LEVEL SECURITY;

-- Projects: any authenticated user can read (recruitment is public to members)
CREATE POLICY "band_projects_select_authenticated"
  ON public.band_projects FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "band_projects_insert_own"
  ON public.band_projects FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "band_projects_update_own"
  ON public.band_projects FOR UPDATE
  TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "band_projects_delete_own"
  ON public.band_projects FOR DELETE
  TO authenticated
  USING (auth.uid() = owner_id);

-- Roles: readable to authenticated
CREATE POLICY "band_roles_select_authenticated"
  ON public.band_roles FOR SELECT
  TO authenticated
  USING (true);

-- Only project owner can add instrument slots
CREATE POLICY "band_roles_insert_owner"
  ON public.band_roles FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.band_projects bp
      WHERE bp.id = band_project_id AND bp.owner_id = auth.uid()
    )
  );

-- Claim an open slot: not the project owner, slot must be empty, set self as applicant
CREATE POLICY "band_roles_update_claim_open_slot"
  ON public.band_roles FOR UPDATE
  TO authenticated
  USING (
    applicant_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.band_projects bp
      WHERE bp.id = band_project_id AND bp.owner_id <> auth.uid()
    )
  )
  WITH CHECK (applicant_id = auth.uid());

-- Realtime: requires `supabase_realtime` publication (default on Supabase hosted).
ALTER PUBLICATION supabase_realtime ADD TABLE public.band_projects;
ALTER PUBLICATION supabase_realtime ADD TABLE public.band_roles;
