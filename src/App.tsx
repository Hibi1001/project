import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import LockScreen from './components/LockScreen';
import Timeline from './components/Timeline';
import Profile from './components/Profile';
import CreatePostModal from './components/CreatePostModal';
import Login from './components/Login';
import InitialProfileSetup from './components/InitialProfileSetup';
import { supabase } from './lib/supabase';
import { fetchTodaysPostCountForUser, isProfileUuid } from './lib/api';
import { DAILY_POST_LIMIT } from './constants/posting';
import type { Session } from '@supabase/supabase-js';

type Screen = 'lock' | 'timeline' | 'profile';

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
  /** Logged-in user must have a non-empty display_name before using the app. */
  const [profileGate, setProfileGate] = useState<
    'unknown' | 'ok' | 'setup'
  >('unknown');

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

  const atDailyLimit = todaysPostCount >= DAILY_POST_LIMIT;
  const shareSongBlocked = atDailyLimit;
  const dailyLimitMessageJa = `本日のシェア上限（${DAILY_POST_LIMIT}回）に達しました。明日0時（端末の日付切り替え）にリセットされます。`;

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
      <div className="min-h-screen bg-zinc-950 text-zinc-50 flex items-center justify-center px-6">
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

  const spotifyAccessToken =
    // Supabase OAuth sessions expose the provider access token on the session.
    (session as any)?.provider_token ?? null;

  if (!authReady) {
    return <div className="min-h-screen bg-zinc-950 text-zinc-50" />;
  }

  if (!userId) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-50">
        <Login />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50">
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
        {currentScreen === 'timeline' && (
          <Timeline
            key="timeline"
            onViewProfile={handleViewProfile}
            onShareSong={() => setCreatePostModalOpen(true)}
            timelineRefreshTrigger={timelineRefreshTrigger}
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

      <CreatePostModal
        isOpen={createPostModalOpen}
        onClose={() => setCreatePostModalOpen(false)}
        onSubmitSuccess={handleCreatePostSuccess}
        userId={userId}
        spotifyAccessToken={spotifyAccessToken}
        shareSongBlocked={shareSongBlocked}
        shareLimitMessage={dailyLimitMessageJa}
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
