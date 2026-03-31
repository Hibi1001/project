import type { InstrumentType, Post } from '../types';
import type {
  ReactionParticipantPreview,
  TimelineBandProject,
  TimelineSongPost,
} from './api';

/** Song post slice in the merged timeline feed. */
export type TimelineSongFeedItem = {
  itemType: 'song';
  created_at: string;
  post: Post;
  reactionParticipants: Record<
    InstrumentType,
    ReactionParticipantPreview[]
  >;
};

/** Band recruitment slice — `userId` mirrors `owner_id` for shared user-fetch code paths. */
export type TimelineBandProjectFeedItem = {
  itemType: 'band';
  created_at: string;
  id: string;
  owner_id: string;
  userId: string;
  band_name: string;
  description: string | null;
  roles: {
    id: string;
    instrument_type: InstrumentType;
    applicant_id: string | null;
  }[];
  albumArt: null;
  previewUrl: null;
  songTitle: string;
};

export type FeedItem = TimelineSongFeedItem | TimelineBandProjectFeedItem;

/**
 * Merge song posts + band projects into a single time-ordered feed (same rules as Timeline).
 */
export function buildMergedTimelineFeed(
  songRows: TimelineSongPost[],
  bandRows: TimelineBandProject[],
): FeedItem[] {
  const seen = new Set<string>();
  const dedupedSongs = songRows.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  const songItems: TimelineSongFeedItem[] = dedupedSongs.map((row) => {
    const { createdAt, reactionParticipants, ...post } = row;
    const ts =
      typeof createdAt === 'string' && createdAt.trim()
        ? createdAt
        : new Date(0).toISOString();
    const songItem: TimelineSongFeedItem = {
      itemType: 'song',
      created_at: ts,
      post,
      reactionParticipants,
    };
    return songItem;
  });

  const bandItems: TimelineBandProjectFeedItem[] = (bandRows ?? [])
    .filter((b) => Boolean(b?.id && b?.owner_id))
    .map((b) => {
      const name = (b.band_name ?? '').trim() || 'バンド募集';
      const oid = String(b.owner_id).trim();
      const roles = Array.isArray(b.roles) ? b.roles : [];
      const ts =
        typeof b.created_at === 'string' && b.created_at.trim()
          ? b.created_at
          : new Date(0).toISOString();
      const bandItem: TimelineBandProjectFeedItem = {
        itemType: 'band',
        created_at: ts,
        id: b.id,
        owner_id: oid,
        userId: oid,
        band_name: name,
        description: b.description ?? null,
        roles,
        albumArt: null,
        previewUrl: null,
        songTitle: name,
      };
      return bandItem;
    });

  return [...songItems, ...bandItems].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}
