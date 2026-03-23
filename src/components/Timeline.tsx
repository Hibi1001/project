import { useState, useEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { motion } from 'framer-motion';
import {
  Mic,
  Guitar,
  Music2,
  Drum,
  Piano,
  Play,
  Pause,
  MessageCircle,
} from 'lucide-react';
import { Post, InstrumentType, User } from '../types';
import {
  fetchTimelinePosts,
  fetchUserById,
  fetchReplyCountForPost,
} from '../lib/api';
import { supabase } from '../lib/supabase';
import { seedTimelineTestData } from '../lib/seedTestData';
import LockScreen from './LockScreen';
import PostReplySheet from './PostReplySheet';
import SpotifyPlayer, {
  PREVIEW_UI_DURATION_SEC,
  type SpotifyPlayerHandle,
} from './SpotifyPlayer';
import { DAILY_POST_LIMIT } from '../constants/posting';

interface TimelineProps {
  /** UUID or `display_id` for routing (`/@handle` or `/user/uuid`). */
  onViewProfile: (profileSlug: string) => void;
  onShareSong: () => void;
  timelineRefreshTrigger?: number;
  shareSongDisabled?: boolean;
  shareCooldownText?: string;
  shareBlockReason?: 'none' | 'cooldown' | 'daily';
}

export default function Timeline({
  onViewProfile,
  onShareSong,
  timelineRefreshTrigger = 0,
  shareSongDisabled = false,
  shareCooldownText = '',
  shareBlockReason = 'none',
}: TimelineProps) {
  const [posts, setPosts] = useState<Post[]>([]);
  /** IO-suggested post (updates often while scrolling). */
  const [ioPostId, setIoPostId] = useState<string | null>(null);
  /** Debounced + “locked” for audio/reactions; immediate on play tap. */
  const [activePostId, setActivePostId] = useState<string | null>(null);
  const scrollDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Last “stable” active post after scroll debounce (for pause-on-scroll only). */
  const prevStableActiveRef = useRef<string | null>(null);
  const activePostIdRef = useRef<string | null>(null);
  /** When true, active id changed from an explicit play tap — don’t force pause. */
  const skipPlayingResetRef = useRef(false);
  const spotifyPlayerRef = useRef<SpotifyPlayerHandle>(null);
  const [usersById, setUsersById] = useState<Record<string, User>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [dailyPostCount, setDailyPostCount] = useState(0);
  const [viewTimelineWithoutPostToday, setViewTimelineWithoutPostToday] =
    useState(false);
  const [seedRefreshNonce, setSeedRefreshNonce] = useState(0);
  const [isSeeding, setIsSeeding] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [userReactionSet, setUserReactionSet] = useState<
    Set<InstrumentType>
  >(new Set());
  const [replySheetOpen, setReplySheetOpen] = useState(false);
  const [replySheetPostId, setReplySheetPostId] = useState<string | null>(
    null,
  );

  const instrumentIcons = {
    vocal: Mic,
    guitar: Guitar,
    bass: Music2,
    drum: Drum,
    keyboard: Piano,
  };

  const activePost =
    posts.find((p) => p.id === activePostId) ?? posts[0] ?? null;

  const replySheetPost =
    replySheetPostId != null
      ? (posts.find((p) => p.id === replySheetPostId) ?? null)
      : null;
  const replySheetPostUser = replySheetPost
    ? usersById[replySheetPost.userId]
    : undefined;
  const replySheetCaptionTrimmed = replySheetPost?.caption?.trim() ?? '';
  const replySheetPinnedOriginal = replySheetCaptionTrimmed
    ? {
        caption: replySheetCaptionTrimmed,
        authorName: replySheetPostUser?.name ?? 'ユーザー',
        authorAvatar: replySheetPostUser?.avatar ?? '',
      }
    : null;

  activePostIdRef.current = activePostId;

  const scheduleActiveFromScroll = useCallback((postId: string) => {
    setIoPostId(postId);
    if (scrollDebounceRef.current) clearTimeout(scrollDebounceRef.current);
    scrollDebounceRef.current = setTimeout(() => {
      scrollDebounceRef.current = null;
      setActivePostId(postId);
    }, 280);
  }, []);

  const setActiveImmediate = useCallback((postId: string) => {
    if (scrollDebounceRef.current) {
      clearTimeout(scrollDebounceRef.current);
      scrollDebounceRef.current = null;
    }
    skipPlayingResetRef.current = true;
    setIoPostId(postId);
    setActivePostId(postId);
  }, []);

  /** After flushSync, chain is still user-gesture aligned; rAF runs load→canplay→play in player. */
  const tryLoadAndPlayFromGesture = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void spotifyPlayerRef.current?.loadAndPlayFromGesture().catch(() => {
          setIsPlaying(false);
        });
      });
    });
  }, []);

  const syncReplyCount = useCallback(async (postId: string) => {
    const c = await fetchReplyCountForPost(postId);
    setPosts((prev) =>
      prev.map((p) => (p.id === postId ? { ...p, replyCount: c } : p)),
    );
  }, []);

  const openReplySheet = (postId: string) => {
    setReplySheetPostId(postId);
    setReplySheetOpen(true);
  };

  const closeReplySheet = () => {
    setReplySheetOpen(false);
    setReplySheetPostId(null);
  };

  const refreshReactionsForPost = async (postId: string, userId: string) => {
    const { data, error } = await supabase
      .from('reactions')
      .select('id, instrument_type, user_id')
      .eq('post_id', postId);

    if (error) {
      console.error('Error fetching reactions', error);
      return;
    }

    const counts: Record<InstrumentType, number> = {
      vocal: 0,
      guitar: 0,
      bass: 0,
      drum: 0,
      keyboard: 0,
    };

    const mine = new Set<InstrumentType>();
    (data ?? []).forEach(
      (r: { instrument_type: InstrumentType; user_id: string }) => {
        if (counts[r.instrument_type] !== undefined)
          counts[r.instrument_type] += 1;
        if (r.user_id === userId) mine.add(r.instrument_type);
      },
    );

    setPosts((prev) =>
      prev.map((p) => (p.id === postId ? { ...p, reactions: counts } : p)),
    );
    setUserReactionSet(mine);
  };

  const toggleReaction = async (postId: string, instrument: InstrumentType) => {
    if (!authUserId) return;

    const alreadyReacted = userReactionSet.has(instrument);
    setUserReactionSet((prev) => {
      const next = new Set(prev);
      if (alreadyReacted) next.delete(instrument);
      else next.add(instrument);
      return next;
    });
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId
          ? {
              ...p,
              reactions: {
                ...p.reactions,
                [instrument]: Math.max(
                  0,
                  p.reactions[instrument] + (alreadyReacted ? -1 : 1),
                ),
              },
            }
          : p,
      ),
    );

    const { data: existing, error: existingError } = await supabase
      .from('reactions')
      .select('id')
      .eq('post_id', postId)
      .eq('user_id', authUserId)
      .eq('instrument_type', instrument)
      .maybeSingle();

    if (existingError) {
      console.error('Error checking reaction', existingError);
      await refreshReactionsForPost(postId, authUserId);
      return;
    }

    if (!existing) {
      const { error: insertError } = await supabase.from('reactions').insert({
        post_id: postId,
        user_id: authUserId,
        instrument_type: instrument,
      });
      if (insertError) {
        console.error('Error inserting reaction', insertError);
        await refreshReactionsForPost(postId, authUserId);
        return;
      }
    } else {
      const { error: deleteError } = await supabase
        .from('reactions')
        .delete()
        .eq('id', existing.id);
      if (deleteError) {
        console.error('Error deleting reaction', deleteError);
        await refreshReactionsForPost(postId, authUserId);
        return;
      }
    }

    await refreshReactionsForPost(postId, authUserId);
  };

  useEffect(() => {
    let cancelled = false;
    supabase.auth
      .getUser()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setAuthUserId(null);
        } else {
          setAuthUserId(data.user?.id ?? null);
        }
        setIsAuthLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setAuthUserId(null);
        setIsAuthLoading(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUserId(session?.user?.id ?? null);
      setIsAuthLoading(false);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const loadDailyPostCount = async () => {
      if (!authUserId) {
        setDailyPostCount(0);
        return;
      }

      const now = new Date();
      const startOfToday = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        0,
        0,
        0,
        0,
      );

      const { count, error } = await supabase
        .from('posts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', authUserId)
        .gte('created_at', startOfToday.toISOString());

      if (error) {
        console.error('Error counting today posts', error);
        setDailyPostCount(0);
        return;
      }

      setDailyPostCount(count ?? 0);
    };

    void loadDailyPostCount();
  }, [authUserId, timelineRefreshTrigger]);

  useEffect(() => {
    if (dailyPostCount > 0) setViewTimelineWithoutPostToday(false);
  }, [dailyPostCount]);

  useEffect(() => {
    const loadPosts = async () => {
      setIsLoading(true);
      const data = await fetchTimelinePosts();
      const seen = new Set<string>();
      const deduped = (data ?? []).filter((p) => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });
      setPosts(deduped);
      const firstId = deduped[0]?.id ?? null;
      setIoPostId(firstId);
      setActivePostId(firstId);
      prevStableActiveRef.current = firstId;
      if (scrollDebounceRef.current) {
        clearTimeout(scrollDebounceRef.current);
        scrollDebounceRef.current = null;
      }
      setIsLoading(false);
    };

    loadPosts();
  }, [timelineRefreshTrigger, seedRefreshNonce]);

  useEffect(() => {
    if (posts.length === 0) {
      setUsersById({});
      return;
    }
    let cancelled = false;
    (async () => {
      const ids = [...new Set(posts.map((p) => p.userId))];
      const results = await Promise.all(ids.map((id) => fetchUserById(id)));
      if (cancelled) return;
      const next: Record<string, User> = {};
      results.forEach((u) => {
        if (u) next[u.id] = u;
      });
      setUsersById(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [posts]);

  useEffect(() => {
    if (posts.length === 0) return;
    if (activePostId && !posts.some((p) => p.id === activePostId)) {
      const fallback = posts[0].id;
      setActivePostId(fallback);
      setIoPostId(fallback);
    }
  }, [posts, activePostId]);

  // Only stop playback after activePostId has stayed the same for a short window (ignore scroll jitter).
  useEffect(() => {
    if (skipPlayingResetRef.current) {
      skipPlayingResetRef.current = false;
      setPreviewProgress(0);
      prevStableActiveRef.current = activePostId;
      return;
    }

    if (prevStableActiveRef.current === null && activePostId) {
      prevStableActiveRef.current = activePostId;
      return;
    }

    if (prevStableActiveRef.current === activePostId) return;

    const targetId = activePostId;
    const fromId = prevStableActiveRef.current;

    const timer = window.setTimeout(() => {
      if (activePostIdRef.current !== targetId) return;
      prevStableActiveRef.current = targetId;
      if (fromId !== targetId) {
        setIsPlaying(false);
        setPreviewProgress(0);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [activePostId]);

  // Only stop if active post has had no preview for 500ms (avoids flicker while posts/users load).
  useEffect(() => {
    if (!activePostId) return;
    const timer = window.setTimeout(() => {
      if (activePostIdRef.current !== activePostId) return;
      const p = posts.find((x) => x.id === activePostIdRef.current);
      if (p && !p.previewUrl?.trim()) {
        setIsPlaying(false);
        setPreviewProgress(0);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [activePostId, posts]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || posts.length === 0) return;

    const ratios = new Map<Element, number>();
    let raf = 0;

    const obs = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) ratios.set(en.target, en.intersectionRatio);
          else ratios.delete(en.target);
        }
        if (ratios.size === 0) return;

        let bestEl: Element | null = null;
        let best = 0;
        for (const [el, r] of ratios) {
          if (r > best) {
            best = r;
            bestEl = el;
          }
        }
        const id =
          bestEl instanceof HTMLElement
            ? bestEl.dataset.postId ?? null
            : null;
        if (id) scheduleActiveFromScroll(id);
      },
      {
        root,
        rootMargin: '0px 0px -8% 0px',
        threshold: [0, 0.05, 0.15, 0.25, 0.35, 0.5, 0.65, 0.8, 1],
      },
    );

    raf = requestAnimationFrame(() => {
      root.querySelectorAll('[data-timeline-post]').forEach((el) => {
        obs.observe(el);
      });
    });

    return () => {
      cancelAnimationFrame(raf);
      obs.disconnect();
    };
  }, [posts, scheduleActiveFromScroll]);

  const handleSeedTestData = async () => {
    setIsSeeding(true);
    try {
      const result = await seedTimelineTestData();
      if (!result.ok) {
        console.error('Seed test data failed:', result.error);
        window.alert(
          `Seed failed (check RLS / FK policies): ${result.error ?? 'unknown error'}`,
        );
        return;
      }
      if (import.meta.env.DEV) {
        setViewTimelineWithoutPostToday(true);
      }
      setSeedRefreshNonce((n) => n + 1);
    } finally {
      setIsSeeding(false);
    }
  };

  const devSeedButton =
    import.meta.env.DEV ? (
      <button
        type="button"
        onClick={handleSeedTestData}
        disabled={isSeeding}
        className="fixed top-3 left-3 z-[100] rounded-lg border border-amber-500/50 bg-amber-950/90 px-3 py-1.5 text-xs font-semibold text-amber-200 shadow-lg backdrop-blur-sm hover:bg-amber-900/90 disabled:opacity-60"
      >
        {isSeeding ? 'Seeding…' : 'Seed Test Data'}
      </button>
    ) : null;

  useEffect(() => {
    if (!authUserId || !activePost) return;
    refreshReactionsForPost(activePost.id, authUserId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUserId, activePost?.id, posts.length]);

  if (isAuthLoading) {
    return (
      <>
        {devSeedButton}
        <div className="fixed inset-0 flex items-center justify-center bg-zinc-950">
          <div className="text-sm text-zinc-400">Loading timeline...</div>
        </div>
      </>
    );
  }

  const atDailyCap = dailyPostCount >= DAILY_POST_LIMIT;
  const showTimelineGate =
    !atDailyCap && !viewTimelineWithoutPostToday;

  if (showTimelineGate) {
    return (
      <>
        {devSeedButton}
        <LockScreen
          onUnlock={onShareSong}
          shareSongDisabled={shareSongDisabled}
          shareCooldownText={shareCooldownText}
          onViewTimelineWhenCooldown={() => setViewTimelineWithoutPostToday(true)}
          dailyPostCount={dailyPostCount}
          dailyPostLimit={DAILY_POST_LIMIT}
        />
      </>
    );
  }

  if (isLoading) {
    return (
      <>
        {devSeedButton}
        <div className="fixed inset-0 flex items-center justify-center bg-zinc-950">
          <div className="text-sm text-zinc-400">Loading timeline...</div>
        </div>
      </>
    );
  }

  if (!posts.length) {
    return (
      <>
        {devSeedButton}
        <div className="fixed inset-0 flex items-center justify-center bg-zinc-950">
          <div className="max-w-xs text-center text-sm text-zinc-400">
            24時間以内のシェアはまだありません。あなたが最初の曲をシェアしませんか？（1日最大
            {DAILY_POST_LIMIT}回まで）
            {shareSongDisabled && shareCooldownText ? (
              <span className="mt-3 block text-xs text-amber-400/90">
                {shareBlockReason === 'daily'
                  ? `本日のシェア上限（${DAILY_POST_LIMIT}回）に達しています。`
                  : shareCooldownText}
              </span>
            ) : null}
          </div>
        </div>
      </>
    );
  }

  const handlePlayForPost = (post: Post) => {
    if (!post.previewUrl) return;
    if (post.id === activePostId && isPlaying) {
      setIsPlaying(false);
      return;
    }
    if (post.id === activePostId && !isPlaying) {
      flushSync(() => setIsPlaying(true));
      tryLoadAndPlayFromGesture();
      return;
    }
    flushSync(() => {
      setActiveImmediate(post.id);
      setIsPlaying(true);
    });
    tryLoadAndPlayFromGesture();
    requestAnimationFrame(() => {
      scrollRef.current
        ?.querySelector(`[data-post-id="${post.id}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const showShareAnotherEntry = dailyPostCount < DAILY_POST_LIMIT;

  return (
    <>
      {devSeedButton}
      {showShareAnotherEntry ? (
        <div className="pointer-events-none fixed left-0 right-0 top-0 z-[25] flex justify-center px-4 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={() => onShareSong()}
            title={
              shareSongDisabled && shareCooldownText
                ? shareCooldownText
                : undefined
            }
            className={`pointer-events-auto rounded-full border px-4 py-2 text-xs font-semibold shadow-lg backdrop-blur-md transition-colors ${
              shareSongDisabled
                ? 'border-zinc-600/60 bg-zinc-950/85 text-zinc-500 hover:bg-zinc-900/90'
                : 'border-emerald-500/40 bg-zinc-950/90 text-emerald-300 hover:border-emerald-400/60 hover:bg-zinc-900/95 hover:text-emerald-200'
            }`}
          >
            {dailyPostCount === 0
              ? `曲をシェア（本日 ${dailyPostCount}/${DAILY_POST_LIMIT}）`
              : `もう1曲シェアする（本日 ${dailyPostCount}/${DAILY_POST_LIMIT}）`}
          </button>
        </div>
      ) : null}
      <PostReplySheet
        postId={replySheetPostId}
        open={replySheetOpen}
        onClose={closeReplySheet}
        authUserId={authUserId}
        pinnedOriginal={replySheetPinnedOriginal}
        onReplyCreated={(pid) => void syncReplyCount(pid)}
      />

      <div
        ref={scrollRef}
        className="fixed inset-0 snap-y snap-mandatory overflow-y-auto overflow-x-hidden overscroll-y-contain scroll-smooth touch-pan-y pt-[max(env(safe-area-inset-top),0px)] [-webkit-overflow-scrolling:touch]"
        style={{ scrollSnapType: 'y mandatory' }}
      >
        {posts.map((post) => {
          const postUser = usersById[post.userId];
          const profileSlug = postUser?.displayId?.trim()
            ? postUser.displayId
            : post.userId;

          return (
            <section
              key={post.id}
              data-timeline-post
              data-post-id={post.id}
              className="relative flex min-h-[100dvh] snap-start snap-always flex-col items-center justify-center px-6 pb-40 pt-10"
              style={{ scrollSnapAlign: 'start' }}
              onClick={() => openReplySheet(post.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openReplySheet(post.id);
                }
              }}
              role="button"
              tabIndex={0}
              aria-label="返信を開く"
            >
              <div
                className="pointer-events-none absolute inset-0 opacity-20"
                style={{
                  backgroundImage: `url(${post.albumArt})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  filter: 'blur(56px)',
                }}
              />

              <div className="relative z-10 mx-auto flex w-full max-w-md flex-col items-center">
                <div className="relative mx-auto mb-6 w-72 shrink-0 sm:w-80">
                  <img
                    src={post.albumArt}
                    alt={post.songTitle}
                    className="aspect-square w-full rounded-2xl object-cover shadow-2xl"
                  />
                  <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-t from-zinc-950/75 to-transparent" />
                  {post.previewUrl ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePlayForPost(post);
                      }}
                      className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/25 transition-colors hover:bg-black/35"
                      aria-label={
                        post.id === activePostId && isPlaying
                          ? '一時停止'
                          : '再生'
                      }
                    >
                      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 shadow-lg">
                        {post.id === activePostId && isPlaying ? (
                          <Pause className="h-8 w-8 fill-zinc-900 text-zinc-900" />
                        ) : (
                          <Play className="ml-1 h-8 w-8 fill-zinc-900 text-zinc-900" />
                        )}
                      </span>
                    </button>
                  ) : null}
                </div>

                <div className="w-full text-center">
                  <h2 className="mb-1 text-2xl font-bold text-zinc-50 sm:text-3xl">
                    {post.songTitle}
                  </h2>
                  <p className="mb-3 text-lg text-zinc-400 sm:text-xl">
                    {post.artist}
                  </p>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openReplySheet(post.id);
                    }}
                    className="mt-5 inline-flex items-center gap-2 rounded-full border border-zinc-600/80 bg-zinc-900/70 px-4 py-2 text-sm font-medium text-zinc-200 shadow-md backdrop-blur-md transition-colors hover:border-emerald-500/40 hover:bg-zinc-800/90"
                  >
                    <MessageCircle className="h-4 w-4 text-emerald-400" />
                    返信
                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs tabular-nums text-zinc-300">
                      {post.replyCount}
                    </span>
                  </button>
                </div>

                {postUser ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onViewProfile(profileSlug);
                    }}
                    className="mt-5 inline-flex items-center gap-2 text-emerald-400 transition-colors hover:text-emerald-300"
                  >
                    <img
                      src={postUser.avatar || 'https://placehold.co/32x32?text=U'}
                      alt={postUser.name}
                      className="h-8 w-8 rounded-full object-cover"
                    />
                    <span className="text-sm font-medium">{postUser.name}</span>
                  </button>
                ) : (
                  <p className="mt-5 text-xs text-zinc-500">プロフィール読込中…</p>
                )}
              </div>

              <div
                className="mx-auto mt-6 w-full max-w-md px-2"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                role="presentation"
              >
                <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800/80">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400"
                    style={{
                      width:
                        post.id === activePostId && post.previewUrl
                          ? `${Math.min(100, Math.max(0, previewProgress) * 100)}%`
                          : post.id === ioPostId
                            ? '33%'
                            : '12%',
                      opacity:
                        post.id === activePostId || post.id === ioPostId
                          ? 1
                          : 0.35,
                      transition:
                        post.id === activePostId && isPlaying
                          ? 'opacity 0.2s ease'
                          : 'width 0.15s linear, opacity 0.2s ease',
                    }}
                  />
                </div>
                <p className="mt-2 text-center text-xs text-zinc-500">
                  {posts.findIndex((p) => p.id === post.id) + 1} / {posts.length}
                  {post.id === activePostId && post.previewUrl ? (
                    <span className="ml-2 text-[10px] text-zinc-600">
                      プレビュー最大 {PREVIEW_UI_DURATION_SEC} 秒
                    </span>
                  ) : null}
                </p>
              </div>
            </section>
          );
        })}

        <footer className="flex min-h-[32vh] snap-end flex-col items-center justify-center border-t border-zinc-800/60 bg-zinc-950/80 px-6 py-16 text-center">
          <p className="text-sm font-medium text-zinc-500">
            タイムラインはここまで
          </p>
          <p className="mt-2 max-w-xs text-xs leading-relaxed text-zinc-600">
            直近24時間のシェアのみ表示しています
          </p>
        </footer>
      </div>

      <SpotifyPlayer
        ref={spotifyPlayerRef}
        src={
          activePost?.previewUrl?.trim()
            ? activePost.previewUrl
            : null
        }
        playing={isPlaying}
        setPlaying={setIsPlaying}
        onProgress={setPreviewProgress}
      />

      {/* Reaction rail follows the active (debounced) post */}
      {activePost ? (
        <div className="pointer-events-auto fixed bottom-6 left-1/2 z-20 flex -translate-x-1/2 flex-row gap-3 sm:bottom-auto sm:left-auto sm:right-4 sm:top-1/2 sm:translate-x-0 sm:-translate-y-1/2 sm:flex-col sm:gap-4">
          {(Object.keys(instrumentIcons) as InstrumentType[]).map(
            (instrument) => {
              const Icon = instrumentIcons[instrument];
              const count = activePost.reactions[instrument];
              const isMine = userReactionSet.has(instrument);
              return (
                <motion.button
                  key={instrument}
                  type="button"
                  whileTap={{ scale: 0.9 }}
                  onClick={() =>
                    toggleReaction(activePost.id, instrument)
                  }
                  className="group flex flex-col items-center gap-1"
                >
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900/85 backdrop-blur-md transition-all group-hover:scale-110 group-hover:bg-emerald-500/20 ${
                      isMine
                        ? 'bg-emerald-500/10 ring-2 ring-emerald-500/60'
                        : ''
                    }`}
                  >
                    <Icon
                      className={`h-6 w-6 transition-colors ${
                        isMine
                          ? 'text-emerald-400'
                          : 'text-zinc-400 group-hover:text-emerald-400'
                      }`}
                    />
                  </div>
                  <span className="text-xs font-semibold text-zinc-400">
                    {count}
                  </span>
                </motion.button>
              );
            },
          )}
        </div>
      ) : null}
    </>
  );
}
