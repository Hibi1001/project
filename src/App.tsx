import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import LockScreen from './components/LockScreen';
import Timeline from './components/Timeline';
import Profile from './components/Profile';
import CreatePostModal from './components/CreatePostModal';
import Notifications from './components/Notifications';
import Login from './components/Login';
import InitialProfileSetup from './components/InitialProfileSetup';
import { supabase } from './lib/supabase';
import {
  fetchHasUnreadNotifications,
  fetchTodaysPostCountForUser,
  isProfileUuid,
} from './lib/api';
import { DAILY_POST_LIMIT } from './constants/posting';
import type { Session } from '@supabase/supabase-js';
import { RotateCw } from 'lucide-react';

type Screen = 'lock' | 'timeline' | 'profile' | 'notifications';

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
  const [currentScreen, setCurrentScreen] = useState<Screen>('lock');
  /** UUID or `display_id` slug (no leading @). */
  const [selectedProfileSlug, setSelectedProfileSlug] = useState<string | null>(
    null,
  );
  const [createPostModalOpen, setCreatePostModalOpen] = useState(false);
  const [timelineRefreshTrigger, setTimelineRefreshTrigger] = useState(0);
  const [todaysPostCount, setTodaysPostCount] = useState(0);
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false);
  const [timelineJumpPostId, setTimelineJumpPostId] = useState<string | null>(
    null,
  );
  /** Logged-in user must have a non-empty display_name before using the app. */
  const [profileGate, setProfileGate] = useState<
    'unknown' | 'ok' | 'setup'
  >('unknown');
  const [landscapeMobile, setLandscapeMobile] = useState(false);

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
    setCurrentScreen('notifications');
  }, []);

  const handleBackFromNotifications = useCallback(() => {
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

  /** One-time setup: `public.users.display_name` must be set (not a separate `profiles` table in this app). */
  useEffect(() => {
    if (!userId) {
      setProfileGate('unknown');
      return;
    }
    let cancelled = false;
    setProfileGate('unknown');
    void (async () => {
      const { data, error } = await supabase
        .from('users')
        .select('display_name')
        .eq('id', userId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error('[profile gate]', error);
        setProfileGate('setup');
        return;
      }
      if (!data) {
        setProfileGate('setup');
        return;
      }
      const dn = (data as { display_name?: string | null }).display_name;
      setProfileGate(dn?.trim() ? 'ok' : 'setup');
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

  /** 0 posts today → app LockScreen; 1+ posts today → Timeline (gate + “share another” live there). */
  useEffect(() => {
    if (currentScreen !== 'lock') return;
    if (todaysPostCount >= 1) {
      setCurrentScreen('timeline');
    }
  }, [todaysPostCount, currentScreen]);

  const handleCreatePostSuccess = useCallback(() => {
    setCreatePostModalOpen(false);
    setTimelineRefreshTrigger((t) => t + 1);
    setCurrentScreen('timeline');
    const uid = session?.user?.id;
    if (uid) void refreshPostingState(uid);
  }, [session?.user?.id, refreshPostingState]);

  const handleViewProfile = (profileSlug: string) => {
    const slug = profileSlug.trim();
    if (!slug) return;
    setSelectedProfileSlug(slug);
    setCurrentScreen('profile');
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', formatProfilePath(slug));
    }
  };

  const handleBackToTimeline = () => {
    setCurrentScreen('timeline');
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
      <div className="min-h-[100dvh] bg-zinc-950 text-zinc-50 flex items-center justify-center px-6">
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
    return <div className="min-h-[100dvh] bg-zinc-950 text-zinc-50" />;
  }

  if (!userId) {
    return (
      <div className="min-h-[100dvh] bg-zinc-950 text-zinc-50">
        <Login />
      </div>
    );
  }

  if (landscapeMobile) {
    return (
      <div className="fixed inset-0 z-[999] flex min-h-[100dvh] flex-col items-center justify-center bg-zinc-950 px-6 text-zinc-50">
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

  const showTimelineShell =
    currentScreen === 'timeline' || currentScreen === 'notifications';

  return (
    <div className="min-h-[100dvh] bg-zinc-950 text-zinc-50">
      <AnimatePresence mode="wait">
        {currentScreen === 'lock' && (
          <LockScreen
            key="lock"
            onUnlock={() => setCreatePostModalOpen(true)}
            onViewTimelineOnly={handleUnlock}
            slotsUsed={todaysPostCount}
            slotsLimit={DAILY_POST_LIMIT}
          />
        )}
        {showTimelineShell && (
          <Timeline
            key="timeline"
            onViewProfile={handleViewProfile}
            onShareSong={() => setCreatePostModalOpen(true)}
            timelineRefreshTrigger={timelineRefreshTrigger}
            onOpenNotifications={handleOpenNotifications}
            hasUnreadNotifications={hasUnreadNotifications}
            openReplyForPostId={timelineJumpPostId}
            onConsumedOpenReplyForPostId={handleConsumedTimelineJump}
          />
        )}
        {currentScreen === 'profile' && selectedProfileSlug && (
          <Profile
            key={selectedProfileSlug}
            profileSlug={selectedProfileSlug}
            onBack={handleBackToTimeline}
            onProfileCanonicalSlugChange={handleProfileCanonicalSlugChange}
          />
        )}
      </AnimatePresence>

      {currentScreen === 'notifications' && profileGate === 'ok' ? (
        <Notifications
          userId={userId}
          onBack={handleBackFromNotifications}
          onOpenPost={handleNotificationOpenPost}
          onUnreadCleared={handleUnreadNotificationsCleared}
        />
      ) : null}

      <CreatePostModal
        isOpen={createPostModalOpen}
        onClose={() => setCreatePostModalOpen(false)}
        onSubmitSuccess={handleCreatePostSuccess}
        userId={userId}
      />

      {userId && profileGate === 'unknown' ? (
        <div className="fixed inset-0 z-[199] flex items-center justify-center bg-zinc-950/90 backdrop-blur-sm">
          <p className="text-sm text-zinc-400">プロフィールを確認しています…</p>
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
