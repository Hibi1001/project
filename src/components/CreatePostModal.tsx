import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Music2, Search } from 'lucide-react';
import {
  createPost,
  searchItunesTracksForPosting,
  type ItunesShareTrack,
} from '../lib/api';
import { supabase } from '../lib/supabase';
import { POST_CAPTION_MAX_LENGTH } from '../types';

const DEFAULT_TREND_ARTISTS = [
  'Ado',
  'Oasis',
  'Vaundy',
  'ASIAN KUNG-FU GENERATION',
] as const;

interface CreatePostModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitSuccess: () => void;
  userId: string;
}

export default function CreatePostModal({
  isOpen,
  onClose,
  onSubmitSuccess,
  userId,
}: CreatePostModalProps) {
  const [searchTracks, setSearchTracks] = useState<ItunesShareTrack[]>([]);
  const [recommendedTracks, setRecommendedTracks] = useState<
    ItunesShareTrack[]
  >([]);
  const [recommendedHeading, setRecommendedHeading] = useState<string | null>(
    null,
  );
  const [recommendLoading, setRecommendLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [selectedTrack, setSelectedTrack] = useState<ItunesShareTrack | null>(
    null,
  );

  const runSearch = useCallback(async () => {
    if (!isOpen) return;
    const q = searchQuery.trim();
    if (!q) {
      setSearchTracks([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const list = await searchItunesTracksForPosting(q);
      setSearchTracks(list);
      if (list.length === 0) {
        setError('曲が見つかりませんでした。別のキーワードで試してください。');
      }
    } catch {
      setError('検索に失敗しました。もう一度お試しください。');
      setSearchTracks([]);
    } finally {
      setIsLoading(false);
    }
  }, [isOpen, searchQuery]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchTracks([]);
      setError(null);
    }
  }, [searchQuery]);

  useEffect(() => {
    if (!isOpen || searchQuery.trim()) {
      return;
    }

    let cancelled = false;

    void (async () => {
      setRecommendLoading(true);
      try {
        const { data: rows, error: postError } = await supabase
          .from('posts')
          .select('artist_name')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(1);

        if (cancelled) return;

        const artistFromPost =
          !postError && rows?.[0]?.artist_name?.trim()
            ? String(rows[0].artist_name).trim()
            : null;

        let term: string;
        let heading: string;

        if (artistFromPost) {
          term = artistFromPost;
          heading = '最近聴いているアーティスト';
        } else {
          term =
            DEFAULT_TREND_ARTISTS[
              Math.floor(Math.random() * DEFAULT_TREND_ARTISTS.length)
            ];
          heading = 'おすすめのトレンド曲';
        }

        const list = await searchItunesTracksForPosting(term);
        if (cancelled) return;
        setRecommendedTracks(list);
        setRecommendedHeading(heading);
      } catch {
        if (!cancelled) {
          setRecommendedTracks([]);
          setRecommendedHeading(null);
        }
      } finally {
        if (!cancelled) {
          setRecommendLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, userId, searchQuery]);

  useEffect(() => {
    if (!isOpen) {
      setSearchTracks([]);
      setRecommendedTracks([]);
      setRecommendedHeading(null);
      setRecommendLoading(false);
      setSearchQuery('');
      setError(null);
      setCaption('');
      setSelectedTrack(null);
    }
  }, [isOpen]);

  const handleSelectTrack = (track: ItunesShareTrack) => {
    if (isSubmitting) return;
    setError(null);
    setSelectedTrack(track);
  };

  const handleSubmit = async () => {
    if (!selectedTrack || isSubmitting) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const previewUrl = selectedTrack.previewUrl?.trim() || null;

      await createPost({
        userId,
        trackName: selectedTrack.name,
        artistName: selectedTrack.artist,
        spotifyTrackId: selectedTrack.id,
        previewUrl,
        coverUrl: selectedTrack.albumArt,
        caption: caption.trim() || null,
      });
      setSearchTracks([]);
      setRecommendedTracks([]);
      setRecommendedHeading(null);
      setSearchQuery('');
      setCaption('');
      setSelectedTrack(null);
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
      setSearchTracks([]);
      setRecommendedTracks([]);
      setRecommendedHeading(null);
      setSearchQuery('');
      setCaption('');
      setSelectedTrack(null);
      onClose();
    }
  };

  const isSearchMode = Boolean(searchQuery.trim());
  const displayTracks = isSearchMode ? searchTracks : recommendedTracks;
  const listLoading = isSearchMode ? isLoading : recommendLoading;
  const showRecommendedSectionHeading =
    !isSearchMode &&
    Boolean(recommendedHeading) &&
    recommendedTracks.length > 0;

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
                  曲をシェア
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

                {error ? (
                  <p className="mt-2 rounded-lg bg-red-400/10 px-3 py-2 text-sm text-red-400">
                    {error}
                  </p>
                ) : null}

                <div className="mt-3 flex min-h-0 flex-1 flex-col">
                  {selectedTrack ? (
                    <div className="mb-3 shrink-0 rounded-xl border border-emerald-500/40 bg-zinc-900/70 px-3 py-3 text-sm text-zinc-100 shadow-md shadow-emerald-500/10">
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-400">
                        選択中の曲
                      </p>
                      <div className="flex items-center gap-3">
                        <img
                          src={selectedTrack.albumArt}
                          alt=""
                          className="h-12 w-12 shrink-0 rounded-lg object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-zinc-50">
                            {selectedTrack.name}
                          </p>
                          <p className="truncate text-xs text-zinc-400">
                            {selectedTrack.artist}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedTrack(null)}
                          disabled={isSubmitting}
                          className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800 disabled:opacity-60"
                        >
                          キャンセル
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSubmit()}
                          disabled={isSubmitting}
                          className="rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-white shadow-sm shadow-emerald-500/30 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          投稿
                        </button>
                      </div>
                    </div>
                  ) : null}

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
                      disabled={isSubmitting}
                      className="mt-1.5 w-full resize-none rounded-lg border border-zinc-700 bg-zinc-900/80 px-2.5 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 disabled:opacity-50"
                    />
                    <p className="mt-1 text-right text-[10px] text-zinc-500">
                      {caption.length}/{POST_CAPTION_MAX_LENGTH}
                    </p>
                  </div>

                  {listLoading ? (
                    <p className="py-4 text-sm text-zinc-500">
                      {isSearchMode ? '検索中…' : '読み込み中…'}
                    </p>
                  ) : null}

                  {!listLoading &&
                  showRecommendedSectionHeading &&
                  recommendedHeading ? (
                    <p className="mb-2 text-xs font-semibold text-zinc-500">
                      {recommendedHeading}
                    </p>
                  ) : null}

                  {!listLoading && displayTracks.length > 0 ? (
                    <ul className="-mr-1 space-y-1 overflow-y-auto pr-1">
                      <AnimatePresence mode="popLayout">
                        {displayTracks.map((track) => (
                          <motion.li
                            key={track.id}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className="list-none"
                          >
                            <button
                              type="button"
                              onClick={() => handleSelectTrack(track)}
                              disabled={isSubmitting}
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
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
