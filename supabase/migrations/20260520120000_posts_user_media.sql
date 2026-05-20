-- User-uploaded performance audio on posts + public user_media storage bucket.

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS media_url text,
  ADD COLUMN IF NOT EXISTS media_type text;

COMMENT ON COLUMN public.posts.media_url IS 'Public URL for user-uploaded media (e.g. performance audio).';
COMMENT ON COLUMN public.posts.media_type IS 'Media kind, e.g. audio.';

INSERT INTO storage.buckets (id, name, public)
VALUES ('user_media', 'user_media', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Authenticated users may upload into their own folder: {user_id}/...
CREATE POLICY "user_media_authenticated_insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'user_media'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Anyone may read (public bucket URLs)
CREATE POLICY "user_media_public_select"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'user_media');
