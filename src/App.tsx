import { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import LockScreen from './components/LockScreen';
import Timeline from './components/Timeline';
import Profile from './components/Profile';
import CreatePostModal from './components/CreatePostModal';
import Login from './components/Login';
import { supabase } from './lib/supabase';
import type { Session } from '@supabase/supabase-js';

type Screen = 'lock' | 'timeline' | 'profile';

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
    return window.localStorage.getItem('secret_passcode_ok_2026') === 'true';
  });
  const [hasPostedToday, setHasPostedToday] = useState(false);
  const [currentScreen, setCurrentScreen] = useState<Screen>('lock');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [createPostModalOpen, setCreatePostModalOpen] = useState(false);
  const [timelineRefreshTrigger, setTimelineRefreshTrigger] = useState(0);

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

  const handleUnlock = () => {
    setHasPostedToday(true);
    setCurrentScreen('timeline');
  };

  const handleCreatePostSuccess = () => {
    setHasPostedToday(true);
    setCreatePostModalOpen(false);
    setTimelineRefreshTrigger((t) => t + 1);
    setCurrentScreen('timeline');
  };

  const handleViewProfile = (userId: string) => {
    setSelectedUserId(userId);
    setCurrentScreen('profile');
  };

  const handleBackToTimeline = () => {
    setCurrentScreen('timeline');
    setSelectedUserId(null);
  };

  const handlePasscodeSuccess = () => {
    setPasscodeOk(true);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('secret_passcode_ok_2026', 'true');
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

  const userId = session?.user.id ?? null;

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
            onUnlock={handleUnlock}
            onShareSong={() => setCreatePostModalOpen(true)}
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
        {currentScreen === 'profile' && selectedUserId && (
          <Profile
            key="profile"
            userId={selectedUserId}
            onBack={handleBackToTimeline}
          />
        )}
      </AnimatePresence>

      <CreatePostModal
        isOpen={createPostModalOpen}
        onClose={() => setCreatePostModalOpen(false)}
        onSubmitSuccess={handleCreatePostSuccess}
        userId={userId}
      />
    </div>
  );
}

export default App;
