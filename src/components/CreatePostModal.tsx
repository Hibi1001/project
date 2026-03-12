import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Music2 } from 'lucide-react';
import { createPost, searchiTunesSongs, type iTunesSongResult } from '../lib/api';

const DEBOUNCE_MS = 350;

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
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<iTunesSongResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const performSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setIsSearching(true);
    setError(null);
    try {
      const songs = await searchiTunesSongs(q);
      setResults(songs);
    } catch {
      setResults([]);
      setError('検索に失敗しました');
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setIsSearching(false);
      return;
    }
    const t = setTimeout(() => performSearch(query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, performSearch]);

  const handleSelectSong = async (song: iTunesSongResult) => {
    if (isSubmitting || !song.previewUrl) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await createPost({
        userId,
        trackName: song.trackName,
        artistName: song.artistName,
        previewUrl: song.previewUrl,
        coverUrl: song.artworkUrl100,
      });
      setQuery('');
      setResults([]);
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
      setQuery('');
      setResults([]);
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
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50"
            aria-hidden
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', duration: 0.3 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md mx-4 max-h-[85vh] flex flex-col"
          >
            <div className="bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-800 overflow-hidden flex flex-col max-h-full">
              <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
                <h2 className="text-lg font-semibold text-zinc-50">
                  今日の1曲をシェア
                </h2>
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isSubmitting}
                  className="p-2 rounded-full text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800 transition-colors disabled:opacity-50"
                  aria-label="閉じる"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 flex flex-col min-h-0">
                <label
                  htmlFor="song-search"
                  className="block text-sm font-medium text-zinc-400 mb-2"
                >
                  Search Song / 楽曲検索
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                  <input
                    id="song-search"
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="曲名やアーティストで検索..."
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl pl-10 pr-4 py-3 text-zinc-50 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-shadow"
                    disabled={isSubmitting}
                    autoFocus
                  />
                </div>

                {error && (
                  <p className="mt-3 text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}

                <div className="mt-3 flex-1 min-h-0 flex flex-col">
                  {isSearching && (
                    <p className="text-sm text-zinc-500 py-4">検索中...</p>
                  )}
                  {!isSearching && query.trim() && results.length === 0 && (
                    <p className="text-sm text-zinc-500 py-4">
                      結果がありません。別のキーワードで試してください。
                    </p>
                  )}
                  {!isSearching && results.length > 0 && (
                    <ul className="overflow-y-auto space-y-1 pr-1 -mr-1">
                      <AnimatePresence mode="popLayout">
                        {results.map((song, index) => (
                          <motion.li
                            key={`${song.trackName}-${song.artistName}-${index}`}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className="list-none"
                          >
                            <button
                              type="button"
                              onClick={() => handleSelectSong(song)}
                              disabled={isSubmitting}
                              className="w-full flex items-center gap-3 p-3 rounded-xl bg-zinc-800/50 hover:bg-zinc-800 border border-transparent hover:border-zinc-700 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <img
                                src={song.artworkUrl100}
                                alt=""
                                className="w-12 h-12 rounded-lg shrink-0 object-cover"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="text-zinc-50 font-medium truncate">
                                  {song.trackName}
                                </p>
                                <p className="text-zinc-400 text-sm truncate">
                                  {song.artistName}
                                </p>
                              </div>
                              <Music2 className="w-5 h-5 text-zinc-500 shrink-0" />
                            </button>
                          </motion.li>
                        ))}
                      </AnimatePresence>
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
