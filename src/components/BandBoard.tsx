import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  Drum,
  Guitar,
  Mic,
  Music2,
  Piano,
  Search,
} from 'lucide-react';
import type { InstrumentType } from '../types';
import { fetchTimelineBandProjects } from '../lib/api';
import { supabase } from '../lib/supabase';
import Navbar from './Navbar';
import LoadingSpinner from './LoadingSpinner';

const INSTRUMENTS: InstrumentType[] = [
  'vocal',
  'guitar',
  'bass',
  'drum',
  'keyboard',
];

const INSTRUMENT_ICONS: Record<
  InstrumentType,
  ComponentType<{ className?: string }>
> = {
  vocal: Mic,
  guitar: Guitar,
  bass: Music2,
  drum: Drum,
  keyboard: Piano,
};

const INSTRUMENT_LABEL: Record<InstrumentType, string> = {
  vocal: 'Vo.',
  guitar: 'Gt.',
  bass: 'Ba.',
  drum: 'Dr.',
  keyboard: 'Key.',
};

type ApplicantPreview = { userId: string; name: string; avatarUrl: string };
type AuthorPreview = {
  userId: string;
  name: string;
  avatarUrl: string;
  profileSlug: string;
};

type BandBoardProps = {
  authUserId: string;
  hasUnreadNotifications?: boolean;
  onOpenNotifications?: () => void;
  onOpenProfile: () => void;
  onShareSong: () => void;
  onOpenTimeline: () => void;
  /** UUID or display_id slug — same contract as `Profile` routing in `App`. */
  onViewProfile: (profileSlug: string) => void;
};

function formatRelativeShort(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'たった今';
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  const d = Math.floor(h / 24);
  return `${d}日前`;
}

export default function BandBoard({
  authUserId,
  hasUnreadNotifications = false,
  onOpenNotifications,
  onOpenProfile,
  onShareSong,
  onOpenTimeline,
  onViewProfile,
}: BandBoardProps) {
  const [projects, setProjects] = useState<Awaited<
    ReturnType<typeof fetchTimelineBandProjects>
  >>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [activeInstrument, setActiveInstrument] = useState<InstrumentType | null>(
    null,
  );
  const [busyRoleId, setBusyRoleId] = useState<string | null>(null);
  const [authorsById, setAuthorsById] = useState<Record<string, AuthorPreview>>(
    {},
  );
  const [applicantsByRoleId, setApplicantsByRoleId] = useState<
    Record<string, ApplicantPreview[]>
  >({});
  const [applicantRoleModalOpen, setApplicantRoleModalOpen] = useState(false);
  const [applicantRoleModalRoleId, setApplicantRoleModalRoleId] = useState<
    string | null
  >(null);
  const [applicantRoleModalTitle, setApplicantRoleModalTitle] = useState('');
  const pressStartByRoleIdRef = useRef<Record<string, number>>({});

  const projectIdsRef = useRef<Set<string>>(new Set());

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchTimelineBandProjects();
      setProjects(rows);
      projectIdsRef.current = new Set(rows.map((p) => p.id));

      const ownerIds = [...new Set(rows.map((p) => p.owner_id).filter(Boolean))];
      if (ownerIds.length > 0) {
        const { data: ownersData, error: ownersError } = await supabase
          .from('users')
          .select('id, display_name, avatar_url, display_id')
          .in('id', ownerIds);
        if (ownersError) {
          console.error('[BandBoard] owners fetch', ownersError);
        } else {
          const next: Record<string, AuthorPreview> = {};
          for (const rAny of (ownersData ?? []) as any[]) {
            const id = String(rAny.id ?? '').trim();
            if (!id) continue;
            const name = String(rAny.display_name ?? '').trim() || 'ユーザー';
            const avatarUrl = String(rAny.avatar_url ?? '').trim();
            const displayId = String(rAny.display_id ?? '').trim();
            next[id] = {
              userId: id,
              name,
              avatarUrl,
              profileSlug: displayId || id,
            };
          }
          setAuthorsById(next);
        }
      } else {
        setAuthorsById({});
      }

      const roleIds = rows.flatMap((p) => p.roles.map((r) => r.id));
      if (roleIds.length === 0) {
        setApplicantsByRoleId({});
        return;
      }

      const { data, error } = await supabase
        .from('band_role_applicants')
        .select('role_id, user_id, users(id, display_name, avatar_url)')
        .in('role_id', roleIds);
      if (error) {
        console.error('[BandBoard] band_role_applicants fetch', error);
        return;
      }
      const map: Record<string, ApplicantPreview[]> = {};
      for (const rowAny of (data ?? []) as any[]) {
        const roleId = String(rowAny.role_id || '').trim();
        const userId = String(rowAny.user_id || '').trim();
        if (!roleId || !userId) continue;
        const u = rowAny.users as
          | { id: string; display_name: string | null; avatar_url: string | null }
          | null
          | undefined;
        const prev = map[roleId] ?? [];
        prev.push({
          userId,
          name: (u?.display_name ?? '').trim() || 'ユーザー',
          avatarUrl: u?.avatar_url ?? '',
        });
        map[roleId] = prev;
      }
      setApplicantsByRoleId(map);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const ch = supabase
      .channel('band-board-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'band_roles' },
        (payload) => {
          const row = payload.new as { project_id?: string } | undefined;
          const oldRow = payload.old as { project_id?: string } | undefined;
          const pid = row?.project_id ?? oldRow?.project_id;
          if (pid && projectIdsRef.current.has(pid)) void reload();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'band_projects' },
        () => void reload(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'band_role_applicants' },
        () => void reload(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [reload]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((p) => {
      if (activeInstrument) {
        if (!p.roles.some((r) => r.instrument_type === activeInstrument))
          return false;
      }
      if (!q) return true;
      const hay = `${p.band_name ?? ''} ${p.description ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [projects, query, activeInstrument]);

  const handleBandRoleClick = useCallback(
    async (
      projectId: string,
      ownerId: string,
      role: (typeof projects)[number]['roles'][number],
      e: MouseEvent<HTMLElement>,
    ) => {
      e.preventDefault();
      e.stopPropagation();
      if (!authUserId) return;
      if (ownerId === authUserId) return;

      const current = applicantsByRoleId[role.id] ?? [];
      const isMine = current.some((a) => a.userId === authUserId);

      setBusyRoleId(role.id);
      try {
        if (!isMine) {
          const { error } = await supabase
            .from('band_role_applicants')
            .insert({ role_id: role.id, user_id: authUserId });
          if (error) {
            console.error('[BandBoard] apply', error);
            window.alert(
              error.message ?? '応募に失敗しました。しばらくしてから再度お試しください。',
            );
            return;
          }
          setApplicantsByRoleId((prev) => {
            const cur = prev[role.id] ?? [];
            if (cur.some((x) => x.userId === authUserId)) return prev;
            return {
              ...prev,
              [role.id]: [
                { userId: authUserId, name: 'あなた', avatarUrl: '' },
                ...cur,
              ],
            };
          });
        } else {
          const { error } = await supabase
            .from('band_role_applicants')
            .delete()
            .eq('role_id', role.id)
            .eq('user_id', authUserId);
          if (error) {
            console.error('[BandBoard] unapply', error);
            window.alert(
              error.message ?? '取り消しに失敗しました。しばらくしてから再度お試しください。',
            );
            return;
          }
          setApplicantsByRoleId((prev) => {
            const cur = prev[role.id];
            if (!cur) return prev;
            return { ...prev, [role.id]: cur.filter((x) => x.userId !== authUserId) };
          });
        }
      } finally {
        setBusyRoleId(null);
      }
    },
    [authUserId, applicantsByRoleId],
  );

  const openApplicantProfile = useCallback(
    (e: MouseEvent, userId: string) => {
      e.preventDefault();
      e.stopPropagation();
      const id = userId.trim();
      if (!id) return;
      onViewProfile(id);
    },
    [onViewProfile],
  );

  const openAuthorProfile = useCallback(
    (e: MouseEvent, ownerId: string) => {
      e.preventDefault();
      e.stopPropagation();
      const author = authorsById[ownerId];
      onViewProfile(author?.profileSlug?.trim() ? author.profileSlug : ownerId);
    },
    [authorsById, onViewProfile],
  );

  const openRoleApplicantsModal = useCallback(
    (e: MouseEvent, roleId: string, title: string) => {
      e.preventDefault();
      e.stopPropagation();
      setApplicantRoleModalRoleId(roleId);
      setApplicantRoleModalTitle(title);
      setApplicantRoleModalOpen(true);
    },
    [],
  );

  const closeRoleApplicantsModal = useCallback(() => {
    setApplicantRoleModalOpen(false);
    setApplicantRoleModalRoleId(null);
    setApplicantRoleModalTitle('');
  }, []);

  const onRolePressStart = useCallback((roleId: string) => {
    pressStartByRoleIdRef.current[roleId] = Date.now();
  }, []);

  const onRolePressEnd = useCallback(
    (e: MouseEvent, roleId: string, title: string) => {
      const startedAt = pressStartByRoleIdRef.current[roleId] ?? 0;
      pressStartByRoleIdRef.current[roleId] = 0;
      if (!startedAt) return;
      const heldMs = Date.now() - startedAt;
      if (heldMs >= 450) {
        openRoleApplicantsModal(e, roleId, title);
      }
    },
    [openRoleApplicantsModal],
  );

  const mainContent: ReactNode = loading ? (
    <div className="flex min-h-[40vh] items-center justify-center">
      <LoadingSpinner label="読み込み中…" compact />
    </div>
  ) : filtered.length === 0 ? (
    <p className="rounded-2xl border border-dashed border-zinc-700/80 bg-zinc-900/30 px-4 py-10 text-center text-sm text-zinc-500">
      {projects.length === 0
        ? '24時間以内の募集はまだありません。'
        : '条件に一致する募集がありません。'}
    </p>
  ) : (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {filtered.map((p) => (
        <article
          key={p.id}
          className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 shadow-inner shadow-black/20"
        >
          <div className="flex items-start justify-between gap-3">
            <h3 className="min-w-0 flex-1 text-lg font-bold text-zinc-100">
              {p.band_name}
            </h3>
            <span className="shrink-0 text-[11px] text-zinc-500">
              {formatRelativeShort(p.created_at)}
            </span>
          </div>
          {p.description ? (
            <p className="mt-1.5 line-clamp-4 text-sm leading-relaxed text-zinc-400">
              {p.description}
            </p>
          ) : null}

          <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-amber-500/90">
            Wanted — 募集中パート
          </p>
          <div className="mt-2 flex flex-wrap gap-2.5">
            {p.roles.map((role) => {
              const Icon = INSTRUMENT_ICONS[role.instrument_type];
              const roleApplicants = applicantsByRoleId[role.id] ?? [];
              const isMine = roleApplicants.some((a) => a.userId === authUserId);
              const disabled = busyRoleId === role.id || p.owner_id === authUserId;
              return (
                <div
                  key={role.id}
                  role="button"
                  tabIndex={disabled ? -1 : 0}
                  aria-disabled={disabled}
                  onClick={(e) => {
                    if (disabled) return;
                    void handleBandRoleClick(p.id, p.owner_id, role, e);
                  }}
                  onKeyDown={(e) => {
                    if (disabled) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      void handleBandRoleClick(p.id, p.owner_id, role, e as unknown as MouseEvent<HTMLElement>);
                    }
                  }}
                  onMouseDown={() => onRolePressStart(role.id)}
                  onMouseUp={(e) =>
                    onRolePressEnd(
                      e,
                      role.id,
                      `${INSTRUMENT_LABEL[role.instrument_type]} 応募者`,
                    )
                  }
                  onTouchStart={() => onRolePressStart(role.id)}
                  onTouchEnd={(e) =>
                    onRolePressEnd(
                      e as unknown as MouseEvent,
                      role.id,
                      `${INSTRUMENT_LABEL[role.instrument_type]} 応募者`,
                    )
                  }
                  className={`group relative flex min-w-[4.5rem] flex-col items-center gap-1 rounded-xl border px-2.5 py-2.5 transition-all ${
                    p.owner_id === authUserId
                      ? 'cursor-default border-zinc-700/60 border-dashed bg-zinc-950/60 opacity-80'
                      : isMine
                        ? 'cursor-pointer border-emerald-500/35 bg-zinc-900/70'
                        : 'cursor-pointer border-amber-500/35 bg-amber-500/[0.07] hover:border-amber-400/55 hover:bg-amber-500/12 active:scale-[0.98]'
                  } ${disabled ? 'opacity-60' : ''}`}
                  title={INSTRUMENT_LABEL[role.instrument_type]}
                >
                  <button
                    type="button"
                    onClick={(e) =>
                      openRoleApplicantsModal(
                        e,
                        role.id,
                        `${INSTRUMENT_LABEL[role.instrument_type]} 応募者`,
                      )
                    }
                    className="relative flex h-[4.25rem] w-[4.25rem] items-center justify-center rounded-xl bg-zinc-950/80 ring-1 ring-inset ring-zinc-700/50"
                    aria-label="応募者一覧を表示"
                  >
                    <Icon
                      className={`h-6 w-6 ${
                        p.owner_id === authUserId
                          ? 'text-zinc-500'
                          : isMine
                            ? 'text-emerald-400/95'
                            : 'text-amber-400/90 group-hover:text-amber-300'
                      }`}
                    />
                  </button>
                  <div className="flex -space-x-2">
                    {roleApplicants.slice(0, 3).map((a) => (
                      <button
                        key={a.userId}
                        type="button"
                        onClick={(e) => openApplicantProfile(e, a.userId)}
                        className="relative z-10 rounded-full ring-2 ring-zinc-950"
                        aria-label={`${a.name}のプロフィール`}
                      >
                        <img
                          src={
                            a.avatarUrl?.trim()
                              ? a.avatarUrl
                              : 'https://placehold.co/32x32/27272a/a1a1aa?text=?'
                          }
                          alt=""
                          className="h-5 w-5 rounded-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                  <span className="text-[10px] font-medium text-zinc-500">
                    {p.owner_id === authUserId ? '募集中' : isMine ? '応募済み' : '応募'}
                    {roleApplicants.length > 0 ? ` · ${roleApplicants.length}` : ''}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between">
            <button
              type="button"
              onClick={(e) => openAuthorProfile(e, p.owner_id)}
              className="flex min-w-0 items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/30 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-900/60"
              aria-label="投稿者プロフィール"
            >
              <img
                src={
                  authorsById[p.owner_id]?.avatarUrl?.trim()
                    ? authorsById[p.owner_id].avatarUrl
                    : 'https://placehold.co/48x48/27272a/a1a1aa?text=?'
                }
                alt=""
                className="h-6 w-6 shrink-0 rounded-full object-cover"
              />
              <span className="min-w-0 truncate">
                {authorsById[p.owner_id]?.name ?? 'ユーザー'}
              </span>
            </button>
          </div>
        </article>
      ))}
    </div>
  );

  return (
    <div
      className="h-[100dvh] w-full overflow-y-auto bg-zinc-950 text-zinc-50"
      style={{ WebkitOverflowScrolling: 'touch' }}
    >
      <div className="sticky top-0 z-[80] border-b border-zinc-800 bg-zinc-950/90 px-4 pb-3 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] backdrop-blur-md">
        <div className="mx-auto w-full max-w-3xl">
          <div className="mb-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onOpenTimeline}
              className="text-sm font-semibold text-white/80 hover:text-white"
            >
              タイムライン
            </button>
            <div className="text-sm font-bold tracking-wide">募集ボード</div>
            <span className="w-16" aria-hidden />
          </div>

          <div className="flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="バンド名 / 説明で検索"
              className="w-full min-w-0 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 outline-none"
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setActiveInstrument(null)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                activeInstrument == null
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                  : 'border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              全部
            </button>
            {INSTRUMENTS.map((inst) => {
              const Icon = INSTRUMENT_ICONS[inst];
              const on = activeInstrument === inst;
              return (
                <button
                  key={inst}
                  type="button"
                  onClick={() =>
                    setActiveInstrument((prev) => (prev === inst ? null : inst))
                  }
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    on
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                      : 'border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {INSTRUMENT_LABEL[inst]}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-5xl px-4 pb-[calc(8rem+env(safe-area-inset-bottom,0px))] pt-4">
        {mainContent}
      </div>

      {applicantRoleModalOpen && applicantRoleModalRoleId ? (
        <div className="fixed inset-0 z-[140]">
          <button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={closeRoleApplicantsModal}
            aria-label="閉じる"
          />
          <div className="absolute inset-0 flex items-end justify-center p-4 sm:items-center">
            <div
              role="dialog"
              aria-modal
              aria-label={applicantRoleModalTitle || '応募者'}
              className="w-full max-w-md overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
                <div className="min-w-0 truncate text-sm font-semibold text-zinc-100">
                  {applicantRoleModalTitle || '応募者'}
                </div>
                <button
                  type="button"
                  onClick={closeRoleApplicantsModal}
                  className="rounded-full px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
                >
                  閉じる
                </button>
              </div>
              <div className="max-h-[70dvh] overflow-y-auto p-3">
                {(applicantsByRoleId[applicantRoleModalRoleId] ?? []).length === 0 ? (
                  <div className="px-2 py-6 text-center text-sm text-zinc-500">
                    No applicants yet
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {(applicantsByRoleId[applicantRoleModalRoleId] ?? []).map(
                      (a) => (
                        <button
                          key={a.userId}
                          type="button"
                          onClick={(e) => openApplicantProfile(e, a.userId)}
                          className="flex w-full items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/30 px-3 py-2 text-left hover:bg-zinc-800/60"
                        >
                          <img
                            src={
                              a.avatarUrl?.trim()
                                ? a.avatarUrl
                                : 'https://placehold.co/48x48/27272a/a1a1aa?text=?'
                            }
                            alt=""
                            className="h-9 w-9 rounded-full object-cover"
                          />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-zinc-100">
                              {a.name}
                            </div>
                          </div>
                        </button>
                      ),
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <Navbar
        onOpenNotifications={onOpenNotifications}
        hasUnreadNotifications={hasUnreadNotifications}
        onOpenPost={onShareSong}
        onOpenProfile={onOpenProfile}
        onOpenBoard={() => {}}
        onOpenTimeline={onOpenTimeline}
        active="board"
      />
    </div>
  );
}
