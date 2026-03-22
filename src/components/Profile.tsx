import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  Award,
  Instagram,
  Link as LinkIcon,
  Music,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarUploadError, setAvatarUploadError] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState('');
  const [playedInstruments, setPlayedInstruments] = useState('');
  const [favoriteGenres, setFavoriteGenres] = useState('');
  const [top3Bands, setTop3Bands] = useState('');
  const [myGear, setMyGear] = useState('');
  const [recruitmentStatus, setRecruitmentStatus] = useState('');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [lineUrl, setLineUrl] = useState('');
  const persistedSnsRef = useRef({ instagram: '', line: '' });

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      const [userData, postsData] = await Promise.all([
        fetchUserById(userId),
        fetchPostsByUserId(userId),
      ]);
      setUser(userData);
      setUserPosts(postsData);
      const { data: snsRow } = await supabase
        .from('users')
        .select('instagram_url, line_url')
        .eq('id', userId)
        .maybeSingle();
      const ig = (snsRow as { instagram_url?: string | null } | null)?.instagram_url ?? '';
      const ln = (snsRow as { line_url?: string | null } | null)?.line_url ?? '';
      persistedSnsRef.current = { instagram: ig, line: ln };
      setInstagramUrl(ig);
      setLineUrl(ln);
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
    setAvatarUploadError(null);
    setDisplayName(user.name ?? '');
    setPlayedInstruments((user.instruments ?? []).join(', '));
    setFavoriteGenres((user.genres ?? []).join(', '));
    setTop3Bands((user.topBands ?? []).join(', '));
    setMyGear((user.gear ?? []).join(', '));
    setRecruitmentStatus(user.recruitment ?? '');
    setInstagramUrl(persistedSnsRef.current.instagram);
    setLineUrl(persistedSnsRef.current.line);
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

  const normalizeExternalUrl = (url: string) => {
    const t = url.trim();
    if (!t) return '';
    if (/^https?:\/\//i.test(t)) return t;
    return `https://${t}`;
  };

  const handleAvatarFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !authUserId || authUserId !== userId) return;
    if (!file.type.startsWith('image/')) {
      setAvatarUploadError('画像ファイルを選択してください。');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarUploadError('ファイルサイズは5MB以下にしてください。');
      return;
    }

    setAvatarUploading(true);
    setAvatarUploadError(null);

    const ext =
      file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') ||
      'jpg';
    const objectPath = `${authUserId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(objectPath, file, {
        cacheControl: '3600',
        upsert: true,
        contentType: file.type,
      });

    if (uploadError) {
      setAvatarUploadError(uploadError.message);
      setAvatarUploading(false);
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from('avatars').getPublicUrl(objectPath);

    const { error: updateError } = await supabase
      .from('users')
      .update({ avatar_url: publicUrl })
      .eq('id', authUserId);

    if (updateError) {
      setAvatarUploadError(updateError.message);
      setAvatarUploading(false);
      return;
    }

    const refreshed = await fetchUserById(userId);
    setUser(refreshed);
    setAvatarUploading(false);
  };

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
        instagram_url: instagramUrl.trim() || null,
        line_url: lineUrl.trim() || null,
      })
      .eq('id', authUserId);

    if (error) {
      setSaveError(error.message);
      setIsSaving(false);
      return;
    }

    const refreshed = await fetchUserById(userId);
    setUser(refreshed);
    const igSaved = instagramUrl.trim();
    const lineSaved = lineUrl.trim();
    persistedSnsRef.current = { instagram: igSaved, line: lineSaved };
    setInstagramUrl(igSaved);
    setLineUrl(lineSaved);
    setIsSaving(false);
    setIsEditOpen(false);
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-400 text-sm">プロフィールを読み込み中...</div>
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
              <>
                <button
                  onClick={openEdit}
                  className="ml-auto px-4 py-2 rounded-full bg-zinc-800/60 hover:bg-zinc-800 text-zinc-200 text-sm font-semibold border border-zinc-700/60 transition-colors"
                >
                  プロフィールを編集
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    // Clears local passcode + Supabase session so the user can fully reset access.
                    if (typeof window !== 'undefined') {
                      window.localStorage.removeItem('secret_passcode_ok_2026');
                      window.localStorage.removeItem('isPasscodeValid');
                    }
                    await supabase.auth.signOut();
                    window.location.reload();
                  }}
                  className="ml-2 text-xs text-zinc-500 hover:text-zinc-300 underline-offset-2 hover:underline"
                >
                  Sign out / Reset
                </button>
              </>
            )}
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6"
        >
          <div className="flex items-center gap-6 mb-8">
            {user.avatar ? (
              <img
                src={user.avatar}
                alt={user.name}
                className="w-24 h-24 rounded-full object-cover ring-4 ring-emerald-500/30"
              />
            ) : (
              <div
                className="w-24 h-24 rounded-full ring-4 ring-emerald-500/30 bg-zinc-800 flex items-center justify-center text-3xl font-bold text-zinc-500"
                aria-hidden
              >
                {(user.name || '?').slice(0, 1).toUpperCase()}
              </div>
            )}
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

          {(instagramUrl.trim() || lineUrl.trim()) && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-8 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5"
            >
              <h3 className="text-sm font-semibold text-zinc-400 mb-3">
                SNSリンク
              </h3>
              <div className="flex flex-wrap gap-3">
                {instagramUrl.trim() && (
                  <a
                    href={normalizeExternalUrl(instagramUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-600/20 to-pink-600/20 border border-pink-500/30 text-pink-300 text-sm font-medium hover:from-purple-600/30 hover:to-pink-600/30 transition-colors"
                  >
                    <Instagram className="w-5 h-5 shrink-0" aria-hidden />
                    Instagram
                  </a>
                )}
                {lineUrl.trim() && (
                  <a
                    href={normalizeExternalUrl(lineUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-sm font-medium hover:bg-emerald-500/15 transition-colors"
                  >
                    <LinkIcon className="w-5 h-5 shrink-0" aria-hidden />
                    LINE
                  </a>
                )}
              </div>
            </motion.div>
          )}

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
                    プロフィールを編集
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

                  {isOwnProfile && (
                    <div className="flex flex-col items-center gap-3 pb-2 border-b border-zinc-800">
                      <p className="text-sm font-medium text-zinc-400 self-start w-full">
                        プロフィール写真
                      </p>
                      <div className="flex flex-col sm:flex-row items-center gap-4 w-full">
                        {user.avatar ? (
                          <img
                            src={user.avatar}
                            alt=""
                            className="w-20 h-20 rounded-full object-cover ring-2 ring-emerald-500/40"
                          />
                        ) : (
                          <div className="w-20 h-20 rounded-full ring-2 ring-emerald-500/40 bg-zinc-800 flex items-center justify-center text-2xl font-bold text-zinc-500">
                            {(displayName || user.name || '?')
                              .slice(0, 1)
                              .toUpperCase()}
                          </div>
                        )}
                        <div className="flex flex-col gap-2 flex-1 w-full">
                          <input
                            ref={avatarInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleAvatarFileChange}
                            disabled={avatarUploading || isSaving}
                          />
                          <button
                            type="button"
                            onClick={() => avatarInputRef.current?.click()}
                            disabled={avatarUploading || isSaving}
                            className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-semibold hover:bg-zinc-700 hover:border-zinc-600 transition-colors disabled:opacity-50"
                          >
                            {avatarUploading
                              ? 'アップロード中...'
                              : '写真を選択（カメラ・アルバム）'}
                          </button>
                          <p className="text-xs text-zinc-500">
                            JPEG / PNG など（最大5MB）。保存ボタンを押さなくても反映されます。
                          </p>
                        </div>
                      </div>
                      {avatarUploadError && (
                        <p className="text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2 w-full">
                          {avatarUploadError}
                        </p>
                      )}
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">
                      名前
                    </label>
                    <input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-50 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-shadow"
                      disabled={isSaving}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-1">
                      担当パート (英語表記)
                    </label>
                    <p className="text-xs text-zinc-500 mb-2">
                      ※複数の場合はカンマ（,）で区切って入力してください
                    </p>
                    <input
                      value={playedInstruments}
                      onChange={(e) => setPlayedInstruments(e.target.value)}
                      placeholder="例: Guitar, Vocal"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-50 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-shadow"
                      disabled={isSaving}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-1">
                      好きなジャンル
                    </label>
                    <p className="text-xs text-zinc-500 mb-2">
                      ※複数の場合はカンマ（,）で区切って入力してください
                    </p>
                    <input
                      value={favoriteGenres}
                      onChange={(e) => setFavoriteGenres(e.target.value)}
                      placeholder="例: Rock, J-Pop"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-50 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-shadow"
                      disabled={isSaving}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-1">
                      好きなバンド Top 3
                    </label>
                    <p className="text-xs text-zinc-500 mb-2">
                      ※複数の場合はカンマ（,）で区切って入力してください
                    </p>
                    <input
                      value={top3Bands}
                      onChange={(e) => setTop3Bands(e.target.value)}
                      placeholder="例: Arctic Monkeys, Oasis, Blur"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-50 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-shadow"
                      disabled={isSaving}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-1">
                      使用機材
                    </label>
                    <p className="text-xs text-zinc-500 mb-2">
                      ※複数の場合はカンマ（,）で区切って入力してください
                    </p>
                    <input
                      value={myGear}
                      onChange={(e) => setMyGear(e.target.value)}
                      placeholder="例: Stratocaster, Marshall Amp"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-50 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-shadow"
                      disabled={isSaving}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">
                      現在募集中のバンド・パート
                    </label>
                    <textarea
                      value={recruitmentStatus}
                      onChange={(e) => setRecruitmentStatus(e.target.value)}
                      rows={4}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-50 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-shadow resize-none"
                      disabled={isSaving}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">
                      インスタURL
                    </label>
                    <input
                      type="url"
                      value={instagramUrl}
                      onChange={(e) => setInstagramUrl(e.target.value)}
                      placeholder="https://instagram.com/..."
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-50 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-shadow"
                      disabled={isSaving}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">
                      LINEリンク
                    </label>
                    <input
                      type="url"
                      value={lineUrl}
                      onChange={(e) => setLineUrl(e.target.value)}
                      placeholder="https://line.me/..."
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-50 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-shadow"
                      disabled={isSaving}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSaving || !displayName.trim()}
                    className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-semibold py-3 px-6 rounded-xl shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {isSaving ? '保存中...' : '保存する'}
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
