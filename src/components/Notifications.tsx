import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { ArrowLeft } from 'lucide-react';
import {
  fetchNotificationsForUser,
  fetchUserById,
  markAllNotificationsReadForUser,
} from '../lib/api';
import type { AppNotification, NotificationKind, User } from '../types';

function formatTimeAgoJa(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const sec = Math.round((Date.now() - t) / 1000);
  const rtf = new Intl.RelativeTimeFormat('ja', { numeric: 'auto' });
  if (Math.abs(sec) < 60) return rtf.format(-Math.max(1, sec), 'second');
  const min = Math.round(sec / 60);
  if (Math.abs(min) < 60) return rtf.format(-min, 'minute');
  const h = Math.round(min / 60);
  if (Math.abs(h) < 24) return rtf.format(-h, 'hour');
  const d = Math.round(h / 24);
  if (Math.abs(d) < 30) return rtf.format(-d, 'day');
  const mo = Math.round(d / 30);
  if (Math.abs(mo) < 12) return rtf.format(-mo, 'month');
  const y = Math.round(mo / 12);
  return rtf.format(-y, 'year');
}

function messageForType(
  displayName: string,
  type: NotificationKind,
): string {
  const name = displayName.trim() || 'ユーザー';
  switch (type) {
    case 'reaction':
      return `${name}さんがあなたの投稿にリアクションしました`;
    case 'reply':
      return `${name}さんがあなたの投稿に返信しました`;
    case 'like':
      return `${name}さんがあなたの返信にいいねしました`;
    default:
      return `${name}さんから通知があります`;
  }
}

interface NotificationsProps {
  userId: string;
  onBack: () => void;
  onOpenPost: (postId: string) => void;
  onUnreadCleared: () => void;
}

export default function Notifications({
  userId,
  onBack,
  onOpenPost,
  onUnreadCleared,
}: NotificationsProps) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [actorsById, setActorsById] = useState<Record<string, User | null>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await markAllNotificationsReadForUser(userId);
      onUnreadCleared();
      const rows = await fetchNotificationsForUser(userId);
      setItems(rows);
      const actorIds = [...new Set(rows.map((r) => r.actorId))];
      const entries = await Promise.all(
        actorIds.map(async (id) => [id, await fetchUserById(id)] as const),
      );
      setActorsById(Object.fromEntries(entries));
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [userId, onUnreadCleared]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleBack = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      onBack();
    },
    [onBack],
  );

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[120] flex min-h-0 flex-col bg-zinc-950 text-zinc-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notifications-title"
    >
      {/* Single scroll region so the header stays sticky while the list scrolls */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]">
        <header className="sticky top-0 z-10 shrink-0 border-b border-zinc-800 bg-zinc-900/95 shadow-sm backdrop-blur-md">
          <div className="flex items-center gap-2 px-3 pb-3 pt-[max(env(safe-area-inset-top),0.75rem)] sm:px-4">
            <button
              type="button"
              onClick={handleBack}
              className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-1.5 rounded-full text-zinc-200 transition-colors hover:bg-zinc-800/90 active:bg-zinc-800"
              aria-label="タイムラインに戻る"
            >
              <ArrowLeft className="h-6 w-6 shrink-0" strokeWidth={2} />
              <span className="text-sm font-medium">戻る</span>
            </button>
            <h1
              id="notifications-title"
              className="min-w-0 flex-1 text-center text-lg font-semibold tracking-tight text-zinc-50"
            >
              通知
            </h1>
            <span
              className="inline-flex w-[44px] shrink-0 sm:w-[52px]"
              aria-hidden
            />
          </div>
        </header>

        <div className="min-h-0 flex-1 px-4 py-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {loading ? (
            <p className="text-sm text-zinc-500">読み込み中…</p>
          ) : null}
          {error ? (
            <p className="text-sm text-red-400">{error}</p>
          ) : null}
          {!loading && !error && items.length === 0 ? (
            <p className="text-sm text-zinc-500">通知はありません</p>
          ) : null}

          <ul className="space-y-2">
            {items.map((n) => {
              const actor = actorsById[n.actorId];
              const avatar =
                actor?.avatar?.trim() ||
                'https://placehold.co/48x48/27272a/a1a1aa?text=?';
              const label = actor?.name?.trim() || 'ユーザー';
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onOpenPost(n.postId)}
                    className="flex w-full gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900/80"
                  >
                    <img
                      src={avatar}
                      alt=""
                      className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-zinc-700/80"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug text-zinc-100">
                        {messageForType(label, n.type)}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {formatTimeAgoJa(n.createdAt)}
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
