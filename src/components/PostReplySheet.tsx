import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Send,
  Pin,
  Heart,
  MessageSquareReply,
  Trash2,
} from 'lucide-react';
import {
  fetchPostReplies,
  fetchUserById,
  insertPostReply,
  toggleReplyLike,
} from '../lib/api';
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

type ReplyNode = PostReply & { children: ReplyNode[] };

function buildReplyTree(replies: PostReply[]): ReplyNode[] {
  const map = new Map<string, ReplyNode>();
  for (const r of replies) {
    map.set(r.id, { ...r, children: [] });
  }
  const roots: ReplyNode[] = [];
  for (const r of replies) {
    const node = map.get(r.id)!;
    if (r.parentId && map.has(r.parentId)) {
      map.get(r.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortByTime = (a: ReplyNode, b: ReplyNode) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  roots.sort(sortByTime);
  const sortTree = (n: ReplyNode) => {
    n.children.sort(sortByTime);
    n.children.forEach(sortTree);
  };
  roots.forEach(sortTree);
  return roots;
}

function formatReplyTime(iso: string) {
  return new Date(iso).toLocaleString('ja-JP', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ReplyThreadNode({
  node,
  depth,
  authUserId,
  replyingToId,
  onReply,
  onToggleLike,
  onDeleteReply,
}: {
  node: ReplyNode;
  depth: number;
  authUserId: string | null;
  replyingToId: string | null;
  onReply: (id: string, authorName: string) => void;
  onToggleLike: (reply: PostReply) => void;
  onDeleteReply: (reply: PostReply) => void;
}) {
  const indentLevel = Math.min(depth, 5);
  const isReplyTarget = replyingToId === node.id;

  return (
    <li
      className={
        indentLevel > 0
          ? 'mt-2 border-l-2 border-zinc-700/50 pl-3'
          : 'mt-2'
      }
    >
      <div
        className={`rounded-2xl px-3 py-2.5 transition-colors ${
          isReplyTarget
            ? 'bg-emerald-950/35 ring-1 ring-emerald-500/30'
            : 'bg-zinc-800/55'
        }`}
      >
        <div className="flex gap-2.5">
          <img
            src={
              node.authorAvatar ||
              'https://placehold.co/40x40/27272a/a1a1aa?text=?'
            }
            alt=""
            className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-zinc-700/80"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-xs font-semibold text-emerald-400/95">
                {node.authorName}
              </span>
              <span className="text-[10px] text-zinc-500">
                {formatReplyTime(node.createdAt)}
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-100">
              {node.content}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onReply(node.id, node.authorName);
                }}
                className="inline-flex items-center gap-1 rounded-full bg-zinc-900/80 px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
              >
                <MessageSquareReply className="h-3.5 w-3.5" />
                返信
              </button>
              <button
                type="button"
                disabled={!authUserId}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleLike(node);
                }}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  node.likedByMe
                    ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30'
                    : 'bg-zinc-900/80 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <Heart
                  className={`h-3.5 w-3.5 ${node.likedByMe ? 'fill-current' : ''}`}
                />
                {node.likeCount}
              </button>
              {authUserId && node.userId === authUserId ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteReply(node);
                  }}
                  className="inline-flex items-center gap-1 rounded-full bg-zinc-900/80 px-2.5 py-1 text-[11px] font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                  aria-label="削除"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  削除
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {node.children.length > 0 ? (
        <ul className="mt-1 space-y-0">
          {node.children.map((ch) => (
            <ReplyThreadNode
              key={ch.id}
              node={ch}
              depth={depth + 1}
              authUserId={authUserId}
              replyingToId={replyingToId}
              onReply={onReply}
              onToggleLike={onToggleLike}
              onDeleteReply={onDeleteReply}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
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
  const [replyingTo, setReplyingTo] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const loadReplies = useCallback(async (pid: string, uid: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPostReplies(pid, uid);
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
      setReplyingTo(null);
      return;
    }
    void loadReplies(postId, authUserId);
  }, [open, postId, authUserId, loadReplies]);

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
            parent_id?: string | null;
          };
          if (!row?.id) return;

          const u = await fetchUserById(row.user_id);
          const next: PostReply = {
            id: row.id,
            userId: row.user_id,
            parentId: row.parent_id ?? null,
            content: row.content,
            createdAt: row.created_at,
            authorName: u?.name ?? 'ユーザー',
            authorAvatar: u?.avatar ?? '',
            likeCount: 0,
            likedByMe: false,
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

  const handleDeleteReply = async (reply: PostReply) => {
    if (!postId || !authUserId || reply.userId !== authUserId) return;
    if (!window.confirm('本当に削除しますか？')) return;
    const { error } = await supabase
      .from('post_replies')
      .delete()
      .eq('id', reply.id);
    if (error) {
      setError(error.message);
      return;
    }
    await loadReplies(postId, authUserId);
    onReplyCreated?.(postId);
  };

  const handleToggleLike = async (reply: PostReply) => {
    if (!authUserId) return;
    try {
      const { liked } = await toggleReplyLike(reply.id, authUserId);
      setReplies((prev) =>
        prev.map((r) =>
          r.id === reply.id
            ? {
                ...r,
                likedByMe: liked,
                likeCount: Math.max(0, r.likeCount + (liked ? 1 : -1)),
              }
            : r,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'いいねの更新に失敗しました');
    }
  };

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
      await insertPostReply(
        postId,
        authUserId,
        text,
        replyingTo?.id ?? null,
      );
      setDraft('');
      setReplyingTo(null);
      await loadReplies(postId, authUserId);
      onReplyCreated?.(postId);
    } catch (e) {
      setError(e instanceof Error ? e.message : '送信に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  const showPinned =
    Boolean(pinnedOriginal?.caption?.trim()) && pinnedOriginal != null;

  const tree = buildReplyTree(replies);

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
            className="fixed bottom-0 left-0 right-0 z-[61] flex max-h-[82vh] flex-col rounded-t-3xl border border-zinc-700/80 bg-zinc-900 shadow-2xl"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-5 py-3">
              <h2
                id="reply-sheet-title"
                className="text-base font-semibold text-zinc-100"
              >
                スレッド
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
                      className="relative flex gap-3 rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/50 via-zinc-900/90 to-zinc-950 px-3 py-3 shadow-lg shadow-emerald-950/20"
                      aria-label="投稿者のメッセージ"
                    >
                      <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-200/95">
                        <Pin className="h-3 w-3" aria-hidden />
                        Pinned
                      </div>
                      <img
                        src={
                          pinnedOriginal.authorAvatar ||
                          'https://placehold.co/40x40/27272a/a1a1aa?text=?'
                        }
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-full object-cover ring-2 ring-emerald-500/35"
                      />
                      <div className="min-w-0 flex-1 pr-16">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-300/90">
                          Message from Author
                        </p>
                        <p className="text-[10px] font-medium text-zinc-500">
                          投稿者のひとこと
                        </p>
                        <p className="mt-1 text-xs font-semibold text-emerald-400/95">
                          {pinnedOriginal.authorName}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-50">
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
                    <ul className="space-y-1">
                      {tree.map((node) => (
                        <ReplyThreadNode
                          key={node.id}
                          node={node}
                          depth={0}
                          authUserId={authUserId}
                          replyingToId={replyingTo?.id ?? null}
                          onReply={(id, name) => setReplyingTo({ id, name })}
                          onToggleLike={handleToggleLike}
                          onDeleteReply={(r) => void handleDeleteReply(r)}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-zinc-800 bg-zinc-900/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {replyingTo ? (
                <div className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-zinc-800/80 px-3 py-2 text-xs text-zinc-300">
                  <span className="truncate">
                    <span className="text-zinc-500">返信先: </span>
                    <span className="font-medium text-emerald-400/90">
                      {replyingTo.name}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setReplyingTo(null)}
                    className="shrink-0 rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100"
                  >
                    キャンセル
                  </button>
                </div>
              ) : null}
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
                    placeholder={
                      replyingTo
                        ? `${replyingTo.name} へ返信…`
                        : 'メッセージを入力…'
                    }
                    rows={2}
                    className="min-h-[48px] flex-1 resize-none rounded-2xl border border-zinc-700 bg-zinc-800/80 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                  />
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.94 }}
                    disabled={submitting || !draft.trim()}
                    onClick={() => void handleSubmit()}
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/20 disabled:opacity-40"
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
