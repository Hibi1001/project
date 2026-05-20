export interface User {
  id: string;
  /** Public handle (stored lowercase in DB); null until set. */
  displayId: string | null;
  name: string;
  avatar: string;
   /** 学年（例: 'B1', 'M2', 'OB/OG' など）。未設定時は null。 */
  grade: string | null;
  instruments: string[];
  genres: string[];
  topBands: string[];
  gear: string[];
  recruitment: string;
}

/** Max length for `posts.caption` (ひとこと). */
export const POST_CAPTION_MAX_LENGTH = 40;
/** Max length for `post_replies.content`. */
export const POST_REPLY_MAX_LENGTH = 100;

export interface Post {
  id: string;
  userId: string;
  songTitle: string;
  artist: string;
  albumArt: string;
  /** Story-style short note; null if empty. */
  caption: string | null;
  /** Number of rows in `post_replies` for this post. */
  replyCount: number;
  previewUrl?: string;
  /** User-uploaded performance audio URL. */
  mediaUrl?: string | null;
  /** e.g. `audio` */
  mediaType?: string | null;
  /** Store track id (iTunes `trackId` string or legacy Spotify id); column `spotify_track_id`. */
  spotifyTrackId?: string | null;
  reactions: {
    vocal: number;
    guitar: number;
    bass: number;
    drum: number;
    keyboard: number;
  };
}

export type InstrumentType = 'vocal' | 'guitar' | 'bass' | 'drum' | 'keyboard';

// Database table models (Supabase)

export interface DbUser {
  id: string;
  /** Synced from auth at signup when the column exists; optional per schema. */
  email?: string | null;
  display_id: string | null;
  display_name: string;
  avatar_url: string | null;
  played_instruments: string[] | null;
  favorite_genres: string[] | null;
  top_3_bands: string[] | null;
  my_gear: string[] | null;
  recruitment_status: string | null;
  grade?: string | null;
}

export interface DbPost {
  id: string;
  user_id: string;
  song_title: string;
  artist_name: string;
  preview_url: string;
  cover_url?: string | null;
  caption?: string | null;
  created_at: string;
  /** iTunes track id (stringified) or legacy Spotify id; column name retained. */
  spotify_track_id?: string | null;
  media_url?: string | null;
  media_type?: string | null;
}

export interface DbPostReply {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  created_at: string;
  parent_id?: string | null;
}

/** Reply row enriched for UI. */
export interface PostReply {
  id: string;
  userId: string;
  /** Parent reply id for threaded chat; null = top-level. */
  parentId: string | null;
  content: string;
  createdAt: string;
  authorName: string;
  authorAvatar: string;
  likeCount: number;
  likedByMe: boolean;
}

export interface DbReplyLike {
  id: string;
  reply_id: string;
  user_id: string;
  created_at: string;
}

/** Stored in `notifications.type`. */
export type NotificationKind = 'reaction' | 'reply' | 'like';

export interface DbNotification {
  id: string;
  user_id: string;
  actor_id: string;
  type: NotificationKind;
  post_id: string;
  is_read: boolean;
  created_at: string;
}

/** Notification row for in-app lists (recipient-scoped). */
export interface AppNotification {
  id: string;
  actorId: string;
  type: NotificationKind;
  postId: string;
  isRead: boolean;
  createdAt: string;
}

/** Alias for UI/api usage (table: `notifications`). */
export type Notification = AppNotification;

export interface DbReaction {
  id: string;
  post_id: string;
  user_id: string;
  instrument_type: InstrumentType;
  /** Present when the DB column exists (used for “most recent” ordering). */
  created_at?: string | null;
}

export interface DbBandProject {
  id: string;
  owner_id: string;
  band_name: string;
  description: string | null;
  created_at: string;
}

export interface DbBandRole {
  id: string;
  project_id: string;
  instrument_type: InstrumentType;
  applicant_id: string | null;
  created_at: string;
}

