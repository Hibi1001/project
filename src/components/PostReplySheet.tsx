import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send } from 'lucide-react';
import { fetchPostReplies, fetchUserById, insertPostReply } from '../lib/api';
import { supabase } from '../lib/supabase';
import type { PostReply } from '../types';
import { POST_REPLY_MAX_LENGTH } from '../types';

interface PostReplySheetProps {
  postId: string | null;
  open: boolean;
  onClose: () => void;
  authUserId: string | null;
  /** Called after a new reply (local or realtime) so the parent can refresh counts. */
  onReplyCreated?: (postId: string) => void;
}

export default function PostReplySheet({
  postId,
  open,
  onClose,
  authUserId,
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
              ) : replies.length === 0 ? (
                <p className="py-8 text-center text-sm text-zinc-500">
                  まだ返信がありません。最初の一言をどうぞ。
                </p>
              ) : (
                <ul className="space-y-3 pb-2">
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
