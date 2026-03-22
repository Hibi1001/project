-- Story-style caption on posts (nullable, max 40 chars in app + DB check)
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS caption text;

ALTER TABLE public.posts
  DROP CONSTRAINT IF EXISTS posts_caption_length;

ALTER TABLE public.posts
  ADD CONSTRAINT posts_caption_length
  CHECK (caption IS NULL OR char_length(caption) <= 40);

-- Thread replies (max 100 chars in app + DB check)
CREATE TABLE IF NOT EXISTS public.post_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.posts (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_replies_content_length CHECK (char_length(content) <= 100)
);

CREATE INDEX IF NOT EXISTS post_replies_post_id_created_at_idx
  ON public.post_replies (post_id, created_at DESC);

ALTER TABLE public.post_replies ENABLE ROW LEVEL SECURITY;

-- Anyone signed in (or anon read if you prefer) can read replies for timeline UX
CREATE POLICY "post_replies_select_authenticated"
  ON public.post_replies FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "post_replies_insert_own_user"
  ON public.post_replies FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Optional: Dashboard → Database → Replication → enable `post_replies` for realtime inserts.
