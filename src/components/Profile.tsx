import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Music, Users, Zap, Award, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchUserById, fetchPostsByUserId } from '../lib/api';
import type { User, Post } from '../types';
import { supabase } from '../lib/supabase';

interface ProfileProps {
  userId: string;
  onBack: () => void;
}

export default function Profile({ userId, onBack }: ProfileProps) {
  const [user, setUser] = useState<User | null>(null);
  const [userPosts, setUserPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState('');
  const [playedInstruments, setPlayedInstruments] = useState('');
  const [favoriteGenres, setFavoriteGenres] = useState('');
  const [top3Bands, setTop3Bands] = useState('');
  const [myGear, setMyGear] = useState('');
  const [recruitmentStatus, setRecruitmentStatus] = useState('');

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      const [userData, postsData] = await Promise.all([
        fetchUserById(userId),
        fetchPostsByUserId(userId),
      ]);
      setUser(userData);
      setUserPosts(postsData);
      setIsLoading(false);
    };

    load();
  }, [userId]);

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
      })
      .catch(() => {
        if (cancelled) return;
        setAuthUserId(null);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUserId(session?.user?.id ?? null);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const isOwnProfile = authUserId === userId;

  const openEdit = () => {
    if (!user) return;
    setSaveError(null);
    setDisplayName(user.name ?? '');
    setPlayedInstruments((user.instruments ?? []).join(', '));
    setFavoriteGenres((user.genres ?? []).join(', '));
    setTop3Bands((user.topBands ?? []).join(', '));
    setMyGear((user.gear ?? []).join(', '));
    setRecruitmentStatus(user.recruitment ?? '');
    setIsEditOpen(true);
  };

  const closeEdit = () => {
    if (isSaving) return;
    setIsEditOpen(false);
    setSaveError(null);
  };

  const toStringArray = (value: string) =>
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUserId || authUserId !== userId) return;
    setIsSaving(true);
    setSaveError(null);

    const { error } = await supabase
      .from('users')
      .update({
        display_name: displayName.trim(),
        played_instruments: toStringArray(playedInstruments),
        favorite_genres: toStringArray(favoriteGenres),
        top_3_bands: toStringArray(top3Bands).slice(0, 3),
        my_gear: toStringArray(myGear),
        recruitment_status: recruitmentStatus.trim(),
      })
      .eq('id', authUserId);

    if (error) {
      setSaveError(error.message);
      setIsSaving(false);
      return;
    }

    const refreshed = await fetchUserById(userId);
    setUser(refreshed);
    setIsSaving(false);
    setIsEditOpen(false);
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-400 text-sm">Loading profile...</div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="fixed inset-0 bg-zinc-950 overflow-y-auto">
      <div className="max-w-2xl mx-auto">
        <div className="sticky top-0 z-20 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800">
          <div className="px-4 py-4 flex items-center gap-4">
            <button
              onClick={onBack}
              className="p-2 hover:bg-zinc-800 rounded-full transition-colors"
            >
              <ArrowLeft className="w-6 h-6 text-zinc-400" />
            </button>
            <h1 className="text-xl font-bold text-zinc-50">プロフィール</h1>
            {isOwnProfile && (
              <button
                onClick={openEdit}
                className="ml-auto px-4 py-2 rounded-full bg-zinc-800/60 hover:bg-zinc-800 text-zinc-200 text-sm font-semibold border border-zinc-700/60 transition-colors"
              >
                Edit Profile (編集)
              </button>
            )}
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6"
        >
          <div className="flex items-center gap-6 mb-8">
            <img
              src={user.avatar}
              alt={user.name}
              className="w-24 h-24 rounded-full object-cover ring-4 ring-emerald-500/30"
            />
            <div>
              <h2 className="text-2xl font-bold text-zinc-50 mb-2">
                {user.name}
              </h2>
              <p className="text-zinc-400 text-sm">
                {userPosts.length}曲シェア済み
              </p>
            </div>
          </div>

          <div className="mb-8">
            <h3 className="text-sm font-semibold text-zinc-400 mb-3 flex items-center gap-2">
              <Music className="w-4 h-4" />
              担当パート
            </h3>
            <div className="flex flex-wrap gap-2">
              {user.instruments.map((instrument) => (
                <span
                  key={instrument}
                  className="px-4 py-2 bg-emerald-500/10 text-emerald-400 rounded-full text-sm font-medium border border-emerald-500/20"
                >
                  {instrument}
                </span>
              ))}
            </div>
          </div>

          <div className="mb-8">
            <h3 className="text-sm font-semibold text-zinc-400 mb-3">
              好きなジャンル
            </h3>
            <div className="flex flex-wrap gap-2">
              {user.genres.map((genre) => (
                <span
                  key={genre}
                  className="px-4 py-2 bg-zinc-800 text-zinc-300 rounded-full text-sm"
                >
                  {genre}
                </span>
              ))}
            </div>
          </div>

          <div className="mb-8">
            <h3 className="text-sm font-semibold text-zinc-400 mb-3 flex items-center gap-2">
              <Award className="w-4 h-4" />
              好きなバンド Top 3
            </h3>
            <div className="space-y-2">
              {user.topBands.map((band, index) => (
                <motion.div
                  key={band}
                  whileHover={{ x: 4 }}
                  className="flex items-center gap-3 px-4 py-3 bg-zinc-800/40 hover:bg-zinc-800/60 rounded-lg transition-colors"
                >
                  <span className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold text-sm">
                    {index + 1}
                  </span>
                  <span className="text-zinc-200 font-medium">{band}</span>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="mb-8">
            <h3 className="text-sm font-semibold text-zinc-400 mb-3 flex items-center gap-2">
              <Zap className="w-4 h-4" />
              使用機材
            </h3>
            <div className="space-y-2">
              {user.gear.map((item) => (
                <motion.div
                  key={item}
                  whileHover={{ x: 4 }}
                  className="px-4 py-2 bg-zinc-800/30 hover:bg-zinc-800/50 rounded-lg text-zinc-300 text-sm transition-colors border border-zinc-700/30 hover:border-zinc-700/60"
                >
                  {item}
                </motion.div>
              ))}
            </div>
          </div>

          <div className="mb-8 bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/20 rounded-2xl p-6">
            <h3 className="text-base font-bold text-amber-400 mb-3 flex items-center gap-2">
              <Users className="w-5 h-5" />
              現在募集中のバンド・パート
            </h3>
            <p className="text-zinc-300 text-sm leading-relaxed">
              {user.recruitment}
            </p>
          </div>

          <div>
            <h3 className="text-lg font-bold text-zinc-50 mb-4">
              過去にシェアした曲
            </h3>
            <div className="grid grid-cols-2 gap-4">
              {userPosts.map((post) => (
                <motion.div
                  key={post.id}
                  whileHover={{ scale: 1.05 }}
                  className="relative group cursor-pointer"
                >
                  <img
                    src={post.albumArt}
                    alt={post.songTitle}
                    className="w-full aspect-square object-cover rounded-lg"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex flex-col justify-end p-4">
                    <p className="text-white font-semibold text-sm mb-1">
                      {post.songTitle}
                    </p>
                    <p className="text-zinc-300 text-xs">{post.artist}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>

      <AnimatePresence>
        {isEditOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeEdit}
              className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50"
              aria-hidden
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', duration: 0.3 }}
              className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4"
            >
              <div className="w-full max-w-lg max-h-[85vh] bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-800 overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
                  <h2 className="text-lg font-semibold text-zinc-50">
                    Edit Profile
                  </h2>
                  <button
                    type="button"
                    onClick={closeEdit}
                    disabled={isSaving}
                    className="p-2 rounded-full text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800 transition-colors disabled:opacity-50"
                    aria-label="閉じる"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form
                  onSubmit={handleSave}
                  className="p-6 space-y-4 overflow-y-auto"
                >
                  {saveError && (
                    <p className="text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
                      {saveError}
                    </p>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">
                      Display Name
                    </label>
                    <input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-50 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-shadow"
                      disabled={isSaving}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">
                      Played Instruments (comma-separated)
                    </label>
                    <input
                      value={playedInstruments}
                      onChange={(e) => setPlayedInstruments(e.target.value)}
                      placeholder="例: Guitar, Vocal"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-50 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-shadow"
                      disabled={isSaving}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">
                      Favorite Genres (comma-separated)
                    </label>
                    <input
                      value={favoriteGenres}
                      onChange={(e) => setFavoriteGenres(e.target.value)}
                      placeholder="例: Rock, J-Pop"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-50 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-shadow"
                      disabled={isSaving}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">
                      Top 3 Bands (comma-separated)
                    </label>
                    <input
                      value={top3Bands}
                      onChange={(e) => setTop3Bands(e.target.value)}
                      placeholder="例: Band A, Band B, Band C"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-50 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-shadow"
                      disabled={isSaving}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">
                      My Gear (comma-separated)
                    </label>
                    <input
                      value={myGear}
                      onChange={(e) => setMyGear(e.target.value)}
                      placeholder="例: Stratocaster, Amp"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-50 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-shadow"
                      disabled={isSaving}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">
                      Recruitment Status
                    </label>
                    <textarea
                      value={recruitmentStatus}
                      onChange={(e) => setRecruitmentStatus(e.target.value)}
                      rows={4}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-50 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-shadow resize-none"
                      disabled={isSaving}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSaving || !displayName.trim()}
                    className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-semibold py-3 px-6 rounded-xl shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {isSaving ? 'Saving...' : 'Save'}
                  </button>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
