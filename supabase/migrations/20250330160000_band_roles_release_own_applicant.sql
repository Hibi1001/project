-- Allow the current applicant to withdraw (clear applicant_id on their own row)
CREATE POLICY "band_roles_update_release_own_applicant"
  ON public.band_roles FOR UPDATE
  TO authenticated
  USING (applicant_id = auth.uid())
  WITH CHECK (applicant_id IS NULL);
