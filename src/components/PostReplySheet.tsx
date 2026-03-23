import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Pin } from 'lucide-react';
import { fetchPostReplies, fetchUserById, insertPostReply } from '../lib/api';
import { supabase } from '../lib/supabase';
import type { PostReply } from '../types';
import { POST_REPLY_MAX_LENGTH } from '../types';

/** Original post “ひとこと” shown pinned above replies (not a `post_replies` row). */
export interface PostReplySheetPinnedOriginal {
  caption: string;
  authorName: string;
  authorAvatar: string;
}

interface PostReplySheetProps {
  postId: string | null;
  open: boolean;
  onClose: () => void;
  authUserId: string | null;
  /** OP caption + author; rendered once at top when `caption` is non-empty. */
  pinnedOriginal?: PostReplySheetPinnedOriginal | null;
  /** Called after a new reply (local or realtime) so the parent can refresh counts. */
  onReplyCreated?: (postId: string) => void;
}

export default function PostReplySheet({
  postId,
  open,
  onClose,
  authUserId,
  pinnedOriginal = null,
  onReplyCreated,
}: PostReplySheetProps) {
  const [replies, setReplies] = useState<PostReply[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReplies = useCallback(async (pid: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPostReplies(pid);
      setReplies(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !postId) {
      setReplies([]);
      setDraft('');
      setError(null);
      return;
    }
    void loadReplies(postId);
  }, [open, postId, loadReplies]);

  useEffect(() => {
    if (!open || !postId) return;

    const channel = supabase
      .channel(`post_replies:${postId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'post_replies',
          filter: `post_id=eq.${postId}`,
        },
        async (payload) => {
          const row = payload.new as {
            id: string;
            user_id: string;
            content: string;
            created_at: string;
          };
          if (!row?.id) return;

          const u = await fetchUserById(row.user_id);
          const next: PostReply = {
            id: row.id,
            userId: row.user_id,
            content: row.content,
            createdAt: row.created_at,
            authorName: u?.name ?? 'ユーザー',
            authorAvatar: u?.avatar ?? '',
          };
          setReplies((prev) => {
            if (prev.some((r) => r.id === next.id)) return prev;
            return [...prev, next].sort(
              (a, b) =>
                new Date(a.createdAt).getTime() -
                new Date(b.createdAt).getTime(),
            );
          });
          onReplyCreated?.(postId);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [open, postId, onReplyCreated]);

  const handleSubmit = async () => {
    if (!postId || !authUserId || submitting) return;
    const text = draft.trim().slice(0, POST_REPLY_MAX_LENGTH);
    if (!text) {
      setError('返信を入力してください');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await insertPostReply(postId, authUserId, text);
      setDraft('');
      await loadReplies(postId);
      onReplyCreated?.(postId);
    } catch (e) {
      setError(e instanceof Error ? e.message : '送信に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  const showPinned =
    Boolean(pinnedOriginal?.caption?.trim()) && pinnedOriginal != null;

  return (
    <AnimatePresence>
      {open && postId ? (
        <>
          <motion.button
            type="button"
            aria-label="閉じる"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-[2px]"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reply-sheet-title"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 380 }}
            className="fixed bottom-0 left-0 right-0 z-[61] flex max-h-[78vh] flex-col rounded-t-3xl border border-zinc-700/80 bg-zinc-900 shadow-2xl"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-5 py-3">
              <h2
                id="reply-sheet-title"
                className="text-base font-semibold text-zinc-100"
              >
                返信
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                aria-label="閉じる"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
              {loading ? (
                <p className="py-8 text-center text-sm text-zinc-500">
                  読み込み中…
                </p>
              ) : (
                <div className="space-y-3 pb-2">
                  {showPinned && pinnedOriginal ? (
                    <div
                      className="relative flex gap-3 rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-950/45 to-zinc-900/80 px-3 py-3 shadow-inner shadow-black/20"
                      aria-label="投稿者のひとこと"
                    >
                      <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300/95">
                        <Pin className="h-3 w-3" aria-hidden />
                        OP
                      </div>
                      <img
                        src={
                          pinnedOriginal.authorAvatar ||
                          'https://placehold.co/40x40/27272a/a1a1aa?text=?'
                        }
                        alt=""
                        className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-emerald-500/30"
                      />
                      <div className="min-w-0 flex-1 pr-14">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-emerald-400/80">
                          ひとこと
                        </p>
                        <p className="text-xs font-medium text-emerald-400/90">
                          {pinnedOriginal.authorName}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-snug text-zinc-100">
                          {pinnedOriginal.caption}
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {replies.length === 0 ? (
                    <p className="py-6 text-center text-sm text-zinc-500">
                      まだ返信がありません。最初の一言をどうぞ。
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {replies.map((r) => (
                        <li
                          key={r.id}
                          className="flex gap-3 rounded-2xl bg-zinc-800/40 px-3 py-2.5"
                        >
                          <img
                            src={
                              r.authorAvatar ||
                              'https://placehold.co/40x40/27272a/a1a1aa?text=?'
                            }
                            alt=""
                            className="h-9 w-9 shrink-0 rounded-full object-cover"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-emerald-400/90">
                              {r.authorName}
                            </p>
                            <p className="mt-0.5 whitespace-pre-wrap text-sm leading-snug text-zinc-200">
                              {r.content}
                            </p>
                            <p className="mt-1 text-[10px] text-zinc-500">
                              {new Date(r.createdAt).toLocaleString('ja-JP', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-zinc-800 bg-zinc-900/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {error ? (
                <p className="mb-2 text-xs text-red-400">{error}</p>
              ) : null}
              {!authUserId ? (
                <p className="text-center text-xs text-zinc-500">
                  返信するにはログインしてください
                </p>
              ) : (
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={(e) =>
                      setDraft(
                        e.target.value.slice(0, POST_REPLY_MAX_LENGTH),
                      )
                    }
                    placeholder="返信を入力…"
                    rows={2}
                    className="min-h-[44px] flex-1 resize-none rounded-xl border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                  />
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.94 }}
                    disabled={submitting || !draft.trim()}
                    onClick={() => void handleSubmit()}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/20 disabled:opacity-40"
                    aria-label="送信"
                  >
                    <Send className="h-5 w-5" />
                  </motion.button>
                </div>
              )}
              <p className="mt-1 text-right text-[10px] text-zinc-500">
                {draft.length}/{POST_REPLY_MAX_LENGTH}
              </p>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
