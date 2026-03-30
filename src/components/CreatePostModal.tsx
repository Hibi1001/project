import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Music2, Search } from 'lucide-react';
import {
  createPost,
  fetchTodaysPostCountForUser,
  searchItunesTracksForPosting,
  type ItunesShareTrack,
} from '../lib/api';
import { DAILY_POST_LIMIT } from '../constants/posting';
import { POST_CAPTION_MAX_LENGTH } from '../types';

interface CreatePostModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitSuccess: () => void;
  userId: string;
  shareSongBlocked: boolean;
  /** Shown when `shareSongBlocked` (daily cap reached). */
  shareLimitMessage: string;
}

export default function CreatePostModal({
  isOpen,
  onClose,
  onSubmitSuccess,
  userId,
  shareSongBlocked,
  shareLimitMessage,
}: CreatePostModalProps) {
  const [tracks, setTracks] = useState<ItunesShareTrack[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [searchAttempted, setSearchAttempted] = useState(false);

  const runSearch = useCallback(async () => {
    if (!isOpen || shareSongBlocked) return;
    const q = searchQuery.trim();
    if (!q) {
      setTracks([]);
      return;
    }
    setIsLoading(true);
    setSearchAttempted(true);
    setError(null);
    try {
      const list = await searchItunesTracksForPosting(q);
      setTracks(list);
      if (list.length === 0) {
        setError('曲が見つかりませんでした。別のキーワードで試してください。');
      }
    } catch {
      setError('検索に失敗しました。もう一度お試しください。');
      setTracks([]);
    } finally {
      setIsLoading(false);
    }
  }, [isOpen, searchQuery, shareSongBlocked]);

  useEffect(() => {
    if (!isOpen) {
      setTracks([]);
      setSearchQuery('');
      setError(null);
      setCaption('');
      setSearchAttempted(false);
    }
  }, [isOpen]);

  const handleSelectTrack = async (track: ItunesShareTrack) => {
    if (isSubmitting) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const todayCount = await fetchTodaysPostCountForUser(userId);
      if (todayCount >= DAILY_POST_LIMIT) {
        setError(
          `本日のシェア上限（${DAILY_POST_LIMIT}回）に達しています。明日またお試しください。`,
        );
        setIsSubmitting(false);
        return;
      }

      const previewUrl = track.previewUrl?.trim() || null;

      await createPost({
        userId,
        trackName: track.name,
        artistName: track.artist,
        spotifyTrackId: track.id,
        previewUrl,
        coverUrl: track.albumArt,
        caption: caption.trim() || null,
      });
      setTracks([]);
      setSearchQuery('');
      setCaption('');
      onClose();
      onSubmitSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : '投稿に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setError(null);
      setTracks([]);
      setSearchQuery('');
      setCaption('');
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
            aria-hidden
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', duration: 0.3 }}
            className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-20"
          >
            <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl">
              <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-6 py-4">
                <h2 className="text-lg font-semibold text-zinc-50">
                  曲をシェア（1日{DAILY_POST_LIMIT}回まで）
                </h2>
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isSubmitting}
                  className="rounded-full p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-50 disabled:opacity-50"
                  aria-label="閉じる"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex min-h-0 flex-1 flex-col p-4">
                {shareSongBlocked && shareLimitMessage ? (
                  <div className="mb-4 shrink-0 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3">
                    <p className="mb-1 text-xs font-semibold text-amber-200/95">
                      Today&apos;s limit: {DAILY_POST_LIMIT} songs
                    </p>
                    <p className="text-sm leading-snug text-amber-100/90">
                      本日のシェアは{DAILY_POST_LIMIT}回までです。
                    </p>
                    <p className="mt-2 text-sm font-medium leading-snug text-amber-300">
                      {shareLimitMessage}
                    </p>
                  </div>
                ) : null}

                {!shareSongBlocked ? (
                  <div className="mb-3 shrink-0 space-y-2">
                    <label
                      htmlFor="track-search"
                      className="block text-xs font-medium text-zinc-400"
                    >
                      曲名・アーティストで検索（iTunes）
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="track-search"
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void runSearch();
                          }
                        }}
                        placeholder="例: Official髭男dism Pretender"
                        disabled={isSubmitting || isLoading}
                        className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
                      />
                      <button
                        type="button"
                        onClick={() => void runSearch()}
                        disabled={
                          isSubmitting || isLoading || !searchQuery.trim()
                        }
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Search className="h-4 w-4" />
                        検索
                      </button>
                    </div>
                    <p className="text-[11px] leading-relaxed text-zinc-500">
                      プレビューがない曲は、投稿後もタイムラインで再生されない場合があります。
                    </p>
                  </div>
                ) : null}

                {error ? (
                  <p className="mt-2 rounded-lg bg-red-400/10 px-3 py-2 text-sm text-red-400">
                    {error}
                  </p>
                ) : null}

                {!shareSongBlocked ? (
                  <div className="mt-3 flex min-h-0 flex-1 flex-col">
                    <div className="mb-3 shrink-0 rounded-xl border border-zinc-700/80 bg-zinc-800/40 px-3 py-2">
                      <label
                        htmlFor="post-caption"
                        className="text-xs font-medium text-zinc-400"
                      >
                        ひとこと（任意・{POST_CAPTION_MAX_LENGTH}文字まで）
                      </label>
                      <textarea
                        id="post-caption"
                        value={caption}
                        onChange={(e) =>
                          setCaption(
                            e.target.value.slice(0, POST_CAPTION_MAX_LENGTH),
                          )
                        }
                        rows={2}
                        placeholder="今日の気分をひとこと…"
                        disabled={isSubmitting || shareSongBlocked}
                        className="mt-1.5 w-full resize-none rounded-lg border border-zinc-700 bg-zinc-900/80 px-2.5 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 disabled:opacity-50"
                      />
                      <p className="mt-1 text-right text-[10px] text-zinc-500">
                        {caption.length}/{POST_CAPTION_MAX_LENGTH}
                      </p>
                    </div>

                    {isLoading ? (
                      <p className="py-4 text-sm text-zinc-500">検索中…</p>
                    ) : null}
                    {!isLoading &&
                    !searchAttempted &&
                    !searchQuery.trim() ? (
                      <p className="py-4 text-sm text-zinc-500">
                        キーワードを入力して「検索」を押してください。
                      </p>
                    ) : null}

                    {!isLoading && tracks.length > 0 ? (
                      <ul className="-mr-1 space-y-1 overflow-y-auto pr-1">
                        <AnimatePresence mode="popLayout">
                          {tracks.map((track) => (
                            <motion.li
                              key={track.id}
                              initial={{ opacity: 0, y: 8 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0 }}
                              className="list-none"
                            >
                              <button
                                type="button"
                                onClick={() => void handleSelectTrack(track)}
                                disabled={isSubmitting || shareSongBlocked}
                                className="flex w-full items-center gap-3 rounded-xl border border-transparent bg-zinc-800/50 p-3 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <img
                                  src={track.albumArt}
                                  alt=""
                                  className="h-12 w-12 shrink-0 rounded-lg object-cover"
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-medium text-zinc-50">
                                    {track.name}
                                  </p>
                                  <p className="truncate text-sm text-zinc-400">
                                    {track.artist}
                                  </p>
                                  {!track.previewUrl ? (
                                    <p className="mt-0.5 text-[10px] text-amber-500/90">
                                      プレビューなし
                                    </p>
                                  ) : null}
                                </div>
                                <Music2 className="h-5 w-5 shrink-0 text-zinc-500" />
                              </button>
                            </motion.li>
                          ))}
                        </AnimatePresence>
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
