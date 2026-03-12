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

function mapDbUserToUser(user: DbUser): User {
  return {
    id: user.id,
    name: user.display_name,
    avatar: user.avatar_url,
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
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching user', error);
    return null;
  }

  if (!data) return null;

  return mapDbUserToUser(data);
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
  previewUrl: string;
  coverUrl: string;
}

export async function createPost(params: CreatePostParams): Promise<Post> {
  const { data, error } = await supabase
    .from('posts')
    .insert({
      user_id: params.userId,
      song_title: params.trackName.trim(),
      artist_name: params.artistName.trim(),
      preview_url: params.previewUrl,
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

