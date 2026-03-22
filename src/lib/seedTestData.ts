import { supabase } from './supabase';

/** Stable UUIDs so re-seeding upserts instead of duplicating. */
export const SEED_USER_IDS = [
  'a7000001-0000-4000-8000-000000000001',
  'a7000001-0000-4000-8000-000000000002',
  'a7000001-0000-4000-8000-000000000003',
] as const;

const SEED_POST_IDS = [
  'b7000001-0000-4000-8000-000000000001',
  'b7000001-0000-4000-8000-000000000002',
  'b7000001-0000-4000-8000-000000000003',
  'b7000001-0000-4000-8000-000000000004',
  'b7000001-0000-4000-8000-000000000005',
] as const;

const DEFAULT_COVER = 'https://placehold.co/400x400/27272a/34d399?text=Seed';

function daysAgoAtTime(
  daysAgo: number,
  hour: number,
  minute: number,
): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/**
 * Inserts/updates 3 dummy `users` and 5 `posts` with mixed `created_at` (today, yesterday, 3 days ago).
 * Requires Supabase RLS/policies that allow these writes from your client (typical in local dev).
 */
export async function seedTimelineTestData(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const users = [
    {
      id: SEED_USER_IDS[0],
      display_id: 'seed_timeline_alpha',
      display_name: 'Seed Alpha',
      avatar_url:
        'https://placehold.co/96x96/18181b/34d399?text=A',
      played_instruments: [] as string[],
      favorite_genres: ['Indie', 'Rock'],
      top_3_bands: ['Band A', 'Band B', 'Band C'],
      my_gear: [] as string[],
      recruitment_status: null as string | null,
    },
    {
      id: SEED_USER_IDS[1],
      display_id: 'seed_timeline_beta',
      display_name: 'Seed Beta',
      avatar_url:
        'https://placehold.co/96x96/18181b/2dd4bf?text=B',
      played_instruments: [] as string[],
      favorite_genres: ['Jazz'],
      top_3_bands: [] as string[],
      my_gear: [] as string[],
      recruitment_status: null as string | null,
    },
    {
      id: SEED_USER_IDS[2],
      display_id: 'seed_timeline_gamma',
      display_name: 'Seed Gamma',
      avatar_url:
        'https://placehold.co/96x96/18181b/a78bfa?text=G',
      played_instruments: [] as string[],
      favorite_genres: ['Electronic'],
      top_3_bands: [] as string[],
      my_gear: [] as string[],
      recruitment_status: null as string | null,
    },
  ];

  const posts = [
    {
      id: SEED_POST_IDS[0],
      user_id: SEED_USER_IDS[0],
      song_title: 'Morning Test Track',
      artist_name: 'Seed Artist One',
      preview_url: '',
      cover_url: DEFAULT_COVER,
      caption: '今日の一曲、聴いてね',
      created_at: daysAgoAtTime(0, 9, 15),
    },
    {
      id: SEED_POST_IDS[1],
      user_id: SEED_USER_IDS[1],
      song_title: 'Yesterday Afternoon',
      artist_name: 'Seed Artist Two',
      preview_url: '',
      cover_url: DEFAULT_COVER,
      caption: null,
      created_at: daysAgoAtTime(1, 14, 30),
    },
    {
      id: SEED_POST_IDS[2],
      user_id: SEED_USER_IDS[2],
      song_title: 'Yesterday Evening',
      artist_name: 'Seed Artist Three',
      preview_url: '',
      cover_url: DEFAULT_COVER,
      caption: null,
      created_at: daysAgoAtTime(1, 19, 45),
    },
    {
      id: SEED_POST_IDS[3],
      user_id: SEED_USER_IDS[0],
      song_title: 'Three Days Back (Noon)',
      artist_name: 'Seed Artist One',
      preview_url: '',
      cover_url: DEFAULT_COVER,
      caption: null,
      created_at: daysAgoAtTime(3, 12, 0),
    },
    {
      id: SEED_POST_IDS[4],
      user_id: SEED_USER_IDS[1],
      song_title: 'Three Days Back (Late)',
      artist_name: 'Seed Artist Two',
      preview_url: '',
      cover_url: DEFAULT_COVER,
      caption: null,
      created_at: daysAgoAtTime(3, 21, 10),
    },
  ];

  const { error: usersError } = await supabase
    .from('users')
    .upsert(users, { onConflict: 'id' });

  if (usersError) {
    return { ok: false, error: usersError.message };
  }

  const { error: postsError } = await supabase
    .from('posts')
    .upsert(posts, { onConflict: 'id' });

  if (postsError) {
    return { ok: false, error: postsError.message };
  }

  return { ok: true };
}
