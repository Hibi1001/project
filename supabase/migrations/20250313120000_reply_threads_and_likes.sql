-- Threaded replies: optional parent reply on the same post
ALTER TABLE public.post_replies
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.post_replies (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS post_replies_parent_id_idx
  ON public.post_replies (parent_id);

-- Per-reply likes (not the same as post instrument reactions)
CREATE TABLE IF NOT EXISTS public.reply_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reply_id uuid NOT NULL REFERENCES public.post_replies (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reply_id, user_id)
);

CREATE INDEX IF NOT EXISTS reply_likes_reply_id_idx
  ON public.reply_likes (reply_id);

ALTER TABLE public.reply_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reply_likes_select_authenticated"
  ON public.reply_likes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "reply_likes_insert_own"
  ON public.reply_likes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "reply_likes_delete_own"
  ON public.reply_likes FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
