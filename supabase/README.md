# Supabase migrations

Run SQL in the Supabase SQL Editor (or `supabase db push` if you use the CLI):

1. `migrations/20250312120000_caption_and_post_replies.sql` — adds `posts.caption`, table `post_replies`, RLS, and indexes.

**Realtime (optional):** Dashboard → **Database** → **Replication** → enable `post_replies` so the reply sheet updates live for all clients.
