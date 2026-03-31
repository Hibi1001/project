import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '../lib/supabase';

type LikedByUser = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  grade: string | null;
};

type LikedByRow = {
  user_id: string;
  users?: LikedByUser | null;
  user?: LikedByUser | null;
};

export interface LikedByModalProps {
  postId: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function LikedByModal({ postId, isOpen, onClose }: LikedByModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<LikedByRow[]>([]);

  const users = useMemo(() => {
    const list: LikedByUser[] = [];
    for (const r of rows) {
      const u = r.users ?? r.user ?? null;
      if (u?.id) list.push(u);
    }
    return list;
  }, [rows]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const pid = postId.trim();
    if (!pid) return;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        // Preferred form (matches request). May require FK embedding support.
        let { data, error } = await supabase
          .from('post_likes')
          .select('user_id, users(id, display_name, avatar_url, grade)')
          .eq('post_id', pid)
          .order('created_at', { ascending: false });

        if (error) {
          // Fallback: alias embed to improve compatibility across FK naming.
          const retry = await supabase
            .from('post_likes')
            .select('user_id, user:users(id, display_name, avatar_url, grade)')
            .eq('post_id', pid)
            .order('created_at', { ascending: false });
          data = retry.data;
          error = retry.error;
        }

        if (cancelled) return;
        if (error) {
          setError(error.message);
          setRows([]);
          return;
        }
        setRows((data ?? []) as unknown as LikedByRow[]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '読み込みに失敗しました');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, postId]);

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
        role="presentation"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="w-full max-w-sm overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-label="いいねした人"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-zinc-100">いいねした人</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-50"
              aria-label="閉じる"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="max-h-[60dvh] overflow-y-auto p-3">
            {loading ? (
              <p className="px-2 py-6 text-center text-sm text-zinc-500">
                読み込み中…
              </p>
            ) : error ? (
              <p className="rounded-xl bg-red-400/10 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            ) : users.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-zinc-500">
                まだありません
              </p>
            ) : (
              <ul className="space-y-1">
                {users.map((u) => (
                  <li
                    key={u.id}
                    className="flex items-center gap-3 rounded-xl bg-zinc-950/50 px-3 py-2"
                  >
                    <img
                      src={u.avatar_url || 'https://placehold.co/64x64?text=U'}
                      alt=""
                      className="h-9 w-9 rounded-full object-cover ring-1 ring-zinc-700/80"
                      loading="lazy"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-200">
                        {u.display_name?.trim() ? u.display_name.trim() : 'ユーザー'}
                      </p>
                      {u.grade?.trim() ? (
                        <p className="text-xs text-zinc-500">{u.grade.trim()}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

