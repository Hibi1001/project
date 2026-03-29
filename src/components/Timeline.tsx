import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type MouseEvent,
} from 'react';
import { flushSync } from 'react-dom';
import { motion } from 'framer-motion';
import {
  Mic,
  Guitar,
  Music2,
  Drum,
  Piano,
  MessageCircle,
  Trash2,
} from 'lucide-react';
import { Post, InstrumentType, User } from '../types';
import {
  fetchTimelinePosts,
  fetchTimelineBandProjects,
  fetchUserById,
  fetchReplyCountForPost,
  fetchReactionStateForPost,
  type ReactionParticipantPreview,
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
}

type DailyPostRow = { id: string; created_at: string };

/** Song post slice in the merged timeline feed (discriminated by `itemType`). */
type TimelineSongFeedItem = {
  itemType: 'song';
  created_at: string;
  post: Post;
  reactionParticipants: Record<
    InstrumentType,
    ReactionParticipantPreview[]
  >;
};

/** Band recruitment slice — `userId` mirrors `owner_id` for shared user-fetch code paths. */
type TimelineBandProjectFeedItem = {
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

type FeedItem = TimelineSongFeedItem | TimelineBandProjectFeedItem;

export default function Timeline({
  onViewProfile,
  onShareSong,
  timelineRefreshTrigger = 0,
}: TimelineProps) {
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const posts = useMemo(
    () =>
      feedItems
        .filter((i): i is TimelineSongFeedItem => i.itemType === 'song')
        .map((i) => i.post),
    [feedItems],
  );
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
  const [dailyPosts, setDailyPosts] = useState<DailyPostRow[]>([]);
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
  const [bandDeleteBusyId, setBandDeleteBusyId] = useState<string | null>(null);
  const [bandRoleBusyId, setBandRoleBusyId] = useState<string | null>(null);
  const [reactorSheet, setReactorSheet] = useState<{
    postId: string;
    instrument: InstrumentType;
    participants: ReactionParticipantPreview[];
  } | null>(null);

  const instrumentIcons = {
    vocal: Mic,
    guitar: Guitar,
    bass: Music2,
    drum: Drum,
    keyboard: Piano,
  };

  const reactionInstrumentLabel: Record<InstrumentType, string> = {
    vocal: 'ボーカル',
    guitar: 'ギター',
    bass: 'ベース',
    drum: 'ドラム',
    keyboard: 'キーボード',
  };

  /** Only a focused song post drives audio/reactions; `null` when a band card is focused. */
  const activePost =
    activePostId != null
      ? (posts.find((p) => p.id === activePostId) ?? null)
      : null;

  const activeSongFeedItem = useMemo((): TimelineSongFeedItem | null => {
    if (activePostId == null) return null;
    const hit = feedItems.find(
      (i): i is TimelineSongFeedItem =>
        i.itemType === 'song' && i.post.id === activePostId,
    );
    return hit ?? null;
  }, [feedItems, activePostId]);

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

  const focusTimelineFromScroll = useCallback(
    (kind: 'song' | 'band', postId: string | null) => {
      if (kind === 'band') {
        if (scrollDebounceRef.current) {
          clearTimeout(scrollDebounceRef.current);
          scrollDebounceRef.current = null;
        }
        setIoPostId(null);
        setActivePostId(null);
        setIsPlaying(false);
        setPreviewProgress(0);
        return;
      }
      if (postId) scheduleActiveFromScroll(postId);
    },
    [scheduleActiveFromScroll],
  );

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
    setFeedItems((prev: FeedItem[]) =>
      prev.map((feedItem): FeedItem =>
        feedItem.itemType === 'song' && feedItem.post.id === postId
          ? {
              ...feedItem,
              post: { ...feedItem.post, replyCount: c },
            }
          : feedItem,
      ),
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
    const state = await fetchReactionStateForPost(postId, userId);
    if (!state) return;

    setFeedItems((prev: FeedItem[]) =>
      prev.map((item): FeedItem =>
        item.itemType === 'song' && item.post.id === postId
          ? {
              ...item,
              post: { ...item.post, reactions: state.counts },
              reactionParticipants: state.participants,
            }
          : item,
      ),
    );
    setUserReactionSet(state.mine);
  };

  const toggleReaction = (postId: string, instrument: InstrumentType) => {
    if (!authUserId) return;

    const alreadyReacted = userReactionSet.has(instrument);

    setUserReactionSet((prev) => {
      const next = new Set(prev);
      if (alreadyReacted) next.delete(instrument);
      else next.add(instrument);
      return next;
    });
    const selfPreview: ReactionParticipantPreview | null = authUserId
      ? {
          userId: authUserId,
          name: usersById[authUserId]?.name ?? 'あなた',
          avatar: usersById[authUserId]?.avatar ?? '',
        }
      : null;

    setFeedItems((prev: FeedItem[]) =>
      prev.map((item): FeedItem => {
        if (item.itemType !== 'song' || item.post.id !== postId) return item;
        const prevList = item.reactionParticipants[instrument];
        const nextParticipants: Record<
          InstrumentType,
          ReactionParticipantPreview[]
        > = { ...item.reactionParticipants };
        if (alreadyReacted) {
          nextParticipants[instrument] = prevList.filter(
            (p) => p.userId !== authUserId,
          );
        } else if (selfPreview) {
          nextParticipants[instrument] = [
            selfPreview,
            ...prevList.filter((p) => p.userId !== authUserId),
          ];
        }
        return {
          ...item,
          reactionParticipants: nextParticipants,
          post: {
            ...item.post,
            reactions: {
              ...item.post.reactions,
              [instrument]: Math.max(
                0,
                item.post.reactions[instrument] + (alreadyReacted ? -1 : 1),
              ),
            },
          },
        };
      }),
    );

    void (async () => {
      try {
        if (!alreadyReacted) {
          const { error: insertError } = await supabase.from('reactions').insert({
            post_id: postId,
            user_id: authUserId,
            instrument_type: instrument,
          });
          if (insertError) throw insertError;
        } else {
          const { error: deleteError } = await supabase
            .from('reactions')
            .delete()
            .eq('post_id', postId)
            .eq('user_id', authUserId)
            .eq('instrument_type', instrument);
          if (deleteError) throw deleteError;
        }
      } catch (err) {
        console.error('Reaction sync failed', err);
        await refreshReactionsForPost(postId, authUserId);
        window.alert(
          'リアクションを更新できませんでした。通信状況を確認して、もう一度お試しください。',
        );
      }
    })();
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
    const loadTodaysPosts = async () => {
      if (!authUserId) {
        setDailyPosts([]);
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

      const { data, error } = await supabase
        .from('posts')
        .select('id, created_at')
        .eq('user_id', authUserId)
        .gte('created_at', startOfToday.toISOString())
        .order('created_at', { ascending: false })
        .limit(DAILY_POST_LIMIT);

      if (error) {
        console.error('Error loading today posts', error);
        setDailyPosts([]);
        return;
      }

      setDailyPosts((data ?? []) as DailyPostRow[]);
    };

    void loadTodaysPosts();
  }, [authUserId, timelineRefreshTrigger]);

  useEffect(() => {
    if (dailyPosts.length > 0) setViewTimelineWithoutPostToday(false);
  }, [dailyPosts.length]);

  useEffect(() => {
    const loadPosts = async () => {
      setIsLoading(true);
      const [songRows, bandRows] = await Promise.all([
        fetchTimelinePosts(),
        fetchTimelineBandProjects(),
      ]);
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

      const merged = [...songItems, ...bandItems].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );

      setFeedItems(merged);
      const firstSong = merged.find(
        (i): i is TimelineSongFeedItem => i.itemType === 'song',
      );
      const firstId = firstSong?.post.id ?? null;
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
    if (feedItems.length === 0) {
      setUsersById({});
      return;
    }
    let cancelled = false;
    (async () => {
      const ids = new Set<string>();
      if (authUserId) ids.add(authUserId);
      for (const item of feedItems) {
        if (item.itemType === 'song') {
          ids.add(item.post.userId);
          for (const p of Object.values(item.reactionParticipants).flat()) {
            if (p.userId) ids.add(p.userId);
          }
        } else {
          const uid = item.userId || item.owner_id;
          if (uid) ids.add(uid);
          for (const r of item.roles) {
            if (r.applicant_id) ids.add(r.applicant_id);
          }
        }
      }
      const results = await Promise.all([...ids].map((id) => fetchUserById(id)));
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
  }, [feedItems, authUserId]);

  useEffect(() => {
    if (activePostId && !posts.some((p) => p.id === activePostId)) {
      const fallback = posts[0]?.id ?? null;
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
    if (!root || feedItems.length === 0) return;

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
        if (!(bestEl instanceof HTMLElement)) return;
        const itemType = bestEl.dataset.itemType as 'song' | 'band' | undefined;
        const postId = bestEl.dataset.postId ?? null;
        if (itemType === 'band') {
          focusTimelineFromScroll('band', null);
        } else if (itemType === 'song' && postId) {
          focusTimelineFromScroll('song', postId);
        }
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
  }, [feedItems, focusTimelineFromScroll]);

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

  const fullyLocked = dailyPosts.length >= DAILY_POST_LIMIT;
  /** First song of the day: must share (or bypass) before seeing the feed. */
  const showLockGate =
    dailyPosts.length === 0 && !viewTimelineWithoutPostToday;

  if (showLockGate) {
    return (
      <>
        {devSeedButton}
        <LockScreen
          onUnlock={onShareSong}
          onViewTimelineOnly={() => setViewTimelineWithoutPostToday(true)}
          slotsUsed={dailyPosts.length}
          slotsLimit={DAILY_POST_LIMIT}
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
    const showShareCta = dailyPosts.length < DAILY_POST_LIMIT;
    return (
      <>
        {devSeedButton}
        {showShareCta ? (
          <div className="pointer-events-none fixed left-0 right-0 top-0 z-[25] flex justify-center px-4 pt-[max(0.5rem,env(safe-area-inset-top))]">
            <button
              type="button"
              onClick={() => onShareSong()}
              className="pointer-events-auto rounded-full border border-emerald-500/40 bg-zinc-950/90 px-4 py-2 text-xs font-semibold text-emerald-300 shadow-lg backdrop-blur-md transition-colors hover:border-emerald-400/60 hover:bg-zinc-900/95 hover:text-emerald-200"
            >
              {dailyPosts.length === 0
                ? `曲をシェア（本日 ${dailyPosts.length}/${DAILY_POST_LIMIT}）`
                : `もう1曲シェアする（本日 ${dailyPosts.length}/${DAILY_POST_LIMIT}）`}
            </button>
          </div>
        ) : null}
        <div className="fixed inset-0 flex items-center justify-center bg-zinc-950">
          <div className="max-w-xs text-center text-sm text-zinc-400">
            24時間以内のシェアはまだありません。あなたが最初の曲をシェアしませんか？（1日最大
            {DAILY_POST_LIMIT}回まで）
            {fullyLocked ? (
              <span className="mt-3 block text-xs text-amber-400/90">
                本日のシェア上限（{DAILY_POST_LIMIT}回）に達しています。
              </span>
            ) : null}
          </div>
        </div>
      </>
    );
  }

  const handleDeletePost = async (post: Post, e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!authUserId || post.userId !== authUserId) return;
    if (!window.confirm('本当に削除しますか？')) return;
    const { error } = await supabase.from('posts').delete().eq('id', post.id);
    if (error) {
      console.error('Failed to delete post', error);
      return;
    }
    const idx = posts.findIndex((p) => p.id === post.id);
    const nextFeed = feedItems.filter(
      (i) => !(i.itemType === 'song' && i.post.id === post.id),
    );
    setFeedItems(nextFeed);
    const nextPosts = nextFeed
      .filter((i): i is TimelineSongFeedItem => i.itemType === 'song')
      .map((i) => i.post);
    if (replySheetPostId === post.id) closeReplySheet();
    if (nextPosts.length === 0) {
      setActivePostId(null);
      setIoPostId(null);
      setIsPlaying(false);
      return;
    }
    if (activePostId === post.id) {
      const replacement =
        nextPosts[Math.min(idx, nextPosts.length - 1)]?.id ?? nextPosts[0]?.id;
      setActivePostId(replacement ?? null);
    }
    if (ioPostId === post.id) {
      const replacement =
        nextPosts[Math.min(idx, nextPosts.length - 1)]?.id ?? nextPosts[0]?.id;
      setIoPostId(replacement ?? null);
    }
  };

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

  const handleDeleteBandFromTimeline = async (
    bandId: string,
    e: MouseEvent<HTMLButtonElement>,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!authUserId) return;
    if (!window.confirm('この募集を本当に削除しますか？')) return;
    setBandDeleteBusyId(bandId);
    const { error } = await supabase
      .from('band_projects')
      .delete()
      .eq('id', bandId);
    setBandDeleteBusyId(null);
    if (error) {
      console.error('Failed to delete band project', error);
      return;
    }
    setFeedItems((prev) =>
      prev.filter((fi) => !(fi.itemType === 'band' && fi.id === bandId)),
    );
  };

  const handleBandRoleInTimeline = async (
    bandItem: TimelineBandProjectFeedItem,
    role: TimelineBandProjectFeedItem['roles'][number],
    e: MouseEvent<HTMLButtonElement>,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (bandItem.owner_id === authUserId) {
      window.alert(
        '自分の募集には立候補できません（テスト時は別アカウントをご利用ください）',
      );
      return;
    }
    if (!authUserId) return;
    const filled = Boolean(role.applicant_id);
    const isMine = role.applicant_id === authUserId;
    if (filled && !isMine) return;

    setBandRoleBusyId(role.id);
    try {
      if (!filled) {
        const { error } = await supabase
          .from('band_roles')
          .update({ applicant_id: authUserId })
          .eq('id', role.id)
          .is('applicant_id', null);
        if (error) {
          console.error(error);
          return;
        }
        setFeedItems((prev) =>
          prev.map((fi): FeedItem => {
            if (fi.itemType !== 'band' || fi.id !== bandItem.id) return fi;
            return {
              ...fi,
              roles: fi.roles.map((r) =>
                r.id === role.id ? { ...r, applicant_id: authUserId } : r,
              ),
            };
          }),
        );
        const me = await fetchUserById(authUserId);
        if (me) setUsersById((prev) => ({ ...prev, [me.id]: me }));
      } else {
        const { error } = await supabase
          .from('band_roles')
          .update({ applicant_id: null })
          .eq('id', role.id)
          .eq('applicant_id', authUserId);
        if (error) {
          console.error(error);
          return;
        }
        setFeedItems((prev) =>
          prev.map((fi): FeedItem => {
            if (fi.itemType !== 'band' || fi.id !== bandItem.id) return fi;
            return {
              ...fi,
              roles: fi.roles.map((r) =>
                r.id === role.id ? { ...r, applicant_id: null } : r,
              ),
            };
          }),
        );
      }
    } finally {
      setBandRoleBusyId(null);
    }
  };

  const showShareAnotherEntry =
    dailyPosts.length > 0 && dailyPosts.length < DAILY_POST_LIMIT;

  return (
    <>
      {devSeedButton}
      {showShareAnotherEntry ? (
        <div className="pointer-events-none fixed left-0 right-0 top-0 z-[25] flex justify-center px-4 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={() => onShareSong()}
            className="pointer-events-auto rounded-full border border-emerald-500/40 bg-zinc-950/90 px-4 py-2 text-xs font-semibold text-emerald-300 shadow-lg backdrop-blur-md transition-colors hover:border-emerald-400/60 hover:bg-zinc-900/95 hover:text-emerald-200"
          >
            もう1曲シェアする（本日 {dailyPosts.length}/{DAILY_POST_LIMIT}）
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
        className="fixed left-0 right-0 top-0 box-border h-[100dvh] w-full snap-y snap-mandatory overflow-y-auto overflow-x-hidden overscroll-y-contain scroll-smooth touch-pan-y bg-zinc-950 pt-[env(safe-area-inset-top,0px)] [-webkit-overflow-scrolling:touch]"
        style={{ scrollSnapType: 'y mandatory' }}
      >
        {feedItems.map((item) => {
          if (item.itemType === 'band') {
            const ownerKey = item.userId || item.owner_id;
            const owner = ownerKey ? usersById[ownerKey] : undefined;
            const ownerSlug = owner?.displayId?.trim()
              ? owner.displayId
              : ownerKey || '';
            const bandPosition =
              feedItems.findIndex(
                (x) => x.itemType === 'band' && x.id === item.id,
              ) + 1;

            return (
              <section
                key={item.id}
                data-timeline-post
                data-item-type="band"
                data-band-id={item.id}
                className="relative box-border flex min-h-[100dvh] shrink-0 snap-start snap-always flex-col items-center justify-start px-6 pb-40 pt-10"
                style={{ scrollSnapAlign: 'start' }}
                aria-label="バンド募集"
              >
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-zinc-950 via-zinc-900/95 to-emerald-950/35 opacity-[0.92]" />
                <div className="relative z-10 mx-auto h-auto w-full max-w-md rounded-2xl border border-white/[0.08] bg-zinc-900/55 p-6 shadow-xl ring-1 ring-emerald-500/15 backdrop-blur-md sm:p-7">
                  <div className="mb-4 flex items-center justify-center gap-2 text-emerald-400/95">
                    <span className="text-4xl" aria-hidden>
                      🎸
                    </span>
                    <span className="text-sm font-semibold tracking-wide">
                      メンバー募集
                    </span>
                  </div>
                  <div className="flex w-full flex-col items-center gap-2.5 text-center sm:gap-3">
                    <div className="flex w-full max-w-md items-start justify-between gap-2">
                      <h2 className="min-w-0 flex-1 text-balance text-2xl font-bold leading-tight text-zinc-50 sm:text-3xl">
                        {item.band_name || item.songTitle || 'バンド募集'}
                      </h2>
                      {authUserId && item.owner_id === authUserId ? (
                        <button
                          type="button"
                          disabled={bandDeleteBusyId === item.id}
                          onClick={(e) =>
                            void handleDeleteBandFromTimeline(item.id, e)
                          }
                          className="shrink-0 rounded-lg border border-zinc-700/80 bg-zinc-800/60 p-2 text-zinc-400 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
                          aria-label="募集を削除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                    {item.description?.trim() ? (
                      <div className="w-full px-0.5">
                        <p className="break-words rounded-2xl border border-white/[0.08] bg-black/35 px-3.5 py-2.5 text-left text-sm font-normal leading-relaxed tracking-wide text-zinc-200/95 shadow-inner backdrop-blur-sm sm:px-4 sm:text-[0.9375rem]">
                          {item.description.trim()}
                        </p>
                      </div>
                    ) : null}
                    {(item.roles?.length ?? 0) > 0 ? (
                      <div className="mt-1 flex flex-wrap justify-center gap-3">
                        {(item.roles ?? []).map((r) => {
                          const Inst =
                            instrumentIcons[r.instrument_type] ?? Music2;
                          const filled = Boolean(r.applicant_id);
                          const isMine =
                            Boolean(authUserId) &&
                            r.applicant_id === authUserId;
                          const isOwner =
                            Boolean(authUserId) &&
                            item.owner_id === authUserId;
                          const otherFilled = filled && !isMine;
                          const disabled =
                            bandRoleBusyId === r.id || otherFilled;
                          const applicant = r.applicant_id
                            ? usersById[r.applicant_id]
                            : undefined;
                          return (
                            <button
                              key={r.id}
                              type="button"
                              disabled={disabled}
                              onClick={(e) =>
                                void handleBandRoleInTimeline(item, r, e)
                              }
                              className={`group relative flex min-w-[4.5rem] flex-col items-center gap-1 rounded-xl border px-2.5 py-2.5 transition-all ${
                                otherFilled
                                  ? 'cursor-default border-zinc-600/50 bg-zinc-800/80'
                                  : isOwner
                                    ? 'cursor-pointer border-zinc-700/60 border-dashed bg-zinc-950/60 opacity-90'
                                    : filled && isMine
                                      ? 'cursor-pointer border-emerald-500/35 bg-zinc-900/70'
                                      : 'cursor-pointer border-amber-500/35 bg-amber-500/[0.07] hover:border-amber-400/55 hover:bg-amber-500/12 active:scale-[0.98]'
                              } disabled:opacity-50`}
                              title={r.instrument_type}
                            >
                              <div
                                className={`relative flex h-[4.25rem] w-[4.25rem] items-center justify-center rounded-xl bg-zinc-950/80 ring-1 ring-inset ring-zinc-700/50 ${
                                  filled && applicant ? 'ring-emerald-500/25' : ''
                                }`}
                                title={
                                  filled && applicant
                                    ? applicant.name
                                    : r.instrument_type
                                }
                              >
                                {filled && applicant ? (
                                  <>
                                    <img
                                      src={
                                        applicant.avatar ||
                                        'https://placehold.co/64x64?text=U'
                                      }
                                      alt=""
                                      className="h-8 w-8 rounded-full border-2 border-zinc-900 object-cover ring-2 ring-emerald-500/35"
                                    />
                                    <Inst
                                      className="absolute bottom-0.5 right-0.5 h-4 w-4 text-emerald-400/95 drop-shadow-md"
                                      aria-hidden
                                    />
                                  </>
                                ) : (
                                  <Inst
                                    className={`h-6 w-6 ${
                                      otherFilled
                                        ? 'text-zinc-500'
                                        : 'text-amber-400/90 group-hover:text-amber-300'
                                    }`}
                                  />
                                )}
                              </div>
                              {filled && applicant ? (
                                <span className="max-w-[5.5rem] truncate text-center text-[10px] font-medium text-zinc-300">
                                  {applicant.name}
                                </span>
                              ) : (
                                <span className="text-[10px] font-medium text-zinc-500">
                                  {r.instrument_type}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                  {owner ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onViewProfile(ownerSlug || owner.id);
                      }}
                      className="inline-flex items-center gap-2 text-emerald-400 transition-colors hover:text-emerald-300"
                    >
                      <img
                        src={
                          owner.avatar || 'https://placehold.co/32x32?text=U'
                        }
                        alt={owner.name}
                        className="h-8 w-8 rounded-full object-cover"
                      />
                      <span className="text-sm font-medium">{owner.name}</span>
                    </button>
                  ) : (
                    <p className="text-xs text-zinc-500">プロフィール読込中…</p>
                  )}
                </div>
                <div
                  className="mx-auto mt-6 w-full max-w-md px-2"
                  role="presentation"
                >
                  <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800/50">
                    <div className="h-full w-[18%] rounded-full bg-emerald-500/25" />
                  </div>
                  <p className="mt-2 text-center text-xs text-zinc-500">
                    {bandPosition} / {feedItems.length}
                  </p>
                </div>
              </section>
            );
          }

          if (item.itemType !== 'song') {
            return null;
          }

          const post = item.post;
          const postUser = usersById[post.userId];
          const profileSlug = postUser?.displayId?.trim()
            ? postUser.displayId
            : post.userId;
          const songPosition =
            feedItems.findIndex(
              (x) => x.itemType === 'song' && x.post.id === post.id,
            ) + 1;

          return (
            <section
              key={post.id}
              data-timeline-post
              data-item-type="song"
              data-post-id={post.id}
              className="relative box-border flex h-[100dvh] min-h-[100dvh] shrink-0 snap-start snap-always flex-col items-center justify-center px-6 pb-40 pt-10"
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

              <div className="relative z-10 mx-auto flex w-full max-w-md flex-col items-center gap-3 sm:gap-4">
                <div className="relative mx-auto w-72 shrink-0 sm:w-80">
                  {post.previewUrl ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePlayForPost(post);
                      }}
                      className={`relative block w-full overflow-hidden rounded-2xl shadow-2xl transition-[transform,box-shadow] duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/45 ${
                        post.id === activePostId && isPlaying
                          ? 'scale-[1.02] shadow-[0_0_32px_rgba(16,185,129,0.22)] ring-2 ring-emerald-400/30'
                          : 'ring-2 ring-transparent'
                      }`}
                      aria-pressed={
                        post.id === activePostId ? isPlaying : false
                      }
                      aria-label={
                        post.id === activePostId && isPlaying
                          ? '一時停止（タップ）'
                          : '再生（タップ）'
                      }
                    >
                      <img
                        src={post.albumArt}
                        alt={post.songTitle}
                        className="aspect-square w-full object-cover"
                      />
                      <div
                        className={`pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-t transition-opacity duration-300 ${
                          post.id === activePostId && isPlaying
                            ? 'from-zinc-950/50 to-transparent opacity-90'
                            : 'from-zinc-950/70 to-transparent'
                        }`}
                      />
                    </button>
                  ) : (
                    <div className="relative overflow-hidden rounded-2xl shadow-2xl ring-2 ring-zinc-800/40">
                      <img
                        src={post.albumArt}
                        alt={post.songTitle}
                        className="aspect-square w-full object-cover"
                      />
                      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-t from-zinc-950/70 to-transparent" />
                    </div>
                  )}
                </div>

                <div className="flex w-full flex-col items-center gap-2.5 text-center sm:gap-3">
                  <h2 className="text-balance text-2xl font-bold leading-tight text-zinc-50 sm:text-3xl">
                    {post.songTitle}
                  </h2>
                  <p className="text-balance text-lg leading-snug text-zinc-400 sm:text-xl">
                    {post.artist}
                  </p>

                  {post.caption?.trim() ? (
                    <div className="w-full max-w-sm px-0.5">
                      <p className="max-h-[min(28dvh,9.5rem)] overflow-y-auto break-words rounded-2xl border border-white/[0.08] bg-black/40 px-3.5 py-2.5 text-left text-sm font-normal leading-relaxed tracking-wide text-zinc-200/95 shadow-lg [-webkit-overflow-scrolling:touch] backdrop-blur-md sm:max-h-[min(32dvh,12rem)] sm:px-4 sm:text-[0.9375rem]">
                        {post.caption.trim()}
                      </p>
                    </div>
                  ) : null}

                  <div className="mt-0.5 flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openReplySheet(post.id);
                      }}
                      className="inline-flex items-center gap-2 rounded-full border border-zinc-600/80 bg-zinc-900/70 px-4 py-2 text-sm font-medium text-zinc-200 shadow-md backdrop-blur-md transition-colors hover:border-emerald-500/40 hover:bg-zinc-800/90"
                    >
                      <MessageCircle className="h-4 w-4 text-emerald-400" />
                      返信
                      <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs tabular-nums text-zinc-300">
                        {post.replyCount}
                      </span>
                    </button>
                    {authUserId && post.userId === authUserId ? (
                      <button
                        type="button"
                        onClick={(e) => void handleDeletePost(post, e)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-zinc-600/80 bg-zinc-900/70 px-3 py-2 text-sm font-medium text-zinc-300 shadow-md backdrop-blur-md transition-colors hover:border-zinc-500 hover:bg-zinc-800/90"
                        aria-label="削除"
                      >
                        <Trash2 className="h-4 w-4 text-zinc-400" />
                        削除
                      </button>
                    ) : null}
                  </div>
                </div>

                {postUser ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onViewProfile(profileSlug);
                    }}
                    className="inline-flex items-center gap-2 text-emerald-400 transition-colors hover:text-emerald-300"
                  >
                    <img
                      src={postUser.avatar || 'https://placehold.co/32x32?text=U'}
                      alt={postUser.name}
                      className="h-8 w-8 rounded-full object-cover"
                    />
                    <span className="text-sm font-medium">{postUser.name}</span>
                  </button>
                ) : (
                  <p className="text-xs text-zinc-500">プロフィール読込中…</p>
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
                  {songPosition} / {feedItems.length}
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

        <footer className="flex min-h-[32dvh] snap-end flex-col items-center justify-center border-t border-zinc-800/60 bg-zinc-950 px-6 pt-16 pb-[calc(4rem+env(safe-area-inset-bottom,0px))] text-center">
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
        <div className="pointer-events-auto fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] left-1/2 z-20 flex -translate-x-1/2 flex-row gap-3 sm:bottom-auto sm:left-auto sm:right-4 sm:top-1/2 sm:translate-x-0 sm:-translate-y-1/2 sm:flex-col sm:gap-4">
          {(Object.keys(instrumentIcons) as InstrumentType[]).map(
            (instrument) => {
              const Icon = instrumentIcons[instrument];
              const count = activePost.reactions[instrument];
              const isMine = userReactionSet.has(instrument);
              const participants =
                activeSongFeedItem?.reactionParticipants[instrument] ?? [];
              const stack = participants.slice(0, 3);
              return (
                <div
                  key={instrument}
                  className="flex flex-col items-center gap-1"
                >
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.9 }}
                    onClick={() =>
                      toggleReaction(activePost.id, instrument)
                    }
                    className="group flex flex-col items-center"
                    aria-label={`${reactionInstrumentLabel[instrument]}でリアクション`}
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
                  </motion.button>
                  <button
                    type="button"
                    disabled={count === 0}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (count === 0) return;
                      setReactorSheet({
                        postId: activePost.id,
                        instrument,
                        participants,
                      });
                    }}
                    title={
                      count > 0
                        ? `${reactionInstrumentLabel[instrument]} ${count} 件`
                        : undefined
                    }
                    className="flex min-h-[1.75rem] items-center justify-center gap-1 rounded-lg px-1 disabled:cursor-default disabled:opacity-40"
                  >
                    {stack.length > 0 ? (
                      <div className="flex items-center -space-x-2 pr-0.5">
                        {stack.map((p, idx) => (
                          <img
                            key={`${p.userId}-${idx}`}
                            src={
                              p.avatar ||
                              'https://placehold.co/64x64?text=U'
                            }
                            alt=""
                            className="h-6 w-6 rounded-full border-2 border-zinc-950 object-cover ring-1 ring-zinc-700/90"
                          />
                        ))}
                      </div>
                    ) : null}
                    <span className="text-xs font-semibold tabular-nums text-zinc-400">
                      {count}
                    </span>
                  </button>
                </div>
              );
            },
          )}
        </div>
      ) : null}

      {reactorSheet ? (
        <div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-black/65 backdrop-blur-[2px] sm:items-center"
          role="presentation"
          onClick={() => setReactorSheet(null)}
        >
          <div
            role="dialog"
            aria-labelledby="reactor-sheet-title"
            className="max-h-[min(70dvh,28rem)] w-full max-w-sm overflow-hidden rounded-t-2xl border border-zinc-800 bg-zinc-900 shadow-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-zinc-800 px-4 py-3">
              <h2
                id="reactor-sheet-title"
                className="text-sm font-semibold text-zinc-100"
              >
                {reactionInstrumentLabel[reactorSheet.instrument]} リアクション
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                Reacted by（{reactorSheet.participants.length} 人）
              </p>
            </div>
            <ul className="max-h-[min(50dvh,20rem)] space-y-1 overflow-y-auto p-3">
              {reactorSheet.participants.map((p) => (
                <li
                  key={p.userId}
                  className="flex items-center gap-3 rounded-xl bg-zinc-950/60 px-2 py-2"
                >
                  <img
                    src={
                      p.avatar || 'https://placehold.co/64x64?text=U'
                    }
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-zinc-700/80"
                  />
                  <span className="min-w-0 truncate text-sm font-medium text-zinc-200">
                    {p.name}
                  </span>
                </li>
              ))}
            </ul>
            <div className="border-t border-zinc-800 p-3">
              <button
                type="button"
                onClick={() => setReactorSheet(null)}
                className="w-full rounded-xl bg-zinc-800 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-700"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
