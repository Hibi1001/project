import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Mic, Guitar, Music2, Drum, Piano, Plus, Play, Pause } from 'lucide-react';
import { Post, InstrumentType } from '../types';
import { fetchTimelinePosts, fetchUserById } from '../lib/api';
import { supabase } from '../lib/supabase';
import LockScreen from './LockScreen';

interface TimelineProps {
  onViewProfile: (userId: string) => void;
  onShareSong: () => void;
  timelineRefreshTrigger?: number;
}

export default function Timeline({ onViewProfile, onShareSong, timelineRefreshTrigger = 0 }: TimelineProps) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [hasPostedToday, setHasPostedToday] = useState(false);
  const [currentUser, setCurrentUser] = useState<{
    id: string;
    name: string;
    avatar: string;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [userReactionSet, setUserReactionSet] = useState<Set<InstrumentType>>(new Set());

  const instrumentIcons = {
    vocal: Mic,
    guitar: Guitar,
    bass: Music2,
    drum: Drum,
    keyboard: Piano,
  };

  const instrumentLabels = {
    vocal: 'Vocal',
    guitar: 'Guitar',
    bass: 'Bass',
    drum: 'Drum',
    keyboard: 'Key',
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
    (data ?? []).forEach((r: { instrument_type: InstrumentType; user_id: string }) => {
      if (counts[r.instrument_type] !== undefined) counts[r.instrument_type] += 1;
      if (r.user_id === userId) mine.add(r.instrument_type);
    });

    setPosts((prev) =>
      prev.map((p) => (p.id === postId ? { ...p, reactions: counts } : p))
    );
    setUserReactionSet(mine);
  };

  const toggleReaction = async (postId: string, instrument: InstrumentType) => {
    if (!authUserId) return;

    // Optimistic UI update (count + highlight) while syncing with DB.
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
                [instrument]: Math.max(0, p.reactions[instrument] + (alreadyReacted ? -1 : 1)),
              },
            }
          : p
      )
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

    // Ensure counts and highlight reflect DB truth.
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
    const checkPostedToday = async () => {
      if (!authUserId) {
        setHasPostedToday(false);
        return;
      }

      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

      const { data, error } = await supabase
        .from('posts')
        .select('id')
        .eq('user_id', authUserId)
        .gte('created_at', startOfToday.toISOString())
        .limit(1);

      if (error) {
        console.error('Error checking today post', error);
        setHasPostedToday(false);
        return;
      }

      setHasPostedToday((data ?? []).length > 0);
    };

    checkPostedToday();
  }, [authUserId, timelineRefreshTrigger]);

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
      setCurrentIndex((idx) => Math.min(idx, Math.max(0, deduped.length - 1)));
      setIsLoading(false);
    };

    loadPosts();
  }, [timelineRefreshTrigger]);

  useEffect(() => {
    const handleScroll = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > 30) {
        if (e.deltaY > 0 && currentIndex < posts.length - 1) {
          setCurrentIndex((prev) => prev + 1);
        } else if (e.deltaY < 0 && currentIndex > 0) {
          setCurrentIndex((prev) => prev - 1);
        }
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('wheel', handleScroll, { passive: true });
    }

    return () => {
      if (container) {
        container.removeEventListener('wheel', handleScroll);
      }
    };
  }, [currentIndex, posts.length]);

  useEffect(() => {
    const currentPost = posts[currentIndex];
    if (!currentPost) {
      setCurrentUser(null);
      return;
    }
    let cancelled = false;
    const loadUser = async () => {
      const user = await fetchUserById(currentPost.userId);
      if (!cancelled && user) {
        setCurrentUser({
          id: user.id,
          name: user.name,
          avatar: user.avatar,
        });
      } else if (!cancelled) {
        setCurrentUser(null);
      }
    };
    loadUser();
    return () => {
      cancelled = true;
    };
  }, [posts, currentIndex]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setIsPlaying(false);
  }, [currentIndex]);

  useEffect(() => {
    const currentPost = posts[currentIndex];
    if (!authUserId || !currentPost) return;
    refreshReactionsForPost(currentPost.id, authUserId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUserId, currentIndex, posts.length]);

  if (isAuthLoading) {
    return (
      <div
        ref={containerRef}
        className="fixed inset-0 bg-zinc-950 flex items-center justify-center"
      >
        <div className="text-zinc-400 text-sm">Loading timeline...</div>
      </div>
    );
  }

  if (!hasPostedToday) {
    // We reuse the existing LockScreen UI to keep layout/styling consistent.
    // The main CTA opens the Share Song modal (since unlock requires posting today).
    return <LockScreen onUnlock={onShareSong} onShareSong={onShareSong} />;
  }

  if (isLoading) {
    return (
      <div
        ref={containerRef}
        className="fixed inset-0 bg-zinc-950 flex items-center justify-center"
      >
        <div className="text-zinc-400 text-sm">Loading timeline...</div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onShareSong}
          className="fixed bottom-8 right-8 w-14 h-14 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/30 flex items-center justify-center z-20"
          aria-label="Share Song"
        >
          <Plus className="w-6 h-6" />
        </motion.button>
      </div>
    );
  }

  if (!posts.length) {
    return (
      <div
        ref={containerRef}
        className="fixed inset-0 bg-zinc-950 flex items-center justify-center"
      >
        <div className="text-zinc-400 text-sm text-center">
          No posts yet. Share your first track!
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onShareSong}
          className="fixed bottom-8 right-8 w-14 h-14 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/30 flex items-center justify-center z-20"
          aria-label="Share Song"
        >
          <Plus className="w-6 h-6" />
        </motion.button>
      </div>
    );
  }

  const currentPost = posts[currentIndex];
  const hasPreview = Boolean(currentPost.previewUrl);

  if (!currentUser) {
    return null;
  }

  const togglePlayPause = () => {
    const audio = audioRef.current;
    if (!audio || !hasPreview) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(() => {});
    }
    setIsPlaying(!isPlaying);
  };

  const handleAudioEnded = () => setIsPlaying(false);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 bg-zinc-950 overflow-hidden"
    >
      {hasPreview && (
        <audio
          key={`audio-${currentPost.id}`}
          ref={audioRef}
          src={currentPost.previewUrl}
          onEnded={handleAudioEnded}
          preload="metadata"
        />
      )}
      <motion.div
        key={currentPost.id}
        initial={{ opacity: 0, y: 100 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -100 }}
        transition={{ duration: 0.3 }}
        className="h-full w-full flex items-center justify-center relative"
      >
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `url(${currentPost.albumArt})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(60px)',
          }}
        />

        <div className="relative z-10 max-w-md w-full mx-auto px-6 flex flex-col justify-center h-full pb-28 sm:pb-0">
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            className="mb-8"
          >
            <div className="relative w-72 h-72 sm:w-80 sm:h-80 mx-auto group">
              <img
                src={currentPost.albumArt}
                alt={currentPost.songTitle}
                className="w-full h-full object-cover rounded-2xl shadow-2xl"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/80 to-transparent rounded-2xl" />
              {hasPreview && (
                <button
                  type="button"
                  onClick={togglePlayPause}
                  className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/30 hover:bg-black/40 transition-colors"
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  <span className="w-16 h-16 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                    {isPlaying ? (
                      <Pause className="w-8 h-8 text-zinc-900 fill-zinc-900" />
                    ) : (
                      <Play className="w-8 h-8 text-zinc-900 fill-zinc-900 ml-1" />
                    )}
                  </span>
                </button>
              )}
            </div>
          </motion.div>

          <div className="text-center mb-6">
            <h2 className="text-3xl font-bold text-zinc-50 mb-2">
              {currentPost.songTitle}
            </h2>
            <p className="text-xl text-zinc-400 mb-4">{currentPost.artist}</p>

            <button
              onClick={() => onViewProfile(currentPost.userId)}
              className="inline-flex items-center gap-2 text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              <img
                src={currentUser.avatar}
                alt={currentUser.name}
                className="w-8 h-8 rounded-full"
              />
              <span className="text-sm font-medium">{currentUser.name}</span>
            </button>
          </div>

          <div className="bg-zinc-900/50 backdrop-blur-md rounded-full h-2 mb-4 overflow-hidden">
            <motion.div
              initial={{ width: '0%' }}
              animate={{ width: '100%' }}
              transition={{ duration: 15, ease: 'linear' }}
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-400"
            />
          </div>

          <div className="text-center text-zinc-500 text-xs mb-8">
            {currentIndex + 1} / {posts.length}
          </div>
        </div>

        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex flex-row gap-3 z-20 sm:absolute sm:bottom-auto sm:left-auto sm:translate-x-0 sm:right-4 sm:top-1/2 sm:-translate-y-1/2 sm:flex-col sm:gap-4">
          {(Object.keys(instrumentIcons) as InstrumentType[]).map((instrument) => {
            const Icon = instrumentIcons[instrument];
            const count = currentPost.reactions[instrument];
            const isMine = userReactionSet.has(instrument);
            return (
              <motion.button
                key={instrument}
                whileTap={{ scale: 0.9 }}
                onClick={() => toggleReaction(currentPost.id, instrument)}
                className="flex flex-col items-center gap-1 group"
              >
                <div className={`w-12 h-12 rounded-full bg-zinc-900/80 backdrop-blur-md flex items-center justify-center group-hover:bg-emerald-500/20 group-hover:scale-110 transition-all ${isMine ? 'ring-2 ring-emerald-500/60 bg-emerald-500/10' : ''}`}>
                  <Icon className={`w-6 h-6 transition-colors ${isMine ? 'text-emerald-400' : 'text-zinc-400 group-hover:text-emerald-400'}`} />
                </div>
                <span className="text-xs text-zinc-400 font-semibold">
                  {count}
                </span>
              </motion.button>
            );
          })}

          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => onViewProfile(currentPost.userId)}
            className="flex flex-col items-center gap-1 group mt-0 sm:mt-4"
          >
            <div className="w-12 h-12 rounded-full bg-zinc-900/80 backdrop-blur-md flex items-center justify-center group-hover:bg-emerald-500/20 group-hover:scale-110 transition-all overflow-hidden">
              <img
                src={currentUser.avatar}
                alt={currentUser.name}
                className="w-full h-full object-cover"
              />
            </div>
          </motion.button>
        </div>

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onShareSong}
          className="fixed bottom-8 right-6 sm:right-auto sm:bottom-8 sm:left-1/2 sm:-translate-x-1/2 w-14 h-14 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/30 flex items-center justify-center z-30"
          aria-label="Share Song"
        >
          <Plus className="w-6 h-6" />
        </motion.button>
      </motion.div>
    </div>
  );
}
