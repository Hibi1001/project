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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import {
  fetchUserById,
  fetchPostsByUserId,
  fetchUserByProfileSlug,
  isProfileUuid,
} from '../lib/api';
import type { User, Post } from '../types';
import { supabase } from '../lib/supabase';

const SHARED_SONGS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (err) => reject(err));
    image.src = src;
  });
}

/** Renders the cropped 1:1 region to a square JPEG blob for upload. */
async function getCroppedImageBlob(
  imageSrc: string,
  pixelCrop: Area,
  outputSize = 512,
): Promise<Blob> {
  const image = await loadImageElement(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas が利用できません。');

  canvas.width = outputSize;
  canvas.height = outputSize;
  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    outputSize,
    outputSize,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('画像の切り抜きに失敗しました。'));
        else resolve(blob);
      },
      'image/jpeg',
      0.92,
    );
  });
}

interface ProfileProps {
  /** UUID or `display_id` (no `@` required). */
  profileSlug: string;
  onBack: () => void;
  /** When the loaded user has a `display_id` but the URL used UUID, update the address bar. */
  onProfileCanonicalSlugChange?: (slug: string) => void;
}

const DISPLAY_ID_INPUT_RE = /^[a-zA-Z0-9]{3,30}$/;

export default function Profile({
  profileSlug,
  onBack,
  onProfileCanonicalSlugChange,
}: ProfileProps) {
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

  const [avatarCropOpen, setAvatarCropOpen] = useState(false);
  const [avatarCropImageSrc, setAvatarCropImageSrc] = useState<string | null>(
    null,
  );
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const croppedAreaPixelsRef = useRef<Area | null>(null);

  const [displayName, setDisplayName] = useState('');
  const [playedInstruments, setPlayedInstruments] = useState('');
  const [favoriteGenres, setFavoriteGenres] = useState('');
  const [top3Bands, setTop3Bands] = useState('');
  const [myGear, setMyGear] = useState('');
  const [recruitmentStatus, setRecruitmentStatus] = useState('');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [lineUrl, setLineUrl] = useState('');
  const [displayIdInput, setDisplayIdInput] = useState('');
  const persistedSnsRef = useRef({ instagram: '', line: '' });
  /** `posts.created_at` (ISO) keyed by post id — used only for the 7-day shared songs filter. */
  const [postCreatedAtById, setPostCreatedAtById] = useState<
    Record<string, string>
  >({});

  const recentSharedPosts = useMemo(() => {
    const cutoff = Date.now() - SHARED_SONGS_WINDOW_MS;
    return userPosts.filter((post) => {
      const createdAt = postCreatedAtById[post.id];
      if (!createdAt) return false;
      const t = new Date(createdAt).getTime();
      return !Number.isNaN(t) && t >= cutoff;
    });
  }, [userPosts, postCreatedAtById]);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      const slug = profileSlug.trim();

      let userData = await fetchUserByProfileSlug(slug);

      const { data: authData, error: authUserError } =
        await supabase.auth.getUser();
      const authedUser = authUserError ? null : authData.user;
      const authedId = authedUser?.id;

      const isOwnUuidRoute =
        Boolean(authedId) && isProfileUuid(slug) && authedId === slug;

      // Lazy-create `public.users` on first visit to own profile (no row at signup).
      if (!userData && isOwnUuidRoute && authedUser && authedId) {
        const email = authedUser.email ?? '';
        const displayName =
          (email.includes('@')
            ? email.slice(0, email.indexOf('@')).trim()
            : '') ||
          email ||
          'User';

        const { error: insertErr } = await supabase.from('users').insert({
          id: authedId,
          display_name: displayName,
        });

        if (insertErr) {
          if (insertErr.code !== '23505') {
            console.error(
              '[Profile] lazy users row insert failed:',
              insertErr,
            );
          }
        }

        userData = await fetchUserByProfileSlug(slug);
      }

      if (!userData) {
        setUser(null);
        setUserPosts([]);
        setPostCreatedAtById({});
        setIsLoading(false);
        return;
      }
      const uid = userData.id;
      const postsData = await fetchPostsByUserId(uid);
      setUser(userData);
      setUserPosts(postsData);

      const { data: postTsRows } = await supabase
        .from('posts')
        .select('id, created_at')
        .eq('user_id', uid);
      const tsMap: Record<string, string> = {};
      (postTsRows as { id: string; created_at: string }[] | null)?.forEach(
        (row) => {
          if (row.id && row.created_at) tsMap[row.id] = row.created_at;
        },
      );
      setPostCreatedAtById(tsMap);

      const { data: snsRow } = await supabase
        .from('users')
        .select('instagram_url, line_url')
        .eq('id', uid)
        .maybeSingle();
      const ig = (snsRow as { instagram_url?: string | null } | null)?.instagram_url ?? '';
      const ln = (snsRow as { line_url?: string | null } | null)?.line_url ?? '';
      persistedSnsRef.current = { instagram: ig, line: ln };
      setInstagramUrl(ig);
      setLineUrl(ln);
      setIsLoading(false);
    };

    load();
  }, [profileSlug]);

  useEffect(() => {
    if (!user?.displayId) return;
    if (!isProfileUuid(profileSlug)) return;
    if (profileSlug !== user.id) return;
    onProfileCanonicalSlugChange?.(user.displayId);
  }, [
    user?.id,
    user?.displayId,
    profileSlug,
    onProfileCanonicalSlugChange,
  ]);

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

  const isOwnProfile = Boolean(
    authUserId && user && authUserId === user.id,
  );

  const onAvatarCropComplete = useCallback(
    (_area: Area, areaPixels: Area) => {
      croppedAreaPixelsRef.current = areaPixels;
    },
    [],
  );

  const revokeCropObjectUrl = useCallback(() => {
    setAvatarCropImageSrc((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

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
    setDisplayIdInput(user.displayId ?? '');
    setIsEditOpen(true);
  };

  const closeEdit = () => {
    if (isSaving) return;
    if (avatarCropOpen) {
      setAvatarCropOpen(false);
      revokeCropObjectUrl();
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      croppedAreaPixelsRef.current = null;
    }
    setIsEditOpen(false);
    setSaveError(null);
  };

  const cancelAvatarCrop = () => {
    setAvatarCropOpen(false);
    revokeCropObjectUrl();
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    croppedAreaPixelsRef.current = null;
  };

  const uploadCroppedAvatar = async (blob: Blob) => {
    if (!authUserId || !user || authUserId !== user.id) return;

    const objectPath = `${authUserId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(objectPath, blob, {
        cacheControl: '3600',
        upsert: true,
        contentType: 'image/jpeg',
      });

    if (uploadError) {
      setAvatarUploadError(uploadError.message);
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
      return;
    }

    const refreshed = await fetchUserById(user.id);
    setUser(refreshed);
  };

  const handleConfirmAvatarCrop = async () => {
    const src = avatarCropImageSrc;
    const pixels = croppedAreaPixelsRef.current;
    if (!src || !pixels || !authUserId || !user || authUserId !== user.id)
      return;

    setAvatarUploading(true);
    setAvatarUploadError(null);

    try {
      const blob = await getCroppedImageBlob(src, pixels);
      URL.revokeObjectURL(src);
      setAvatarCropImageSrc(null);
      setAvatarCropOpen(false);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      croppedAreaPixelsRef.current = null;

      await uploadCroppedAvatar(blob);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : '画像の処理に失敗しました。';
      setAvatarUploadError(message);
      URL.revokeObjectURL(src);
      setAvatarCropImageSrc(null);
      setAvatarCropOpen(false);
    } finally {
      setAvatarUploading(false);
    }
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

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !authUserId || !user || authUserId !== user.id) return;
    if (!file.type.startsWith('image/')) {
      setAvatarUploadError('画像ファイルを選択してください。');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarUploadError('ファイルサイズは5MB以下にしてください。');
      return;
    }

    setAvatarUploadError(null);
    setAvatarCropImageSrc((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    croppedAreaPixelsRef.current = null;
    setAvatarCropOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUserId || !user || authUserId !== user.id) return;
    setIsSaving(true);
    setSaveError(null);

    const rawDisplayId = displayIdInput.trim();
    let displayIdForDb: string | null = null;
    if (rawDisplayId) {
      if (!DISPLAY_ID_INPUT_RE.test(rawDisplayId)) {
        setSaveError(
          '表示IDは3〜30文字の半角英数字のみ使用できます（空欄で未設定に戻せます）。',
        );
        setIsSaving(false);
        return;
      }
      displayIdForDb = rawDisplayId.toLowerCase();
    }

    const { error } = await supabase
      .from('users')
      .update({
        display_id: displayIdForDb,
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
      const code = (error as { code?: string }).code;
      if (code === '23505') {
        setSaveError('この表示IDは既に使われています。別のIDを試してください。');
      } else {
        setSaveError(error.message);
      }
      setIsSaving(false);
      return;
    }

    const refreshed = await fetchUserById(user.id);
    setUser(refreshed);
    const igSaved = instagramUrl.trim();
    const lineSaved = lineUrl.trim();
    persistedSnsRef.current = { instagram: igSaved, line: lineSaved };
    setInstagramUrl(igSaved);
    setLineUrl(lineSaved);
    setDisplayIdInput(refreshed?.displayId ?? '');
    if (refreshed) {
      onProfileCanonicalSlugChange?.(refreshed.displayId ?? refreshed.id);
    }
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

  if (!user) {
    return (
      <div className="fixed inset-0 bg-zinc-950 flex flex-col items-center justify-center gap-4 px-6">
        <p className="text-zinc-400 text-sm text-center">
          プロフィールが見つかりません。
        </p>
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-semibold hover:bg-zinc-700 transition-colors"
        >
          戻る
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-zinc-950 overflow-y-auto">
      <div className="max-w-2xl mx-auto">
        <div className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/80 pt-[max(env(safe-area-inset-top),0px)] backdrop-blur-md">
          <div className="flex flex-row items-center justify-between gap-3 px-4 py-3">
            <button
              onClick={onBack}
              className="p-2 hover:bg-zinc-800 rounded-full transition-colors"
            >
              <ArrowLeft className="w-6 h-6 text-zinc-400" />
            </button>
            <h1 className="whitespace-nowrap text-lg font-bold text-zinc-50 sm:text-2xl">
              プロフィール
            </h1>
            {isOwnProfile && (
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <button
                  onClick={openEdit}
                  className="whitespace-nowrap rounded-full border border-zinc-700/60 bg-zinc-800/60 px-3 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:bg-zinc-800 sm:px-4 sm:text-sm"
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
                  className="hidden text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline sm:inline"
                >
                  Sign out / Reset
                </button>
              </div>
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
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <h3 className="text-lg font-bold text-zinc-50">
                過去にシェアした曲
              </h3>
              <span className="text-xs font-medium text-zinc-500 bg-zinc-800/80 border border-zinc-700/60 px-2 py-0.5 rounded-full">
                直近7日間
              </span>
            </div>
            {recentSharedPosts.length === 0 ? (
              <p className="text-sm text-zinc-500/90 mb-3">
                直近1週間のシェアはありません
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-4">
              {recentSharedPosts.map((post) => (
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
                            disabled={avatarUploading || isSaving || avatarCropOpen}
                          />
                          <button
                            type="button"
                            onClick={() => avatarInputRef.current?.click()}
                            disabled={avatarUploading || isSaving || avatarCropOpen}
                            className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-semibold hover:bg-zinc-700 hover:border-zinc-600 transition-colors disabled:opacity-50"
                          >
                            {avatarUploading
                              ? 'アップロード中...'
                              : '写真を選択（カメラ・アルバム）'}
                          </button>
                          <p className="text-xs text-zinc-500">
                            JPEG / PNG など（最大5MB）。選択後に1:1の範囲を決めてからアップロードされます。ピンチ・ドラッグで調整できます（保存ボタンは不要）。
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

                  {isOwnProfile && (
                    <div>
                      <label className="block text-sm font-medium text-zinc-400 mb-1">
                        表示ID（プロフィールURL用）
                      </label>
                      <p className="text-xs text-zinc-500 mb-2">
                        ※3〜30文字の半角英数字のみ。@は付けずに入力してください。空欄で未設定に戻せます。
                      </p>
                      <input
                        value={displayIdInput}
                        onChange={(e) =>
                          setDisplayIdInput(
                            e.target.value
                              .replace(/[^a-zA-Z0-9]/g, '')
                              .slice(0, 30),
                          )
                        }
                        placeholder="例: myname2024"
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-50 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-shadow"
                        disabled={isSaving}
                      />
                    </div>
                  )}

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

      <AnimatePresence>
        {avatarCropOpen && avatarCropImageSrc && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4 pb-10 sm:pb-4"
          >
            <motion.div
              role="presentation"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm cursor-default"
              onClick={avatarUploading ? undefined : cancelAvatarCrop}
            />
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ type: 'spring', duration: 0.35 }}
              className="relative z-10 w-full max-w-lg max-h-[90dvh] flex flex-col bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-800 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
                <h2 className="text-base font-semibold text-zinc-50 pr-2">
                  プロフィール写真を切り抜き
                </h2>
                <button
                  type="button"
                  onClick={cancelAvatarCrop}
                  disabled={avatarUploading}
                  className="p-2 rounded-full text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800 transition-colors disabled:opacity-50 shrink-0"
                  aria-label="閉じる"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div
                className="relative w-full h-[min(58dvh,380px)] sm:h-[400px] bg-zinc-950 mx-auto"
                style={{ touchAction: 'none' }}
              >
                <Cropper
                  image={avatarCropImageSrc}
                  crop={crop}
                  zoom={zoom}
                  aspect={1}
                  cropShape="round"
                  showGrid={false}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={onAvatarCropComplete}
                  objectFit="contain"
                  minZoom={1}
                  maxZoom={3}
                />
              </div>

              <div className="px-4 py-3 space-y-2 border-t border-zinc-800 shrink-0 bg-zinc-900">
                <div className="flex items-center justify-between gap-3">
                  <label
                    htmlFor="avatar-crop-zoom"
                    className="text-xs text-zinc-400 shrink-0"
                  >
                    拡大・縮小
                  </label>
                  <span className="text-xs text-zinc-500 tabular-nums">
                    {zoom.toFixed(2)}×
                  </span>
                </div>
                <input
                  id="avatar-crop-zoom"
                  type="range"
                  min={1}
                  max={3}
                  step={0.01}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  disabled={avatarUploading}
                  className="w-full h-2 accent-emerald-500 cursor-pointer touch-pan-x"
                />
                <p className="text-[11px] text-zinc-500 leading-snug">
                  ドラッグで位置、スライダーまたはピンチで拡大できます。丸い枠内がアイコンになります。
                </p>
              </div>

              <div className="flex gap-3 p-4 pt-2 border-t border-zinc-800 shrink-0">
                <button
                  type="button"
                  onClick={cancelAvatarCrop}
                  disabled={avatarUploading}
                  className="flex-1 py-3 rounded-xl border border-zinc-600 text-zinc-200 text-sm font-semibold hover:bg-zinc-800 transition-colors disabled:opacity-50"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmAvatarCrop()}
                  disabled={avatarUploading}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-sm font-semibold shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 transition-all disabled:opacity-50"
                >
                  {avatarUploading ? 'アップロード中...' : 'この範囲でアップロード'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
