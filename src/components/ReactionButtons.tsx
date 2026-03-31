import { useEffect, useMemo, useRef, useState } from 'react';
import { Heart, Music, Headphones, PlaySquare } from 'lucide-react';
import { supabase } from '../lib/supabase';
import LikedByModal from './LikedByModal';

export interface ReactionButtonsProps {
  postId: string;
  postOwnerId: string;
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
  postOwnerId,
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
  const [isModalOpen, setIsModalOpen] = useState(false);
  const latestRef = useRef({
    postId,
    userId: userId ?? null,
    postOwnerId,
  });

  latestRef.current = { postId, userId: userId ?? null, postOwnerId };

  // Load persisted like state (+ best-effort likes_count) on mount / post change.
  useEffect(() => {
    let cancelled = false;
    const uid = (userId ?? '').trim();
    const pid = postId.trim();
    if (!uid || !pid) return;

    void (async () => {
      try {
        const { data, error } = await supabase
          .from('post_likes')
          .select('post_id')
          .eq('post_id', pid)
          .eq('user_id', uid)
          .maybeSingle();

        if (cancelled) return;
        if (error) {
          // If table isn't present yet, keep optimistic/local behavior.
          console.warn('[likes] fetch post_likes failed:', error.message);
        } else {
          setIsLiked(Boolean(data));
        }

        // Best-effort: refresh likes_count from posts if the column exists.
        const { data: postRow, error: postErr } = await supabase
          .from('posts')
          .select('likes_count')
          .eq('id', pid)
          .maybeSingle();
        if (cancelled) return;
        if (postErr) {
          if (String(postErr.message || '').toLowerCase().includes('likes_count')) {
            return;
          }
          console.warn('[likes] fetch likes_count failed:', postErr.message);
          return;
        }
        const lc = (postRow as { likes_count?: number | null } | null)?.likes_count;
        if (typeof lc === 'number' && Number.isFinite(lc)) setLikeCount(Math.max(0, lc));
      } catch (e) {
        if (!cancelled) console.warn('[likes] init failed:', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [postId, userId]);

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

  const applyLikesDelta = async (delta: 1 | -1) => {
    // Preferred: use a DB trigger/function. Fallback: naive update.
    const pid = postId.trim();
    if (!pid) return;

    // Try RPC if present (recommended).
    const rpcCandidates = ['apply_post_like_delta', 'increment_post_likes_count'];
    for (const fn of rpcCandidates) {
      const { error } = await supabase.rpc(fn, { post_id: pid, delta });
      if (!error) return;
      // If function doesn't exist, try next.
      const msg = String(error.message || '').toLowerCase();
      if (msg.includes('function') && msg.includes('does not exist')) continue;
      if (msg.includes('schema cache') || msg.includes('not found')) continue;
      break;
    }

    // Fallback (non-atomic): update based on our local optimistic count.
    const next = Math.max(0, likeCount + delta);
    const { error } = await supabase
      .from('posts')
      .update({ likes_count: next })
      .eq('id', pid);
    if (error) {
      const msg = String(error.message || '').toLowerCase();
      if (msg.includes('likes_count')) return;
      throw error;
    }
  };

  const toggleLike = async () => {
    if (!userId || busy) return;
    const nextLiked = !isLiked;

    // Optimistic UI (local only).
    setIsLiked(nextLiked);
    setLikeCount((c) => Math.max(0, c + (nextLiked ? 1 : -1)));
    setBusy(true);

    try {
      const uid = userId.trim();
      const pid = postId.trim();
      if (!uid || !pid) throw new Error('missing ids');

      if (nextLiked) {
        const { error: likeErr } = await supabase.from('post_likes').insert({
          post_id: pid,
          user_id: uid,
        });
        if (likeErr) throw likeErr;

        // Notify post owner (best-effort; do not block UI if this fails).
        if (postOwnerId && postOwnerId !== uid) {
          await supabase.from('notifications').insert({
            actor_id: uid,
            user_id: postOwnerId,
            type: 'like',
            post_id: pid,
            is_read: false,
          });
        }

        await applyLikesDelta(1);
      } else {
        const { error: delErr } = await supabase
          .from('post_likes')
          .delete()
          .eq('post_id', pid)
          .eq('user_id', uid);
        if (delErr) throw delErr;

        await applyLikesDelta(-1);
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
      <div className="flex items-center gap-1.5 text-zinc-400">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void toggleLike();
          }}
          disabled={!userId || busy}
          className="transition-colors hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-60"
          aria-pressed={isLiked}
          aria-label="いいね"
        >
          <Heart
            className={`h-5 w-5 ${isLiked ? 'fill-red-500 text-red-500' : ''}`}
          />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsModalOpen(true);
          }}
          className="cursor-pointer text-sm tabular-nums hover:underline"
          aria-label="いいねした人を見る"
        >
          {likeCount}
        </button>
      </div>

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

      <LikedByModal
        postId={postId}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
}

