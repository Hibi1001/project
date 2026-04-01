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
import { Post, User } from '../types';
import {
  fetchTimelinePosts,
  fetchTimelineBandProjects,
  fetchUserById,
  fetchReplyCountForPost,
} from '../lib/api';
import {
  buildMergedTimelineFeed,
  type FeedItem,
  type TimelineBandProjectFeedItem,
  type TimelineSongFeedItem,
} from '../lib/timelineFeed';
import LoadingSpinner from './LoadingSpinner';
import { supabase } from '../lib/supabase';
import { seedTimelineTestData } from '../lib/seedTestData';
import LockScreen from './LockScreen';
import Navbar from './Navbar';
import PostReplySheet from './PostReplySheet';
import ReactionButtons from './ReactionButtons';
import SpotifyPlayer, {
  PREVIEW_UI_DURATION_SEC,
  type SpotifyPlayerHandle,
} from './SpotifyPlayer';
import { DAILY_POST_LIMIT } from '../constants/posting';

/** Soft fade + slide-up when a snap slide enters the viewport (framer-motion). */
const timelineSlideEnterMotion = {
  initial: { opacity: 0, y: 22 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.32 },
  transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const },
};

const instrumentIcons = {
  vocal: Mic,
  guitar: Guitar,
  bass: Music2,
  drum: Drum,
  keyboard: Piano,
};

interface TimelineProps {
  /** UUID or `display_id` for routing (`/@handle` or `/user/uuid`). */
  onViewProfile: (profileSlug: string) => void;
  onShareSong: () => void;
  timelineRefreshTrigger?: number;
  onOpenNotifications?: () => void;
  hasUnreadNotifications?: boolean;
  /** Open band recruitment board (Navbar). */
  onOpenBoard?: () => void;
  /** Manual refresh (Navbar). */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** When false, Timeline should pause audio but keep state/scroll intact. */
  isForeground?: boolean;
  /** Set true after a confirmed user gesture (LockScreen tap, etc.). */
  hasUserGesture?: boolean;
  /** Restore scroll to a post when re-entering Timeline. */
  restorePostId?: string | null;
  /** Report which post is currently active (for restoration). */
  onActivePostIdChange?: (postId: string | null) => void;
  /** Open reply sheet for this post after feed is ready (e.g. from notification tap). */
  openReplyForPostId?: string | null;
  onConsumedOpenReplyForPostId?: () => void;
  /** Logged-in user id from App — avoids a redundant getUser() on mount. */
  authUserId?: string | null;
  /**
   * Initial feed from App (fetched in parallel with profile gate).
   * When omitted, Timeline loads the feed itself (legacy / tests).
   */
  feedBootstrap?: { loading: boolean; items: FeedItem[] | null };
}

type DailyPostRow = { id: string; created_at: string };

export default function Timeline({
  onViewProfile,
  onShareSong,
  timelineRefreshTrigger = 0,
  onOpenNotifications,
  hasUnreadNotifications = false,
  onOpenBoard,
  onRefresh,
  refreshing = false,
  isForeground = true,
  hasUserGesture: hasUserGestureProp = false,
  restorePostId = null,
  onActivePostIdChange,
  openReplyForPostId = null,
  onConsumedOpenReplyForPostId,
  authUserId: authUserIdProp,
  feedBootstrap,
}: TimelineProps) {
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const posts = useMemo(
    () =>
      feedItems
        .filter((i): i is TimelineSongFeedItem => i.itemType === 'song')
        .map((i) => i.post),
    [feedItems],
  );
  const postsRef = useRef<Post[]>([]);
  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);
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
  const usersByIdRef = useRef<Record<string, User>>({});
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
  const [hasUserGesture, setHasUserGesture] = useState(false);
  const [autoplayBlockedPostId, setAutoplayBlockedPostId] = useState<
    string | null
  >(null);
  const lastAutoplayAttemptRef = useRef<{ postId: string; at: number } | null>(
    null,
  );
  const autoplayDelayRef = useRef<number | null>(null);
  const lastAutoAdvanceFromPostIdRef = useRef<string | null>(null);
  const [replySheetOpen, setReplySheetOpen] = useState(false);
  const [replySheetPostId, setReplySheetPostId] = useState<string | null>(
    null,
  );
  const [bandDeleteBusyId, setBandDeleteBusyId] = useState<string | null>(null);
  const [bandRoleBusyId, setBandRoleBusyId] = useState<string | null>(null);
  const feedBootstrapConsumedRef = useRef(false);
  /** Run `restorePostId` scroll at most once each time Timeline becomes foreground. */
  const restoreScrollConsumedRef = useRef(false);

  // NOTE: instrument icon maps are module-scope constants.

  /** Only a focused song post drives audio/reactions; `null` when a band card is focused. */
  const activePost =
    activePostId != null
      ? (posts.find((p) => p.id === activePostId) ?? null)
      : null;

  // activeSongFeedItem (instrument reaction rail) removed.

  const myProfileSlug = useMemo(() => {
    if (!authUserId) return null;
    const me = usersById[authUserId];
    if (me?.displayId?.trim()) return me.displayId;
    return authUserId;
  }, [authUserId, usersById]);

  const timelineNavbar =
    authUserId && myProfileSlug ? (
      <Navbar
        onOpenNotifications={onOpenNotifications}
        hasUnreadNotifications={hasUnreadNotifications}
        onOpenBoard={onOpenBoard}
        onOpenTimeline={undefined}
        onRefresh={onRefresh}
        refreshing={refreshing}
        active="timeline"
        onOpenPost={() => onShareSong()}
        postDisabled={false}
        onOpenProfile={() => onViewProfile(myProfileSlug)}
        profileAvatarUrl={usersById[authUserId]?.avatar}
      />
    ) : null;

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

  useEffect(() => {
    onActivePostIdChange?.(activePostId);
  }, [activePostId, onActivePostIdChange]);

  useEffect(() => {
    if (isForeground) return;
    restoreScrollConsumedRef.current = false;
    // Pause playback when covered by another view. SpotifyPlayer keeps `currentTime`
    // when `playing` becomes false (same src) — no full reset.
    setIsPlaying(false);
  }, [isForeground]);

  useEffect(() => {
    if (!hasUserGestureProp) return;
    setHasUserGesture(true);
    setAutoplayBlockedPostId(null);
  }, [hasUserGestureProp]);

  useEffect(() => {
    if (!isForeground) return;
    const pid = restorePostId?.trim() ?? '';
    if (!pid) return;
    if (!posts.some((p) => p.id === pid)) return;
    if (restoreScrollConsumedRef.current) return;

    let cancelled = false;
    let timeoutId: number | undefined;

    const run = () => {
      if (cancelled) return;
      restoreScrollConsumedRef.current = true;
      const el = scrollRef.current?.querySelector(`[data-post-id="${pid}"]`);
      el?.scrollIntoView({ behavior: 'auto', block: 'center' });
      setActivePostId(pid);
      setIoPostId(pid);
      prevStableActiveRef.current = pid;
    };

    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        timeoutId = window.setTimeout(run, 90);
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [isForeground, restorePostId, posts]);

  const scheduleActiveFromScroll = useCallback((postId: string) => {
    // Strict single playback: as soon as IO suggests a *different* post, stop current audio
    // immediately (don't wait for the scroll debounce to complete).
    if (activePostIdRef.current && activePostIdRef.current !== postId) {
      spotifyPlayerRef.current?.pauseAndReset();
    }
    setIoPostId(postId);
    const prevActive = activePostIdRef.current;
    if (scrollDebounceRef.current) clearTimeout(scrollDebounceRef.current);
    scrollDebounceRef.current = setTimeout(() => {
      scrollDebounceRef.current = null;
      // If IO fires due to rerenders (e.g. reaction count change) but the active post
      // hasn't actually changed, do not interrupt playback.
      if (activePostIdRef.current === postId) return;

      // Prevent a one-frame “carryover” play on src change:
      // we only want the delayed autoplay effect to start playback for a *new* post.
      if (prevActive !== postId) {
        setIsPlaying(false);
        setPreviewProgress(0);
      }
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
        spotifyPlayerRef.current?.pauseAndReset();
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
    if (activePostIdRef.current && activePostIdRef.current !== postId) {
      spotifyPlayerRef.current?.pauseAndReset();
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

  // Reactions UI has been redesigned into local-only `ReactionButtons`.

  useEffect(() => {
    if (authUserIdProp) {
      setAuthUserId(authUserIdProp);
      setIsAuthLoading(false);
    }

    let cancelled = false;
    if (!authUserIdProp) {
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
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUserId(session?.user?.id ?? null);
      setIsAuthLoading(false);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [authUserIdProp]);

  useEffect(() => {
    feedBootstrapConsumedRef.current = false;
  }, [authUserIdProp]);

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
    if (!openReplyForPostId || isLoading) return;
    const hasPost = feedItems.some(
      (i) => i.itemType === 'song' && i.post.id === openReplyForPostId,
    );
    if (hasPost) return;
    onConsumedOpenReplyForPostId?.();
    window.alert(
      'この投稿はタイムラインに表示されていません（24時間を過ぎた可能性があります）。',
    );
  }, [openReplyForPostId, isLoading, feedItems, onConsumedOpenReplyForPostId]);

  useEffect(() => {
    if (!openReplyForPostId || isLoading) return;
    const hasPost = feedItems.some(
      (i) => i.itemType === 'song' && i.post.id === openReplyForPostId,
    );
    if (!hasPost) return;
    const pid = openReplyForPostId;
    requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector(`[data-post-id="${pid}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    setActivePostId(pid);
    setReplySheetPostId(pid);
    setReplySheetOpen(true);
    onConsumedOpenReplyForPostId?.();
  }, [openReplyForPostId, isLoading, feedItems, onConsumedOpenReplyForPostId]);

  useEffect(() => {
    const applyMerged = (merged: FeedItem[], opts?: { scrollToTop?: boolean }) => {
      setFeedItems(merged);
      const firstSong = merged.find(
        (i): i is TimelineSongFeedItem => i.itemType === 'song',
      );
      const firstId = firstSong?.post.id ?? null;
      setIoPostId(firstId);
      setActivePostId(firstId);
      prevStableActiveRef.current = firstId;
      if (opts?.scrollToTop) {
        requestAnimationFrame(() => {
          const root = scrollRef.current;
          if (!root) return;
          if (firstId) {
            root
              .querySelector(`[data-post-id="${firstId}"]`)
              ?.scrollIntoView({ behavior: 'auto', block: 'start' });
          } else {
            root.scrollTo({ top: 0, behavior: 'auto' });
          }
        });
      }
      if (scrollDebounceRef.current) {
        clearTimeout(scrollDebounceRef.current);
        scrollDebounceRef.current = null;
      }
      setIsLoading(false);
    };

    const loadPostsFromNetwork = async () => {
      setIsLoading(true);
      try {
        const [songRows, bandRows] = await Promise.all([
          fetchTimelinePosts(),
          fetchTimelineBandProjects(),
        ]);
        const merged = buildMergedTimelineFeed(songRows, bandRows);
        applyMerged(merged, { scrollToTop: isRefresh && isForeground });
      } catch (e) {
        console.error('[Timeline] loadPostsFromNetwork', e);
        applyMerged([], { scrollToTop: false });
      }
    };

    const isRefresh = timelineRefreshTrigger > 0 || seedRefreshNonce > 0;

    if (feedBootstrap !== undefined) {
      if (feedBootstrap.loading) {
        setIsLoading(true);
        return;
      }
      if (isRefresh) {
        void loadPostsFromNetwork();
        return;
      }
      if (!feedBootstrapConsumedRef.current && feedBootstrap.items != null) {
        feedBootstrapConsumedRef.current = true;
        applyMerged(feedBootstrap.items, { scrollToTop: false });
        return;
      }
      // App should always pass `items` as an array when loading completes; if not, recover via network.
      if (!feedBootstrapConsumedRef.current && feedBootstrap.items == null) {
        void loadPostsFromNetwork();
        return;
      }
      return;
    }

    void loadPostsFromNetwork();
  }, [
    timelineRefreshTrigger,
    seedRefreshNonce,
    feedBootstrap,
  ]);

  useEffect(() => {
    usersByIdRef.current = usersById;
  }, [usersById]);

  const neededUserIds = useMemo(() => {
    const ids = new Set<string>();
    if (authUserId) ids.add(authUserId);
    for (const item of feedItems) {
      if (item.itemType === 'song') {
        ids.add(item.post.userId);
        // Reaction participant stacks can introduce many IDs; still fetch, but only missing ones.
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
    return ids;
  }, [feedItems, authUserId]);

  const fetchUsersDebounceRef = useRef<number | null>(null);
  useEffect(() => {
    if (feedItems.length === 0) {
      setUsersById({});
      return;
    }
    let cancelled = false;

    if (fetchUsersDebounceRef.current) {
      clearTimeout(fetchUsersDebounceRef.current);
      fetchUsersDebounceRef.current = null;
    }

    // Debounce + fetch missing-only: avoids re-reading lots of users on every reaction update.
    fetchUsersDebounceRef.current = window.setTimeout(() => {
      fetchUsersDebounceRef.current = null;
      void (async () => {
        const current = usersByIdRef.current;
        const missing = [...neededUserIds].filter((id) => !current[id]);
        if (missing.length === 0) return;
        const results = await Promise.all(missing.map((id) => fetchUserById(id)));
        if (cancelled) return;
        const patch: Record<string, User> = {};
        results.forEach((u) => {
          if (u) patch[u.id] = u;
        });
        if (Object.keys(patch).length === 0) return;
        setUsersById((prev) => ({ ...prev, ...patch }));
      })();
    }, 250);

    return () => {
      cancelled = true;
      if (fetchUsersDebounceRef.current) {
        clearTimeout(fetchUsersDebounceRef.current);
        fetchUsersDebounceRef.current = null;
      }
    };
  }, [feedItems.length, neededUserIds]);

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
        threshold: [0.8, 0.9, 1],
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

  // Autoplay is allowed only after a user gesture (browser policy).
  useEffect(() => {
    if (hasUserGesture) return;
    const onFirstGesture = () => {
      setHasUserGesture(true);
      setAutoplayBlockedPostId(null);
    };
    window.addEventListener('pointerdown', onFirstGesture, { once: true });
    window.addEventListener('keydown', onFirstGesture, { once: true });
    window.addEventListener('touchstart', onFirstGesture, { once: true });
    return () => {
      window.removeEventListener('pointerdown', onFirstGesture);
      window.removeEventListener('keydown', onFirstGesture);
      window.removeEventListener('touchstart', onFirstGesture);
    };
  }, [hasUserGesture]);

  // TikTok-style: when the active post changes, attempt to start playback automatically.
  useEffect(() => {
    if (autoplayDelayRef.current) {
      clearTimeout(autoplayDelayRef.current);
      autoplayDelayRef.current = null;
    }

    if (!isForeground) {
      setIsPlaying(false);
      setPreviewProgress(0);
      return;
    }

    if (!activePostId) {
      setAutoplayBlockedPostId(null);
      setIsPlaying(false);
      setPreviewProgress(0);
      return;
    }
    const p = postsRef.current.find((x) => x.id === activePostId);
    if (!p?.previewUrl?.trim()) {
      setAutoplayBlockedPostId(null);
      setIsPlaying(false);
      setPreviewProgress(0);
      return;
    }

    if (!hasUserGesture) {
      // Autoplay is not allowed until the user has interacted with the page.
      setAutoplayBlockedPostId(activePostId);
      setIsPlaying(false);
      setPreviewProgress(0);
      return;
    }

    setAutoplayBlockedPostId(null);
    // Always start in a paused state, then start after debounce.
    setIsPlaying(false);
    setPreviewProgress(0);

    // Debounced autoplay: prevents race where rapid IO changes cause play() then immediate pause().
    const targetPostId = activePostId;
    autoplayDelayRef.current = window.setTimeout(() => {
      autoplayDelayRef.current = null;
      if (activePostIdRef.current !== targetPostId) return;
      const stillHasPreview = Boolean(
        postsRef.current.find((x) => x.id === targetPostId)?.previewUrl?.trim(),
      );
      if (!stillHasPreview) return;
      lastAutoplayAttemptRef.current = { postId: targetPostId, at: Date.now() };
      setIsPlaying(true);
    }, 800);

    return () => {
      if (autoplayDelayRef.current) {
        clearTimeout(autoplayDelayRef.current);
        autoplayDelayRef.current = null;
      }
    };
  }, [activePostId, hasUserGesture, isForeground]);

  // If autoplay failed (SpotifyPlayer flips `playing` back to false), show a tap overlay.
  useEffect(() => {
    if (!activePostId) return;
    if (isPlaying) return;
    const attempt = lastAutoplayAttemptRef.current;
    if (!attempt || attempt.postId !== activePostId) return;
    if (Date.now() - attempt.at > 1200) return;
    setAutoplayBlockedPostId(activePostId);
  }, [isPlaying, activePostId]);

  // Auto-advance to next post when the preview finishes.
  useEffect(() => {
    if (!activePostId) return;
    if (isPlaying) return;
    if (previewProgress < 0.999) return;
    if (lastAutoAdvanceFromPostIdRef.current === activePostId) return;

    const songIds = feedItems
      .filter((i): i is TimelineSongFeedItem => i.itemType === 'song')
      .map((i) => i.post.id);
    const idx = songIds.findIndex((id) => id === activePostId);
    if (idx < 0) return;
    const nextId = songIds[idx + 1] ?? null;
    if (!nextId) return;

    lastAutoAdvanceFromPostIdRef.current = activePostId;
    requestAnimationFrame(() => {
      scrollRef.current
        ?.querySelector(`[data-post-id="${nextId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [previewProgress, activePostId, isPlaying, feedItems]);

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
        className="fixed left-3 top-3 z-[100] rounded-lg border border-amber-500/50 bg-amber-950/90 px-3 py-1.5 text-xs font-semibold text-amber-200 shadow-lg backdrop-blur-sm hover:bg-amber-900/90 disabled:opacity-60"
      >
        {isSeeding ? 'Seeding…' : 'Seed Test Data'}
      </button>
    ) : null;

  // Reaction state is handled locally per-post (no global refresh on focus).

  if (feedBootstrap?.loading || isAuthLoading) {
    return (
      <>
        {devSeedButton}
        <div className="fixed inset-0 z-[120] bg-zinc-950">
          <LoadingSpinner
            label={
              feedBootstrap?.loading
                ? '読み込み中…'
                : 'タイムラインを準備しています…'
            }
          />
        </div>
      </>
    );
  }

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
        <div className="fixed inset-0 z-[120] bg-zinc-950">
          <LoadingSpinner label="読み込み中…" />
        </div>
      </>
    );
  }

  if (!posts.length) {
    return (
      <>
        {devSeedButton}
        {timelineNavbar}
        <div className="fixed inset-0 flex flex-col items-center justify-center bg-zinc-950 px-6 pb-[calc(5rem+env(safe-area-inset-bottom,0px))] pt-[env(safe-area-inset-top,0px)]">
          <div className="max-w-xs text-center text-sm text-zinc-400">
            24時間以内のシェアはまだありません。あなたが最初の曲をシェアしませんか？
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

  return (
    <>
      {devSeedButton}
      {timelineNavbar}
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
        className="fixed left-0 right-0 top-0 box-border h-[100dvh] w-full snap-y snap-mandatory overflow-y-auto overflow-x-hidden overscroll-y-contain touch-pan-y bg-zinc-950 scroll-pb-[calc(16rem+env(safe-area-inset-bottom,0px))] scroll-pt-[env(safe-area-inset-top,0px)] [-webkit-overflow-scrolling:touch]"
        style={{ scrollSnapType: 'y mandatory' }}
      >
        {feedItems.map((item, feedIndex) => {
          const isFirstFeedItem = feedIndex === 0;
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
              <motion.section
                key={item.id}
                data-timeline-post
                data-item-type="band"
                data-band-id={item.id}
                className={`relative box-border flex h-[100dvh] min-h-[100dvh] shrink-0 snap-start snap-always flex-col items-center justify-start gap-6 px-6 pb-48 ${
                  isFirstFeedItem ? 'pt-[80px]' : 'pt-16'
                }`}
                style={{ scrollSnapAlign: 'start' }}
                aria-label="バンド募集"
                {...timelineSlideEnterMotion}
              >
                <div className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-b from-zinc-950 via-zinc-900/95 to-emerald-950/35 opacity-[0.92]" />
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
                  className="mx-auto w-full max-w-md px-2"
                  role="presentation"
                >
                  <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800/50">
                    <div className="h-full w-[18%] rounded-full bg-emerald-500/25" />
                  </div>
                  <p className="mt-2 text-center text-xs text-zinc-500">
                    {bandPosition} / {feedItems.length}
                  </p>
                </div>
              </motion.section>
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
          const songOrdinal = feedItems
            .slice(0, feedIndex)
            .filter((i) => i.itemType === 'song').length;
          void songOrdinal;

          return (
            <motion.section
              key={post.id}
              data-timeline-post
              data-item-type="song"
              data-post-id={post.id}
              className={`relative isolate box-border flex h-[100dvh] min-h-[100dvh] shrink-0 snap-start snap-always flex-col items-center justify-start overflow-hidden px-6 pb-48 ${
                isFirstFeedItem ? 'pt-[80px]' : 'pt-10'
              }`}
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
              {...timelineSlideEnterMotion}
            >
              <div
                className="pointer-events-none absolute inset-0 z-0"
                style={{
                  backgroundImage: `url(${post.albumArt})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  filter: 'blur(100px) brightness(0.3)',
                  transform: 'scale(1.2) translateZ(0)',
                  transformOrigin: 'center center',
                  opacity: 0.6,
                }}
                aria-hidden
              />
              <div
                className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-b from-zinc-950/45 via-zinc-950/30 to-zinc-950/55"
                aria-hidden
              />

              <div className="relative z-10 mx-auto flex min-h-0 w-full max-w-md flex-col items-center gap-2 pb-24 -mt-3 sm:gap-3 sm:-mt-4">
                {autoplayBlockedPostId === post.id ? (
                  <div className="pointer-events-none absolute inset-0 z-20 flex items-start justify-center pt-10">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAutoplayBlockedPostId(null);
                        handlePlayForPost(post);
                      }}
                      className="pointer-events-auto rounded-full border border-emerald-400/35 bg-zinc-950/80 px-4 py-2 text-sm font-semibold text-emerald-200 shadow-lg shadow-emerald-500/10 backdrop-blur-md hover:bg-zinc-950"
                    >
                      タップして再生
                    </button>
                  </div>
                ) : null}
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

                <div className="flex w-full flex-col items-center gap-2 text-center sm:gap-2.5">
                  <div className="flex w-full flex-col items-center gap-0.5">
                    <h2 className="text-balance text-2xl font-bold leading-tight text-zinc-50 sm:text-3xl">
                      {post.songTitle}
                    </h2>
                    <p className="text-balance text-lg leading-snug text-zinc-400 sm:text-xl">
                      {post.artist}
                    </p>
                    {post.caption?.trim() ? (
                      <p className="mt-1 flex max-w-sm items-start justify-center gap-1.5 px-2 text-sm italic leading-snug text-zinc-400/90">
                        <MessageCircle
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500/70"
                          strokeWidth={1.75}
                          aria-hidden
                        />
                        <span className="min-w-0 text-balance">
                          {post.caption.trim()}
                        </span>
                      </p>
                    ) : null}
                  </div>

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

                  <ReactionButtons
                    postId={post.id}
                    postOwnerId={post.userId}
                    trackName={post.songTitle}
                    artistName={post.artist}
                    appleMusicUrl={null}
                    initialLikeCount={
                      Object.values(post.reactions ?? {}).reduce(
                        (sum, n) => sum + (typeof n === 'number' ? n : 0),
                        0,
                      ) || 0
                    }
                    initialIsLiked={false}
                    userId={authUserId}
                  />
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

                <div
                  className="mx-auto mt-1 w-full max-w-md px-2 pt-1"
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
              </div>
            </motion.section>
          );
        })}

        <footer className="flex min-h-[32dvh] snap-end flex-col items-center justify-center border-t border-zinc-800/60 bg-zinc-950 px-6 pt-16 pb-[calc(12rem+env(safe-area-inset-bottom,0px))] text-center">
          <p className="text-sm font-medium text-zinc-500">
            タイムラインはここまで
          </p>
          <p className="mt-2 max-w-xs text-xs leading-relaxed text-zinc-600">
            直近24時間のシェアのみ表示しています
          </p>
        </footer>
      </div>

      <div
        className="pointer-events-none fixed left-0 right-0 z-[35] h-0 overflow-hidden"
        style={{
          bottom: 'calc(3rem + env(safe-area-inset-bottom, 0px))',
        }}
      >
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
      </div>

      {/* Reactor sheet removed (instrument reactions deprecated). */}
    </>
  );
}
