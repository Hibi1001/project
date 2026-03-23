import { supabase } from './supabase';
import type {
  Post,
  PostReply,
  User,
  InstrumentType,
  DbPost,
  DbReaction,
  DbUser,
} from '../types';
import { POST_CAPTION_MAX_LENGTH, POST_REPLY_MAX_LENGTH } from '../types';

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
  reactions?: DbReaction[] | null,
  replyCount = 0,
): Post {
  return {
    id: post.id,
    userId: post.user_id,
    songTitle: post.song_title,
    artist: post.artist_name,
    albumArt: post.cover_url ?? DEFAULT_COVER_URL,
    caption: post.caption ?? null,
    replyCount,
    previewUrl: post.preview_url,
    reactions: aggregateReactions(reactions),
  };
}

export async function fetchReplyCountForPost(postId: string): Promise<number> {
  const { count, error } = await supabase
    .from('post_replies')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', postId);

  if (error) {
    console.error('Error counting replies', error);
    return 0;
  }
  return count ?? 0;
}

async function fetchReplyCountsByPostIds(
  postIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (postIds.length === 0) return map;

  const { data, error } = await supabase
    .from('post_replies')
    .select('post_id')
    .in('post_id', postIds);

  if (error) {
    console.error('Error fetching reply counts', error);
    return map;
  }

  for (const row of data ?? []) {
    const pid = (row as { post_id: string }).post_id;
    map.set(pid, (map.get(pid) ?? 0) + 1);
  }
  return map;
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

const TIMELINE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Global timeline: posts from the last 24 hours only (Profile uses its own 7-day window). */
export async function fetchTimelinePosts(): Promise<Post[]> {
  const sinceIso = new Date(Date.now() - TIMELINE_WINDOW_MS).toISOString();

  const { data: postsData, error } = await supabase
    .from('posts')
    .select('*')
    .gte('created_at', sinceIso)
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

  const replyCounts = await fetchReplyCountsByPostIds(postIds);

  return (postsData ?? []).map((post) =>
    mapDbPostToPost(
      post,
      reactionsByPostId.get(post.id),
      replyCounts.get(post.id) ?? 0,
    ),
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

  const replyCounts = await fetchReplyCountsByPostIds(postIds);

  return (postsData ?? []).map((post) =>
    mapDbPostToPost(
      post,
      reactionsByPostId.get(post.id),
      replyCounts.get(post.id) ?? 0,
    ),
  );
}

/** 開発テスト用：制限なし */
export const SHARE_COOLDOWN_MS = 12 * 60 * 60 * 1000;

/** Latest `posts.created_at` ISO string for this user, or null if no posts. */
export async function fetchLatestPostCreatedAtForUser(
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('posts')
    .select('created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error fetching latest post time', error);
    return null;
  }
  if (!data) return null;
  return (data as { created_at: string }).created_at ?? null;
}

export function getShareCooldownFromLatestPost(
  latestCreatedAtIso: string | null,
  nowMs: number = Date.now(),
): {
  blocked: boolean;
  hoursRemaining: number;
  minutesRemaining: number;
} {
  if (!latestCreatedAtIso) {
    return { blocked: false, hoursRemaining: 0, minutesRemaining: 0 };
  }
  const last = new Date(latestCreatedAtIso).getTime();
  if (Number.isNaN(last)) {
    return { blocked: false, hoursRemaining: 0, minutesRemaining: 0 };
  }
  const eligibleAt = last + SHARE_COOLDOWN_MS;
  if (nowMs >= eligibleAt) {
    return { blocked: false, hoursRemaining: 0, minutesRemaining: 0 };
  }
  const msLeft = eligibleAt - nowMs;
  const hoursRemaining = Math.floor(msLeft / (60 * 60 * 1000));
  const minutesRemaining = Math.floor(
    (msLeft % (60 * 60 * 1000)) / (60 * 1000),
  );
  return { blocked: true, hoursRemaining, minutesRemaining };
}

export function formatShareCooldownJa(info: {
  blocked: boolean;
  hoursRemaining: number;
  minutesRemaining: number;
}): string {
  if (!info.blocked) return '';
  return `次のシェアまであと ${info.hoursRemaining}時間${info.minutesRemaining}分`;
}

export interface CreatePostParams {
  userId: string;
  trackName: string;
  artistName: string;
  previewUrl: string | null;
  coverUrl: string;
  /** ひとこと — max {@link POST_CAPTION_MAX_LENGTH} chars. */
  caption?: string | null;
}

export async function createPost(params: CreatePostParams): Promise<Post> {
  const rawCap = params.caption?.trim() ?? '';
  const caption =
    rawCap.length > 0
      ? rawCap.slice(0, POST_CAPTION_MAX_LENGTH)
      : null;

  const { data, error } = await supabase
    .from('posts')
    .insert({
      user_id: params.userId,
      song_title: params.trackName.trim(),
      artist_name: params.artistName.trim(),
      preview_url: params.previewUrl ?? '',
      cover_url: params.coverUrl,
      caption,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating post', error);
    throw new Error(error.message);
  }

  return mapDbPostToPost(data as DbPost, undefined, 0);
}

async function fetchReplyLikeAggregates(
  replyIds: string[],
  authUserId: string | null,
): Promise<{ counts: Record<string, number>; mine: Set<string> }> {
  if (replyIds.length === 0) return { counts: {}, mine: new Set() };

  const { data, error } = await supabase
    .from('reply_likes')
    .select('reply_id, user_id')
    .in('reply_id', replyIds);

  if (error) {
    console.error('Error fetching reply likes', error);
    return { counts: {}, mine: new Set() };
  }

  const counts: Record<string, number> = {};
  const mine = new Set<string>();
  for (const row of data ?? []) {
    const rid = (row as { reply_id: string }).reply_id;
    counts[rid] = (counts[rid] ?? 0) + 1;
    if (
      authUserId &&
      (row as { user_id: string }).user_id === authUserId
    ) {
      mine.add(rid);
    }
  }
  return { counts, mine };
}

export async function fetchPostReplies(
  postId: string,
  authUserId: string | null,
): Promise<PostReply[]> {
  const { data, error } = await supabase
    .from('post_replies')
    .select('id, user_id, content, created_at, parent_id')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching post replies', error);
    return [];
  }

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const userIds = [...new Set(rows.map((r) => r.user_id as string))];
  const users = await Promise.all(userIds.map((id) => fetchUserById(id)));
  const userMap = new Map(
    users.filter(Boolean).map((u) => [u!.id, u!] as const),
  );

  const ids = rows.map((r) => r.id as string);
  const { counts, mine } = await fetchReplyLikeAggregates(ids, authUserId);

  return rows.map((r) => {
    const uid = r.user_id as string;
    const u = userMap.get(uid);
    const id = r.id as string;
    return {
      id,
      userId: uid,
      parentId: (r.parent_id as string | null) ?? null,
      content: r.content as string,
      createdAt: r.created_at as string,
      authorName: u?.name ?? 'ユーザー',
      authorAvatar: u?.avatar ?? '',
      likeCount: counts[id] ?? 0,
      likedByMe: mine.has(id),
    };
  });
}

export async function insertPostReply(
  postId: string,
  userId: string,
  content: string,
  parentId?: string | null,
): Promise<void> {
  const trimmed = content.trim().slice(0, POST_REPLY_MAX_LENGTH);
  if (!trimmed) {
    throw new Error('返信を入力してください');
  }

  if (parentId) {
    const { data: parentRow, error: parentErr } = await supabase
      .from('post_replies')
      .select('id, post_id')
      .eq('id', parentId)
      .maybeSingle();

    if (parentErr || !parentRow) {
      throw new Error('返信先が見つかりません');
    }
    if ((parentRow as { post_id: string }).post_id !== postId) {
      throw new Error('返信先がこの投稿と一致しません');
    }
  }

  const insert: Record<string, unknown> = {
    post_id: postId,
    user_id: userId,
    content: trimmed,
  };
  if (parentId) insert.parent_id = parentId;

  const { error } = await supabase.from('post_replies').insert(insert);

  if (error) {
    console.error('Error inserting reply', error);
    throw new Error(error.message);
  }
}

export async function toggleReplyLike(
  replyId: string,
  userId: string,
): Promise<{ liked: boolean }> {
  const { data: existing, error: selErr } = await supabase
    .from('reply_likes')
    .select('id')
    .eq('reply_id', replyId)
    .eq('user_id', userId)
    .maybeSingle();

  if (selErr) {
    console.error('Error checking reply like', selErr);
    throw new Error(selErr.message);
  }

  if (existing) {
    const { error: delErr } = await supabase
      .from('reply_likes')
      .delete()
      .eq('id', (existing as { id: string }).id);
    if (delErr) {
      console.error('Error removing reply like', delErr);
      throw new Error(delErr.message);
    }
    return { liked: false };
  }

  const { error: insErr } = await supabase.from('reply_likes').insert({
    reply_id: replyId,
    user_id: userId,
  });
  if (insErr) {
    console.error('Error inserting reply like', insErr);
    throw new Error(insErr.message);
  }
  return { liked: true };
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

/**
 * When Spotify no longer returns `preview_url`, look up a 30s preview on iTunes
 * using the same track/artist labels (Spotify metadata stays authoritative for the post).
 * Fails silently — returns null if no match or on network error.
 */
export async function fetchItunesPreviewForSpotifyTrack(
  trackName: string,
  artistName: string,
): Promise<string | null> {
  const q = `${trackName} ${artistName}`.trim();
  if (!q) return null;
  try {
    const hits = await searchiTunesSongs(q);
    const first = hits[0];
    return first?.previewUrl?.trim() ? first.previewUrl : null;
  } catch {
    return null;
  }
}

