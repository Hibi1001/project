import { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import LockScreen from './components/LockScreen';
import Timeline from './components/Timeline';
import Profile from './components/Profile';
import CreatePostModal from './components/CreatePostModal';
import Login from './components/Login';
import GroupManager from './components/GroupManager';
import { supabase } from './lib/supabase';
import type { Session } from '@supabase/supabase-js';

type Screen = 'lock' | 'timeline' | 'profile';

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [hasPostedToday, setHasPostedToday] = useState(false);
  const [currentScreen, setCurrentScreen] = useState<Screen>('lock');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [createPostModalOpen, setCreatePostModalOpen] = useState(false);
  const [timelineRefreshTrigger, setTimelineRefreshTrigger] = useState(0);
  const [isGroupManagerOpen, setIsGroupManagerOpen] = useState(false);

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
      <button
        type="button"
        onClick={() => setIsGroupManagerOpen(true)}
        className="fixed top-4 right-4 z-30 rounded-full px-4 py-2 bg-zinc-900/80 border border-zinc-700 text-xs font-medium text-zinc-200 hover:bg-zinc-800 transition-colors"
      >
        Groups
      </button>
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
      <GroupManager
        isOpen={isGroupManagerOpen}
        onClose={() => setIsGroupManagerOpen(false)}
      />
    </div>
  );
}

export default App;
