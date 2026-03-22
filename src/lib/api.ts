import { supabase } from './supabase';
import type { Post, User, InstrumentType, DbPost, DbReaction, DbUser } from '../types';

type DbInstrument = InstrumentType;

const emptyReactions: Record<InstrumentType, number> = {
  vocal: 0,
  guitar: 0,
  bass: 0,
  drum: 0,
  keyboard: 0,
};

function aggregateReactions(
  reactions: DbReaction[] | null | undefined
): Record<InstrumentType, number> {
  if (!reactions || reactions.length === 0) return { ...emptyReactions };

  return reactions.reduce((acc, reaction) => {
    const key = reaction.instrument_type as DbInstrument;
    if (acc[key] !== undefined) {
      acc[key] += 1;
    }
    return acc;
  }, { ...emptyReactions });
}

const DEFAULT_COVER_URL = 'https://placehold.co/300x300?text=No+Cover';

function mapDbPostToPost(
  post: DbPost,
  reactions?: DbReaction[] | null
): Post {
  return {
    id: post.id,
    userId: post.user_id,
    songTitle: post.song_title,
    artist: post.artist_name,
    albumArt: post.cover_url ?? DEFAULT_COVER_URL,
    previewUrl: post.preview_url,
    reactions: aggregateReactions(reactions),
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True if `value` looks like a UUID (profile route `/user/<uuid>`). */
export function isProfileUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/** Normalize @handle or slug for `display_id` lookup (lowercase, no @). */
export function normalizeDisplayIdLookup(raw: string): string {
  return raw.trim().replace(/^@+/, '').toLowerCase();
}

function mapDbUserToUser(user: DbUser): User {
  return {
    id: user.id,
    displayId: user.display_id ?? null,
    name: user.display_name,
    avatar: user.avatar_url ?? '',
    instruments: user.played_instruments ?? [],
    genres: user.favorite_genres ?? [],
    topBands: user.top_3_bands ?? [],
    gear: user.my_gear ?? [],
    recruitment: user.recruitment_status ?? '',
  };
}

export async function fetchTimelinePosts(): Promise<Post[]> {
  const { data: postsData, error } = await supabase
    .from('posts')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching posts', error);
    return [];
  }

  const postIds = postsData?.map((p) => p.id) ?? [];

  const { data: reactionsData, error: reactionsError } = await supabase
    .from('reactions')
    .select('*')
    .in('post_id', postIds.length > 0 ? postIds : ['']);

  if (reactionsError) {
    console.error('Error fetching reactions', reactionsError);
  }

  const reactionsByPostId = new Map<string, DbReaction[]>();
  (reactionsData ?? []).forEach((reaction) => {
    const existing = reactionsByPostId.get(reaction.post_id) ?? [];
    existing.push(reaction);
    reactionsByPostId.set(reaction.post_id, existing);
  });

  return (postsData ?? []).map((post) =>
    mapDbPostToPost(post, reactionsByPostId.get(post.id))
  );
}

export async function fetchUserById(userId: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId.trim())
    .maybeSingle();

  if (error) {
    console.error('Error fetching user', error);
    return null;
  }

  if (!data) return null;

  return mapDbUserToUser(data as DbUser);
}

export async function fetchUserByDisplayId(
  displayId: string,
): Promise<User | null> {
  const slug = normalizeDisplayIdLookup(displayId);
  if (!slug) return null;

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('display_id', slug)
    .maybeSingle();

  if (error) {
    console.error('Error fetching user by display_id', error);
    return null;
  }

  if (!data) return null;

  return mapDbUserToUser(data as DbUser);
}

/**
 * Load profile by UUID (`/user/<uuid>`) or by `display_id` (`/@handle`).
 */
export async function fetchUserByProfileSlug(
  slug: string,
): Promise<User | null> {
  const trimmed = slug.trim();
  if (!trimmed) return null;
  if (isProfileUuid(trimmed)) {
    return fetchUserById(trimmed);
  }
  return fetchUserByDisplayId(trimmed);
}

export async function fetchPostsByUserId(userId: string): Promise<Post[]> {
  const { data: postsData, error } = await supabase
    .from('posts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching user posts', error);
    return [];
  }

  const postIds = postsData?.map((p) => p.id) ?? [];

  const { data: reactionsData, error: reactionsError } = await supabase
    .from('reactions')
    .select('*')
    .in('post_id', postIds.length > 0 ? postIds : ['']);

  if (reactionsError) {
    console.error('Error fetching reactions', reactionsError);
  }

  const reactionsByPostId = new Map<string, DbReaction[]>();
  (reactionsData ?? []).forEach((reaction) => {
    const existing = reactionsByPostId.get(reaction.post_id) ?? [];
    existing.push(reaction);
    reactionsByPostId.set(reaction.post_id, existing);
  });

  return (postsData ?? []).map((post) =>
    mapDbPostToPost(post, reactionsByPostId.get(post.id))
  );
}

export interface CreatePostParams {
  userId: string;
  trackName: string;
  artistName: string;
  previewUrl: string | null;
  coverUrl: string;
}

export async function createPost(params: CreatePostParams): Promise<Post> {
  const { data, error } = await supabase
    .from('posts')
    .insert({
      user_id: params.userId,
      song_title: params.trackName.trim(),
      artist_name: params.artistName.trim(),
      preview_url: params.previewUrl ?? '',
      cover_url: params.coverUrl,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating post', error);
    throw new Error(error.message);
  }

  return mapDbPostToPost(data);
}

export interface iTunesSongResult {
  trackName: string;
  artistName: string;
  previewUrl: string | null;
  artworkUrl100: string;
}

export async function searchiTunesSongs(query: string): Promise<iTunesSongResult[]> {
  if (!query.trim()) return [];
  const encoded = encodeURIComponent(query.trim());
  const res = await fetch(
    `https://itunes.apple.com/search?term=${encoded}&entity=song&limit=10&country=jp`
  );
  if (!res.ok) return [];
  const json = (await res.json()) as { results?: Array<{ trackName?: string; artistName?: string; previewUrl?: string; artworkUrl100?: string }> };
  const results = json.results ?? [];
  return results
    .filter((r) => r.previewUrl && r.trackName && r.artistName && r.artworkUrl100)
    .map((r) => ({
      trackName: r.trackName!,
      artistName: r.artistName!,
      previewUrl: r.previewUrl!,
      artworkUrl100: r.artworkUrl100!,
    }));
}

