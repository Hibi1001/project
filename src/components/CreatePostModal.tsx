import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Music2 } from 'lucide-react';
import {
  createPost,
  fetchItunesPreviewForSpotifyTrack,
  fetchLatestPostCreatedAtForUser,
  formatShareCooldownJa,
  getShareCooldownFromLatestPost,
} from '../lib/api';
import { getOAuthRedirectTo, supabase } from '../lib/supabase';
import { POST_CAPTION_MAX_LENGTH } from '../types';

interface CreatePostModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitSuccess: () => void;
  userId: string;
  spotifyAccessToken: string | null;
  shareSongBlocked: boolean;
  shareCooldownText: string;
}

export default function CreatePostModal({
  isOpen,
  onClose,
  onSubmitSuccess,
  userId,
  spotifyAccessToken,
  shareSongBlocked,
  shareCooldownText,
}: CreatePostModalProps) {
  const [tracks, setTracks] = useState<
    { id: string; name: string; artist: string; albumArt: string; previewUrl: string | null }[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState('');

  useEffect(() => {
    const fetchRecentlyPlayed = async () => {
      if (!isOpen || !spotifyAccessToken) {
        setTracks([]);
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=20', {
          headers: {
            Authorization: `Bearer ${spotifyAccessToken}`,
          },
        });
        if (!res.ok) {
          setError('Failed to fetch recently played tracks from Spotify.');
          setTracks([]);
          setIsLoading(false);
          return;
        }
        const json = await res.json();
        const items = Array.isArray(json.items) ? json.items : [];
        const mapped = items
          .map((item: any) => {
            const track = item?.track;
            if (!track) return null;
            const name = track.name as string | undefined;
            const artist = (track.artists?.[0]?.name as string | undefined) ?? '';
            const albumArt =
              (track.album?.images?.[0]?.url as string | undefined) ??
              'https://placehold.co/64x64?text=No+Art';
            const previewUrl = (track.preview_url as string | null) ?? null;
            const id = track.id as string | undefined;
            if (!id || !name || !artist) return null;
            return { id, name, artist, albumArt, previewUrl };
          })
          .filter(Boolean) as {
          id: string;
          name: string;
          artist: string;
          albumArt: string;
          previewUrl: string | null;
        }[];
        setTracks(mapped);
      } catch {
        setError('Failed to fetch recently played tracks from Spotify.');
        setTracks([]);
      } finally {
        setIsLoading(false);
      }
    };

    void fetchRecentlyPlayed();
  }, [isOpen, spotifyAccessToken]);

  const handleSelectTrack = async (track: {
    id: string;
    name: string;
    artist: string;
    albumArt: string;
    previewUrl: string | null;
  }) => {
    if (isSubmitting) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const latestIso = await fetchLatestPostCreatedAtForUser(userId);
      const cd = getShareCooldownFromLatestPost(latestIso, Date.now());
      if (cd.blocked) {
        setError(formatShareCooldownJa(cd));
        setIsSubmitting(false);
        return;
      }

      // Spotify Web API often omits preview_url now — fill from iTunes silently when missing.
      let previewUrl =
        track.previewUrl?.trim() ? track.previewUrl.trim() : null;
      if (!previewUrl) {
        previewUrl = await fetchItunesPreviewForSpotifyTrack(
          track.name,
          track.artist,
        );
      }

      await createPost({
        userId,
        trackName: track.name,
        artistName: track.artist,
        previewUrl,
        coverUrl: track.albumArt,
        caption: caption.trim() || null,
      });
      setTracks([]);
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
            <div className="w-full max-w-md max-h-[85vh] bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-800 overflow-hidden flex flex-col">
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
                {shareSongBlocked && shareCooldownText ? (
                  <div className="mb-4 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 shrink-0">
                    <p className="text-xs font-semibold text-amber-200/95 mb-1">
                      12時間に1回までシェアできます
                    </p>
                    <p className="text-sm text-amber-100/90 leading-snug">
                      最後の投稿時刻（データベースの記録）から12時間が経つまで、新しい曲を選べません。
                    </p>
                    <p className="text-sm text-amber-300 font-medium mt-2 tabular-nums">
                      {shareCooldownText}
                    </p>
                  </div>
                ) : null}

                {!spotifyAccessToken && (
                  <>
                    <p className="text-sm text-zinc-400 mb-3">
                      Spotify と連携して最近再生した曲から選択できます。
                    </p>
                    <button
                      type="button"
                      onClick={async () => {
                        // Triggers Spotify OAuth; Supabase will handle redirect and session update.
                        await supabase.auth.signInWithOAuth({
                          provider: 'spotify',
                          options: {
                            scopes: 'user-read-recently-played',
                            redirectTo: getOAuthRedirectTo(),
                          },
                        });
                      }}
                      className="w-full bg-emerald-500 text-white font-semibold py-2.5 px-4 rounded-xl shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 transition-all text-sm"
                      disabled={isSubmitting}
                    >
                      Connect with Spotify
                    </button>
                  </>
                )}

                {error && (
                  <p className="mt-3 text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}

                {spotifyAccessToken && (
                  <div className="mt-3 flex-1 min-h-0 flex flex-col">
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
                    {isLoading && (
                      <p className="text-sm text-zinc-500 py-4">Spotify から取得中...</p>
                    )}
                    {!isLoading && tracks.length === 0 && (
                      <p className="text-sm text-zinc-500 py-4">
                        最近再生した曲が見つかりませんでした。
                      </p>
                    )}
                    {!isLoading && tracks.length > 0 && (
                      <ul className="overflow-y-auto space-y-1 pr-1 -mr-1">
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
                                onClick={() => handleSelectTrack(track)}
                                disabled={isSubmitting || shareSongBlocked}
                                className="w-full flex items-center gap-3 p-3 rounded-xl bg-zinc-800/50 hover:bg-zinc-800 border border-transparent hover:border-zinc-700 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <img
                                  src={track.albumArt}
                                  alt=""
                                  className="w-12 h-12 rounded-lg shrink-0 object-cover"
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="text-zinc-50 font-medium truncate">
                                    {track.name}
                                  </p>
                                  <p className="text-zinc-400 text-sm truncate">
                                    {track.artist}
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
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
