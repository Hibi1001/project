import { useMemo, useState } from 'react';
import { Heart, Music, Headphones, PlaySquare } from 'lucide-react';
import { supabase } from '../lib/supabase';

export interface ReactionButtonsProps {
  postId: string;
  trackName: string;
  artistName: string;
  /** Direct Apple Music / iTunes URL if available. */
  appleMusicUrl?: string | null;
  /** Initial total likes count for optimistic UI. */
  initialLikeCount?: number;
  /** Whether the current viewer has liked (if known). */
  initialIsLiked?: boolean;
  /** Logged-in user id; if absent, like is disabled. */
  userId?: string | null;
}

export default function ReactionButtons({
  postId,
  trackName,
  artistName,
  appleMusicUrl,
  initialLikeCount = 0,
  initialIsLiked = false,
  userId,
}: ReactionButtonsProps) {
  const [isLiked, setIsLiked] = useState<boolean>(initialIsLiked);
  const [likeCount, setLikeCount] = useState<number>(initialLikeCount);
  const [busy, setBusy] = useState(false);

  const searchQuery = useMemo(() => {
    const q = `${trackName ?? ''} ${artistName ?? ''}`.trim();
    return encodeURIComponent(q);
  }, [trackName, artistName]);

  const spotifyUrl = useMemo(
    () => `https://open.spotify.com/search/${searchQuery}`,
    [searchQuery],
  );
  const youtubeUrl = useMemo(
    () => `https://www.youtube.com/results?search_query=${searchQuery}`,
    [searchQuery],
  );
  const appleUrl = useMemo(() => {
    const direct = (appleMusicUrl ?? '').trim();
    if (direct) return direct;
    return `https://music.apple.com/search?term=${searchQuery}`;
  }, [appleMusicUrl, searchQuery]);

  const toggleLike = async () => {
    if (!userId || busy) return;
    const nextLiked = !isLiked;

    // Optimistic UI (local only).
    setIsLiked(nextLiked);
    setLikeCount((c) => Math.max(0, c + (nextLiked ? 1 : -1)));
    setBusy(true);

    try {
      // Reuse existing `reactions` table as a single "like" channel.
      // Instrument type is pinned to 'vocal' to avoid schema changes.
      if (nextLiked) {
        const { error } = await supabase.from('reactions').insert({
          post_id: postId,
          user_id: userId,
          instrument_type: 'vocal',
        });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('reactions')
          .delete()
          .eq('post_id', postId)
          .eq('user_id', userId)
          .eq('instrument_type', 'vocal');
        if (error) throw error;
      }
    } catch {
      // Roll back on failure.
      setIsLiked((prev) => !prev);
      setLikeCount((c) => Math.max(0, c + (nextLiked ? -1 : 1)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 flex items-center gap-4">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void toggleLike();
        }}
        disabled={!userId || busy}
        className="flex items-center gap-1.5 text-zinc-400 transition-colors hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-60"
        aria-pressed={isLiked}
        aria-label="いいね"
      >
        <Heart
          className={`h-5 w-5 ${isLiked ? 'fill-red-500 text-red-500' : ''}`}
        />
        <span className="text-sm tabular-nums">{likeCount}</span>
      </button>

      <div className="h-5 w-px bg-zinc-800" aria-hidden />

      <div className="flex items-center gap-3">
        <a
          href={appleUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1.5 text-zinc-400 transition-colors hover:text-red-500"
          aria-label="Apple Musicで探す"
        >
          <Music className="h-5 w-5" />
          <span className="text-sm">Apple</span>
        </a>

        <a
          href={spotifyUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1.5 text-zinc-400 transition-colors hover:text-emerald-400"
          aria-label="Spotifyで探す"
        >
          <Headphones className="h-5 w-5" />
          <span className="text-sm">Spotify</span>
        </a>

        <a
          href={youtubeUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1.5 text-zinc-400 transition-colors hover:text-red-500"
          aria-label="YouTubeで探す"
        >
          <PlaySquare className="h-5 w-5" />
          <span className="text-sm">YouTube</span>
        </a>
      </div>
    </div>
  );
}

