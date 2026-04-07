# Supabase migrations

Run SQL in the Supabase SQL Editor (or `supabase db push` if you use the CLI):

1. `migrations/20250312120000_caption_and_post_replies.sql` — adds `posts.caption`, table `post_replies`, RLS, and indexes.
2. `migrations/20250313120000_reply_threads_and_likes.sql` — adds `post_replies.parent_id`, table `reply_likes`, RLS, and indexes.

**Realtime (optional):** Dashboard → **Database** → **Replication** → enable `post_replies` so the reply sheet updates live for all clients.

## Edge Function: `daily-vibes` (morning push)

Sends a random “Daily Vibes” FCM message to **all** rows in `fcm_tokens` (deduped by token).

**Secrets (Dashboard → Project Settings → Edge Functions → Secrets, or CLI):**

| Variable | Required | Description |
|----------|----------|-------------|
| `FIREBASE_PROJECT_ID` | Yes | Same as `send-notification` |
| `FIREBASE_CLIENT_EMAIL` | Yes | Firebase service account email |
| `FIREBASE_PRIVATE_KEY` | Yes | PEM private key (`\n` escaped as needed) |
| `SUPABASE_URL` | Yes | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role (function reads `fcm_tokens`) |
| `DAILY_VIBES_CRON_SECRET` | Recommended in production | If set, callers must send `Authorization: Bearer <same value>` |

**Deploy:** `supabase functions deploy daily-vibes`

**Schedule (e.g. 08:00 JST):** Supabase Dashboard → **Edge Functions** → **daily-vibes** → **Schedules**, or invoke via `curl`:

```bash
curl -sS -X POST "$SUPABASE_URL/functions/v1/daily-vibes" \
  -H "Authorization: Bearer $DAILY_VIBES_CRON_SECRET" \
  -H "Content-Type: application/json"
```

If `DAILY_VIBES_CRON_SECRET` is unset, the function accepts unauthenticated calls (local dev only — **set the secret in production**).

**Payload:** `data.click_action` is `/?action=open_post_modal` and `data.kind` is `daily_morning_check`. The PWA opens the create-post modal when the user taps the notification (see `App.tsx` + `public/firebase-messaging-sw.js`).
