import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';

const DEBOUNCE_MS = 300;
const RESULT_LIMIT = 20;

export type UserSearchRow = {
  id: string;
  display_id: string | null;
  display_name: string;
  avatar_url: string | null;
};

type UserSearchProps = {
  /** Called with profile slug: `display_id` or user UUID for routing (same as `onViewProfile`). */
  onSelectUser: (profileSlug: string) => void;
  className?: string;
};

/** Strip characters that break `ilike` / URL filters; keeps normal text + Japanese. */
function sanitizeIlikeTerm(raw: string): string {
  return raw.replace(/%/g, '').replace(/,/g, ' ').trim();
}

function profileSlugFromRow(row: UserSearchRow): string {
  const handle = row.display_id?.trim();
  if (handle) return handle;
  return row.id;
}

export default function UserSearch({ onSelectUser, className = '' }: UserSearchProps) {
  const [inputValue, setInputValue] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [results, setResults] = useState<UserSearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedQuery(inputValue.trim());
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [inputValue]);

  const runSearch = useCallback(async (q: string) => {
    if (!q) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    const myId = ++reqIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const term = sanitizeIlikeTerm(q);
      if (!term) {
        setResults([]);
        setLoading(false);
        return;
      }
      const pattern = `%${term}%`;

      const [byHandle, byName] = await Promise.all([
        supabase
          .from('users')
          .select('id, display_id, display_name, avatar_url')
          .ilike('display_id', pattern)
          .limit(RESULT_LIMIT),
        supabase
          .from('users')
          .select('id, display_id, display_name, avatar_url')
          .ilike('display_name', pattern)
          .limit(RESULT_LIMIT),
      ]);

      if (reqIdRef.current !== myId) return;

      const errMsg = byHandle.error?.message ?? byName.error?.message;
      if (errMsg) {
        setResults([]);
        setError(errMsg);
        return;
      }

      const merged = new Map<string, UserSearchRow>();
      for (const row of [...(byHandle.data ?? []), ...(byName.data ?? [])]) {
        const r = row as UserSearchRow;
        merged.set(r.id, r);
      }
      const list = Array.from(merged.values())
        .sort((a, b) =>
          (a.display_name || '').localeCompare(b.display_name || '', 'ja'),
        )
        .slice(0, RESULT_LIMIT);

      setResults(list);
    } catch (e) {
      if (reqIdRef.current !== myId) return;
      setResults([]);
      setError(e instanceof Error ? e.message : '検索に失敗しました');
    } finally {
      if (reqIdRef.current === myId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void runSearch(debouncedQuery);
  }, [debouncedQuery, runSearch]);

  return (
    <div className={`rounded-2xl border border-zinc-800 bg-zinc-900/50 ${className}`}>
      <div className="flex items-center gap-2 border-b border-zinc-800/80 px-3 py-2.5">
        <Search className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
        <input
          type="search"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="ユーザー名・表示名で検索"
          autoComplete="off"
          className="w-full min-w-0 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 outline-none"
          aria-label="ユーザー検索"
        />
        {loading ? (
          <Loader2
            className="h-4 w-4 shrink-0 animate-spin text-emerald-400/90"
            aria-hidden
          />
        ) : null}
      </div>

      {error ? (
        <p className="px-3 py-2 text-xs text-red-400/90">{error}</p>
      ) : null}

      {debouncedQuery && !loading && results.length === 0 && !error ? (
        <p className="px-3 py-4 text-center text-sm text-zinc-500">
          該当するユーザーがいません
        </p>
      ) : null}

      {results.length > 0 ? (
        <ul className="max-h-[min(50vh,20rem)] overflow-y-auto py-1">
          {results.map((row) => {
            const slug = profileSlugFromRow(row);
            const handle = row.display_id?.trim();
            return (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => onSelectUser(slug)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-zinc-800/70 active:bg-zinc-800"
                >
                  <img
                    src={
                      row.avatar_url?.trim()
                        ? row.avatar_url
                        : 'https://placehold.co/40x40/27272a/a1a1aa?text=?'
                    }
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-zinc-700/80"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-zinc-50">
                      {row.display_name?.trim() || '名前未設定'}
                    </div>
                    <div className="truncate text-xs text-zinc-500">
                      {handle ? `@${handle}` : `ユーザー ID · ${row.id.slice(0, 8)}…`}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
