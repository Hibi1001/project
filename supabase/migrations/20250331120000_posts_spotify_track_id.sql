-- Optional Spotify track id for deep links (open.spotify.com/track/...)
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS spotify_track_id text;

COMMENT ON COLUMN public.posts.spotify_track_id IS 'Spotify track URI id (22-char base62), when known';
