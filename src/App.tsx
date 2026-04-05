import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import LockScreen from './components/LockScreen';
import Timeline from './components/Timeline';
import Profile from './components/Profile';
import CreatePostModal from './components/CreatePostModal';
import Notifications from './components/Notifications';
import BandBoard from './components/BandBoard';
import Login from './components/Login';
import InitialProfileSetup from './components/InitialProfileSetup';
import { supabase } from './lib/supabase';
import { createBandProjectWithRoles } from './lib/profileBandRecruitment';
import type { InstrumentType } from './types';
import {
  fetchHasUnreadNotifications,
  fetchTimelineBandProjects,
  fetchTimelinePosts,
  fetchTodaysPostCountForUser,
  isProfileUuid,
} from './lib/api';
import { buildMergedTimelineFeed, type FeedItem } from './lib/timelineFeed';
import {
  isForegroundMessagingAvailable,
  requestForToken,
  subscribeForegroundFcmMessages,
} from './lib/firebase';
import LoadingSpinner from './components/LoadingSpinner';
import { DAILY_POST_LIMIT } from './constants/posting';
import type { Session } from '@supabase/supabase-js';
import { RotateCw } from 'lucide-react';

console.log("Hello from the top of App.tsx!");
type Screen = 'lock' | 'timeline' | 'board' | 'profile' | 'notifications';

const HAS_SEEN_WELCOME_KEY = 'mysession_has_seen_welcome_v1';

function readHasSeenWelcome(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(HAS_SEEN_WELCOME_KEY) === 'true';
  } catch {
    return false;
  }
}

function formatProfilePath(slug: string): string {
  const s = slug.trim();
  if (!s) return '/';
  if (isProfileUuid(s)) return `/user/${s}`;
  return `/@${encodeURIComponent(s)}`;
}

function parseProfilePath(pathname: string): string | null {
  const p = (pathname || '/').replace(/\/$/, '') || '/';
  if (p === '/' || p === '') return null;
  const at = p.match(/^\/@([^/]+)$/);
  if (at) return decodeURIComponent(at[1]);
  const userSeg = p.match(/^\/user\/([^/]+)$/i);
  if (userSeg) return userSeg[1];
  return null;
}

interface PasscodeFormProps {
  onSuccess: () => void;
}

function PasscodeForm({ onSuccess }: PasscodeFormProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value === 'session2026') {
      setError(null);
      onSuccess();
    } else {
      setError('Incorrect passcode. Please try again.');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Enter secret passcode"
          className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-50 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-shadow"
          autoFocus
        />
      </div>
      {error && (
        <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      <button
        type="submit"
        className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-sm font-semibold py-2.5 px-4 rounded-xl shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 transition-all"
      >
        Unlock
      </button>
    </form>
  );
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [passcodeOk, setPasscodeOk] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const legacy = window.localStorage.getItem('secret_passcode_ok_2026') === 'true';
    const current = window.localStorage.getItem('isPasscodeValid') === 'true';
    return legacy || current;
  });
  const [hasSeenWelcome, setHasSeenWelcome] = useState(readHasSeenWelcome);
  const [currentScreen, setCurrentScreen] = useState<Screen>('lock');

  const markWelcomeSeen = useCallback(() => {
    setHasSeenWelcome(true);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(HAS_SEEN_WELCOME_KEY, 'true');
      }
    } catch {
      /* ignore quota / private mode */
    }
  }, []);

  const currentScreenRef = useRef(currentScreen);
  currentScreenRef.current = currentScreen;
  /** UUID or `display_id` slug (no leading @). */
  const [selectedProfileSlug, setSelectedProfileSlug] = useState<string | null>(
    null,
  );
  const [createPostModalOpen, setCreatePostModalOpen] = useState(false);
  const [createBandModalOpen, setCreateBandModalOpen] = useState(false);
  const [createBandName, setCreateBandName] = useState('');
  const [createBandDesc, setCreateBandDesc] = useState('');
  const [createBandPicked, setCreateBandPicked] = useState<Set<InstrumentType>>(
    new Set(),
  );
  const [createBandSubmitting, setCreateBandSubmitting] = useState(false);
  const [createBandError, setCreateBandError] = useState<string | null>(null);
  const [timelineRefreshTrigger, setTimelineRefreshTrigger] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [todaysPostCount, setTodaysPostCount] = useState(0);
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false);
  /** Foreground FCM: in-app toast only (no `new Notification()` — avoids duplicate with SW). */
  const [fcmToast, setFcmToast] = useState<{ title: string; body: string } | null>(
    null,
  );
  const [timelineJumpPostId, setTimelineJumpPostId] = useState<string | null>(
    null,
  );
  const [lastActivePostId, setLastActivePostId] = useState<string | null>(null);
  const [hasUserGesture, setHasUserGesture] = useState(false);
  // Used to ensure the check terminates (and for potential future UI gating).
  const [gracePostCheckDone, setGracePostCheckDone] = useState(false);
  /** One level: where to return when closing Profile or Notifications (e.g. board → profile → back → board). */
  const [backDestination, setBackDestination] = useState<Screen>('timeline');
  /** Logged-in user must have a non-empty display_name before using the app. */
  const [profileGate, setProfileGate] = useState<
    'unknown' | 'ok' | 'setup'
  >('unknown');
  const [landscapeMobile, setLandscapeMobile] = useState(false);
  /** Fetched in parallel with profile gate so Timeline does not wait on a second round-trip. */
  const [timelineFeedBootstrap, setTimelineFeedBootstrap] = useState<{
    loading: boolean;
    items: FeedItem[] | null;
  }>({ loading: false, items: null });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(orientation: landscape)');
    const isMobileSize = () => window.innerWidth <= 900;
    const recompute = () => {
      setLandscapeMobile(mq.matches && isMobileSize());
    };
    recompute();
    mq.addEventListener?.('change', recompute);
    window.addEventListener('resize', recompute);
    return () => {
      mq.removeEventListener?.('change', recompute);
      window.removeEventListener('resize', recompute);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        setSession(data.session ?? null);
        setAuthReady(true);
      })
      .catch(() => {
        if (!mounted) return;
        setSession(null);
        setAuthReady(true);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authReady) return;
    const uid = session?.user?.id;
    if (!uid || !passcodeOk) return;
    const slug = parseProfilePath(
      typeof window !== 'undefined' ? window.location.pathname : '/',
    );
    if (slug) {
      setSelectedProfileSlug(slug);
      setCurrentScreen('profile');
    }
  }, [authReady, session?.user?.id, passcodeOk]);

  /** Returning users: never leave them stuck on the welcome (lock) screen after SPA navigation. */
  useEffect(() => {
    if (!passcodeOk || !authReady || !session?.user?.id) return;
    if (!hasSeenWelcome) return;
    setCurrentScreen((s) => (s === 'lock' ? 'timeline' : s));
  }, [passcodeOk, authReady, session?.user?.id, hasSeenWelcome]);

  useEffect(() => {
    const onPop = () => {
      const slug = parseProfilePath(window.location.pathname);
      if (slug) {
        setSelectedProfileSlug(slug);
        setCurrentScreen('profile');
      } else {
        setSelectedProfileSlug(null);
        setCurrentScreen('timeline');
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const handleUnlock = () => {
    setHasUserGesture(true);
    markWelcomeSeen();
    setCurrentScreen('timeline');
  };

  const refreshPostingState = useCallback(async (uid: string) => {
    const count = await fetchTodaysPostCountForUser(uid);
    setTodaysPostCount(count);
  }, []);

  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid || !passcodeOk) return;
    void refreshPostingState(uid);
  }, [session?.user?.id, passcodeOk, refreshPostingState]);

  const userId = session?.user?.id ?? null;

  const FCM_SETUP_SESSION_KEY = 'mysession_fcm_setup_v1';

  // FCM: one attempt per browser tab (sessionStorage survives React Strict Mode remounts).
  useEffect(() => {
    if (!userId || !passcodeOk || !authReady || profileGate !== 'ok') return;
    if (currentScreen === 'lock') return;
    if (typeof window === 'undefined') return;
    if (window.sessionStorage.getItem(FCM_SETUP_SESSION_KEY) === '1') return;
    window.sessionStorage.setItem(FCM_SETUP_SESSION_KEY, '1');

    // デバッグ用（実際のリクエストはログイン・パスコード・プロフィール準備完了後に一度だけ）
    console.log(
      '--- App.tsx が起動しました。通知リクエストを開始します ---',
    );

    const setupNotifications = async () => {
      try {
        const token = await requestForToken();
        console.log('App.tsx で取得したトークン:', token);
        if (token) {
          const { error } = await supabase
            .from('fcm_tokens')
            .upsert(
              { user_id: userId, token: token },
              { onConflict: 'token' },
            );

          if (error) {
            console.error('トークンの保存に失敗しました:', error);
          } else {
            console.log('トークンをデータベースに保存しました！');
          }
        }
      } catch (err) {
        console.error('通知設定中にエラー:', err);
      }
    };

    void setupNotifications();
  }, [userId, passcodeOk, authReady, profileGate, currentScreen]);

  // Subscribe whenever the session is ready — not gated on `currentScreen`, so a focused
  // LockScreen tab still receives `onMessage` while the SW skips duplicate system banners.
  useEffect(() => {
    if (!userId || !passcodeOk || !authReady || profileGate !== 'ok') return;
    let unsubscribe: (() => void) | undefined;
    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    void (async () => {
      if (!(await isForegroundMessagingAvailable())) return;
      if (cancelled) return;
      unsubscribe = subscribeForegroundFcmMessages(({ title, body }) => {
        // Foreground: in-app toast only (never `new Notification()`).
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
          return;
        }
        if (toastTimer) clearTimeout(toastTimer);
        setFcmToast({ title, body });
        toastTimer = setTimeout(() => setFcmToast(null), 6500);
      });
    })();

    return () => {
      cancelled = true;
      if (toastTimer) clearTimeout(toastTimer);
      unsubscribe?.();
    };
  }, [userId, passcodeOk, authReady, profileGate]);

  // 24-hour grace period: if the user has posted within the last 24 hours,
  // bypass the LockScreen automatically (fast: fetch only the latest post).
  // Intentionally does NOT depend on `currentScreen` — that was re-firing on every navigation
  // and contributed to inconsistent routing when returning from Profile / Board.
  useEffect(() => {
    if (!userId || !passcodeOk || !authReady) return;
    let cancelled = false;
    setGracePostCheckDone(false);
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('posts')
          .select('created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          console.error('[grace post check]', error);
          return;
        }
        const createdAt = (data as { created_at?: string | null } | null)
          ?.created_at;
        if (!createdAt) return;
        const t = new Date(createdAt).getTime();
        if (!Number.isFinite(t)) return;
        const within24h = Date.now() - t < 24 * 60 * 60 * 1000;
        if (within24h && currentScreenRef.current === 'lock') {
          markWelcomeSeen();
          setCurrentScreen('timeline');
        }
      } finally {
        if (!cancelled) setGracePostCheckDone(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, passcodeOk, authReady, markWelcomeSeen]);

  const refreshUnreadNotifications = useCallback(async () => {
    if (!userId || profileGate !== 'ok') return;
    const unread = await fetchHasUnreadNotifications(userId);
    setHasUnreadNotifications(unread);
  }, [userId, profileGate]);

  useEffect(() => {
    if (!userId || profileGate !== 'ok') return;
    let alive = true;
    void (async () => {
      const unread = await fetchHasUnreadNotifications(userId);
      if (alive) setHasUnreadNotifications(unread);
    })();
    const id = window.setInterval(() => {
      void refreshUnreadNotifications();
    }, 45_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [userId, profileGate, refreshUnreadNotifications]);

  useEffect(() => {
    if (currentScreen !== 'timeline') return;
    void refreshUnreadNotifications();
  }, [currentScreen, refreshUnreadNotifications]);

  const handleConsumedTimelineJump = useCallback(() => {
    setTimelineJumpPostId(null);
  }, []);

  const handleUnreadNotificationsCleared = useCallback(() => {
    setHasUnreadNotifications(false);
  }, []);

  const handleOpenNotifications = useCallback(() => {
    setBackDestination(currentScreen);
    setCurrentScreen('notifications');
  }, [currentScreen]);

  const handleOpenBoard = useCallback(() => {
    setBackDestination(currentScreen);
    setCurrentScreen('board');
  }, [currentScreen]);

  const handleBackFromNotifications = useCallback(() => {
    const dest = backDestination;
    const next: Screen =
      dest === 'lock' || dest === 'profile' ? 'timeline' : dest;
    setCurrentScreen(next);
  }, [backDestination]);

  /** Band board “back to feed” — always returns to the main timeline. */
  const handleBackFromBoard = useCallback(() => {
    setCurrentScreen('timeline');
  }, []);

  const handleNotificationOpenPost = useCallback((postId: string) => {
    const id = postId.trim();
    if (!id) return;
    setTimelineJumpPostId(id);
    setCurrentScreen('timeline');
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', '/');
    }
  }, []);

  /**
   * Profile gate + timeline feed in parallel (no auth → profile → timeline waterfall).
   * `public.users.display_name` must be set before full app use.
   */
  useEffect(() => {
    if (!userId) {
      setProfileGate('unknown');
      setTimelineFeedBootstrap({ loading: false, items: null });
      return;
    }
    let cancelled = false;
    setProfileGate('unknown');
    setTimelineFeedBootstrap({ loading: true, items: null });

    void (async () => {
      let mergedItems: FeedItem[] = [];
      try {
        const [profileRes, songRows, bandRows] = await Promise.all([
          supabase
            .from('users')
            .select('display_name')
            .eq('id', userId)
            .maybeSingle(),
          fetchTimelinePosts(),
          fetchTimelineBandProjects(),
        ]);
        if (cancelled) return;

        if (profileRes.error) {
          console.error('[profile gate]', profileRes.error);
          setProfileGate('setup');
        } else if (!profileRes.data) {
          // No `public.users` row yet — InitialProfileSetup will run; still show Timeline.
          setProfileGate('setup');
        } else {
          const dn = (profileRes.data as { display_name?: string | null })
            .display_name;
          setProfileGate(dn?.trim() ? 'ok' : 'setup');
        }

        mergedItems = buildMergedTimelineFeed(songRows, bandRows);
      } catch (e) {
        console.error('[bootstrap]', e);
        if (!cancelled) setProfileGate('setup');
        mergedItems = [];
      } finally {
        // Always leave bootstrap when this request finishes (avoids infinite spinner).
        if (!cancelled) {
          setTimelineFeedBootstrap({ loading: false, items: mergedItems });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!createPostModalOpen) return;
    const uid = session?.user?.id;
    if (!uid) return;
    void refreshPostingState(uid);
  }, [createPostModalOpen, session?.user?.id, refreshPostingState]);

  // NOTE: We intentionally do NOT auto-transition off the LockScreen based on
  // todaysPostCount. The title screen should remain stable until a user action.

  const handleCreatePostSuccess = useCallback(() => {
    setCreatePostModalOpen(false);
    setTimelineRefreshTrigger((t) => t + 1);
    setCurrentScreen('timeline');
    const uid = session?.user?.id;
    if (uid) void refreshPostingState(uid);
  }, [session?.user?.id, refreshPostingState]);

  const handleRefresh = useCallback(() => {
    setHasUserGesture(true);
    setRefreshing(true);
    setLastActivePostId(null);
    setTimelineRefreshTrigger((t) => t + 1);
    // Safety: release the button even if Timeline fails silently.
    window.setTimeout(() => setRefreshing(false), 1800);
  }, []);

  const handleOpenCreateBandRecruitment = useCallback(() => {
    setHasUserGesture(true);
    setCreateBandError(null);
    setCreateBandName('');
    setCreateBandDesc('');
    setCreateBandPicked(new Set());
    setCreateBandModalOpen(true);
  }, []);

  const toggleCreateBandPick = (i: InstrumentType) => {
    setCreateBandPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const submitCreateBandRecruitment = useCallback(async () => {
    if (!userId) return;
    setCreateBandSubmitting(true);
    setCreateBandError(null);
    try {
      const { error } = await createBandProjectWithRoles({
        ownerId: userId,
        name: createBandName,
        description: createBandDesc,
        instruments: [...createBandPicked],
      });
      if (error) {
        setCreateBandError(error);
        return;
      }
      setCreateBandModalOpen(false);
      // Nudge feeds to pick up the new recruitment immediately.
      setTimelineRefreshTrigger((t) => t + 1);
    } finally {
      setCreateBandSubmitting(false);
    }
  }, [userId, createBandName, createBandDesc, createBandPicked]);

  const handleViewProfile = (profileSlug: string) => {
    const slug = profileSlug.trim();
    if (!slug) return;
    setBackDestination(currentScreen);
    setSelectedProfileSlug(slug);
    setCurrentScreen('profile');
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', formatProfilePath(slug));
    }
  };

  const handleBackFromProfile = () => {
    const dest = backDestination;
    const nextScreen: Screen =
      dest === 'lock' || dest === 'profile' ? 'timeline' : dest;
    setCurrentScreen(nextScreen);
    setSelectedProfileSlug(null);
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', '/');
    }
  };

  const handleProfileCanonicalSlugChange = useCallback((slug: string) => {
    const s = slug.trim();
    if (!s) return;
    setSelectedProfileSlug(s);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', formatProfilePath(s));
    }
  }, []);

  const handlePasscodeSuccess = () => {
    setPasscodeOk(true);
    if (typeof window !== 'undefined') {
      // Store under both old and new keys for backward compatibility.
      window.localStorage.setItem('secret_passcode_ok_2026', 'true');
      window.localStorage.setItem('isPasscodeValid', 'true');
    }
  };

  if (!passcodeOk) {
    return (
      <div className="min-h-[100dvh] w-full overflow-x-hidden bg-zinc-950 text-zinc-50 flex items-center justify-center px-6">
        <div className="w-full max-w-sm bg-zinc-900/80 border border-zinc-800 rounded-2xl p-6 shadow-xl">
          <h1 className="text-lg font-semibold text-zinc-50 mb-2">
            Secret Passcode
          </h1>
          <p className="text-xs text-zinc-400 mb-4">
            This app is for a private community. Please enter the shared passcode to continue.
          </p>
          <PasscodeForm onSuccess={handlePasscodeSuccess} />
        </div>
      </div>
    );
  }

  if (!authReady) {
    return (
      <LoadingSpinner label="セッションを確認しています…" className="min-h-[100dvh]" />
    );
  }

  if (!userId) {
    return (
      <div className="min-h-[100dvh] w-full overflow-x-hidden bg-zinc-950 text-zinc-50">
        <Login />
      </div>
    );
  }

  if (landscapeMobile) {
    return (
      <div className="fixed inset-0 z-[999] flex min-h-[100dvh] w-full flex-col items-center justify-center overflow-x-hidden bg-zinc-950 px-6 text-zinc-50">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/60">
            <RotateCw className="h-7 w-7 text-zinc-300" strokeWidth={2} />
          </div>
          <p className="text-base font-semibold text-zinc-100">
            縦画面でご利用ください
          </p>
          <p className="text-sm leading-relaxed text-zinc-500">
            端末を回転して、縦向きでご利用ください。
          </p>
        </div>
      </div>
    );
  }

  const timelineVisible = currentScreen === 'timeline';

  return (
    <div className="relative min-h-[100dvh] w-full overflow-x-hidden bg-zinc-950 text-zinc-50">
      <AnimatePresence>
        {fcmToast && (
          <motion.div
            key={`${fcmToast.title}\0${fcmToast.body}`}
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-6 left-1/2 z-[240] w-[min(92vw,22rem)] -translate-x-1/2 cursor-pointer rounded-2xl border border-zinc-700 bg-zinc-900/95 px-4 py-3 text-left shadow-xl backdrop-blur-sm"
            onClick={() => setFcmToast(null)}
          >
            <p className="text-sm font-semibold text-zinc-50">{fcmToast.title}</p>
            {fcmToast.body ? (
              <p className="mt-1 line-clamp-3 text-xs leading-snug text-zinc-400">
                {fcmToast.body}
              </p>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence mode="popLayout">
        {currentScreen === 'lock' && !hasSeenWelcome && (
          <motion.div key="lock" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <LockScreen
              onUnlock={() => {
                setHasUserGesture(true);
                markWelcomeSeen();
                setCreatePostModalOpen(true);
              }}
              onViewTimelineOnly={handleUnlock}
              slotsUsed={todaysPostCount}
              slotsLimit={DAILY_POST_LIMIT}
            />
          </motion.div>
        )}
        <div
          className={
            timelineVisible
              ? 'relative z-0 min-h-[100dvh]'
              : 'hidden'
          }
          aria-hidden={!timelineVisible}
        >
          <Timeline
            key="timeline"
            onViewProfile={handleViewProfile}
            onShareSong={() => setCreatePostModalOpen(true)}
            timelineRefreshTrigger={timelineRefreshTrigger}
            onOpenNotifications={handleOpenNotifications}
            hasUnreadNotifications={hasUnreadNotifications}
            onOpenBoard={handleOpenBoard}
            onRefresh={handleRefresh}
            refreshing={refreshing}
            openReplyForPostId={timelineJumpPostId}
            onConsumedOpenReplyForPostId={handleConsumedTimelineJump}
            authUserId={userId}
            feedBootstrap={timelineFeedBootstrap}
            isForeground={timelineVisible}
            restorePostId={lastActivePostId}
            onActivePostIdChange={setLastActivePostId}
            hasUserGesture={hasUserGesture}
          />
        </div>
        {currentScreen === 'board' && userId ? (
          <div className="fixed inset-0 z-[100] flex min-h-0 flex-col bg-zinc-950">
            <BandBoard
              authUserId={userId}
              hasUnreadNotifications={hasUnreadNotifications}
              onOpenNotifications={handleOpenNotifications}
              onOpenProfile={() => handleViewProfile(userId)}
              onShareSong={handleOpenCreateBandRecruitment}
              onOpenTimeline={handleBackFromBoard}
              onViewProfile={handleViewProfile}
            />
          </div>
        ) : null}
        {currentScreen === 'profile' && selectedProfileSlug && (
          <div className="fixed inset-0 z-[100] flex min-h-0 flex-col overflow-hidden bg-zinc-950">
            <Profile
              key={selectedProfileSlug}
              profileSlug={selectedProfileSlug}
              onBack={handleBackFromProfile}
              onProfileCanonicalSlugChange={handleProfileCanonicalSlugChange}
            />
          </div>
        )}
      </AnimatePresence>

      {currentScreen === 'notifications' && profileGate === 'ok' ? (
        <div className="fixed inset-0 z-[110] flex min-h-0 flex-col bg-zinc-950">
          <Notifications
            userId={userId}
            onBack={handleBackFromNotifications}
            onOpenPost={handleNotificationOpenPost}
            onUnreadCleared={handleUnreadNotificationsCleared}
          />
        </div>
      ) : null}

      <CreatePostModal
        isOpen={createPostModalOpen}
        onClose={() => setCreatePostModalOpen(false)}
        onSubmitSuccess={handleCreatePostSuccess}
        userId={userId}
      />

      {createBandModalOpen ? (
        <div className="fixed inset-0 z-[220] flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center">
          <div
            role="dialog"
            aria-modal
            aria-label="バンド募集を作成"
            className="w-full max-w-md overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <div className="text-sm font-semibold text-zinc-100">
                バンド募集を作成
              </div>
              <button
                type="button"
                disabled={createBandSubmitting}
                onClick={() => setCreateBandModalOpen(false)}
                className="rounded-full px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-60"
              >
                閉じる
              </button>
            </div>
            <div className="space-y-3 p-4">
              {createBandError ? (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {createBandError}
                </div>
              ) : null}
              <div>
                <label className="mb-1 block text-xs font-semibold text-zinc-400">
                  バンド名
                </label>
                <input
                  value={createBandName}
                  onChange={(e) => setCreateBandName(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/40"
                  placeholder="例：メロパン研究会"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-zinc-400">
                  説明（任意）
                </label>
                <textarea
                  value={createBandDesc}
                  onChange={(e) => setCreateBandDesc(e.target.value)}
                  className="min-h-[88px] w-full resize-none rounded-xl border border-zinc-800 bg-zinc-950/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/40"
                  placeholder="やりたい曲、活動頻度など"
                />
              </div>
              <div>
                <div className="mb-2 text-xs font-semibold text-zinc-400">
                  募集パート
                </div>
                <div className="flex flex-wrap gap-2">
                  {(['vocal', 'guitar', 'bass', 'drum', 'keyboard'] as InstrumentType[]).map(
                    (i) => {
                      const on = createBandPicked.has(i);
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => toggleCreateBandPick(i)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                            on
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                              : 'border-zinc-800 bg-zinc-950/30 text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          {i}
                        </button>
                      );
                    },
                  )}
                </div>
              </div>
              <button
                type="button"
                disabled={createBandSubmitting}
                onClick={() => void submitCreateBandRecruitment()}
                className="mt-1 w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                {createBandSubmitting ? '作成中…' : '作成する'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {userId && profileGate === 'unknown' ? (
        <div className="fixed inset-0 z-[199] flex items-center justify-center bg-zinc-950/90 backdrop-blur-sm">
          <LoadingSpinner
            compact
            label="プロフィールを確認しています…"
            className="bg-transparent"
          />
        </div>
      ) : null}
      {userId && profileGate === 'setup' ? (
        <InitialProfileSetup
          userId={userId}
          onComplete={() => setProfileGate('ok')}
        />
      ) : null}
    </div>
  );
}

export default App;
