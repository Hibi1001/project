import { AnimatePresence, motion } from 'framer-motion';
import {
  Drum,
  Guitar,
  Mic,
  Music2,
  Piano,
  Plus,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
} from 'react';
import type { DbBandRole, InstrumentType } from '../types';
import { fetchUserById } from '../lib/api';
import {
  createBandProjectWithRoles,
  fetchBandProjectsForOwner,
  type ApplicantPreview,
  type BandProjectWithRoles,
} from '../lib/profileBandRecruitment';
import { supabase } from '../lib/supabase';

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

type Props = {
  ownerUserId: string;
  isOwnProfile: boolean;
  authUserId: string | null;
};

export default function ProfileBandRecruitment({
  ownerUserId,
  isOwnProfile,
  authUserId,
}: Props) {
  const [projects, setProjects] = useState<BandProjectWithRoles[]>([]);
  const [applicantsByRoleId, setApplicantsByRoleId] = useState<
    Record<string, ApplicantPreview[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [bandName, setBandName] = useState('');
  const [bandDesc, setBandDesc] = useState('');
  const [picked, setPicked] = useState<Set<InstrumentType>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [claimBusyId, setClaimBusyId] = useState<string | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const projectIdsRef = useRef<Set<string>>(new Set());

  const reload = useCallback(async () => {
    const { projects: p, applicantsByRoleId: ar } =
      await fetchBandProjectsForOwner(ownerUserId);
    setProjects(p);
    setApplicantsByRoleId(ar);
    projectIdsRef.current = new Set(p.map((x) => x.id));
  }, [ownerUserId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await reload();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  useEffect(() => {
    const ch = supabase
      .channel(`profile-band-realtime-${ownerUserId}`)
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
        (payload) => {
          const n = payload.new as { owner_id?: string } | undefined;
          const o = payload.old as { owner_id?: string } | undefined;
          const oid = n?.owner_id ?? o?.owner_id;
          if (oid === ownerUserId) void reload();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'band_role_applicants' },
        () => {
          void reload();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(ch);
    };
  }, [ownerUserId, reload]);

  const openCreate = () => {
    setFormError(null);
    setBandName('');
    setBandDesc('');
    setPicked(new Set());
    setCreateOpen(true);
  };

  const togglePick = (i: InstrumentType) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUserId || authUserId !== ownerUserId) return;
    setSubmitting(true);
    setFormError(null);
    const { error } = await createBandProjectWithRoles({
      ownerId: authUserId,
      name: bandName,
      description: bandDesc,
      instruments: [...picked],
    });
    setSubmitting(false);
    if (error) {
      setFormError(error);
      return;
    }
    setCreateOpen(false);
    await reload();
  };

  const handleDeleteProject = async (
    proj: BandProjectWithRoles,
    e: MouseEvent<HTMLButtonElement>,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm('この募集を本当に削除しますか？')) return;
    setDeleteBusyId(proj.id);
    const { error } = await supabase
      .from('band_projects')
      .delete()
      .eq('id', proj.id);
    setDeleteBusyId(null);
    if (error) {
      console.error(error);
      setToast('削除に失敗しました。');
      return;
    }
    setProjects((prev) => prev.filter((p) => p.id !== proj.id));
    projectIdsRef.current.delete(proj.id);
  };

  const handleBandRoleClick = async (
    proj: BandProjectWithRoles,
    role: DbBandRole,
    e: MouseEvent<HTMLButtonElement>,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!authUserId) {
      setToast('ログインするとパートに応募できます。');
      return;
    }
    if (proj.owner_id === authUserId) {
      window.alert(
        '自分の募集には立候補できません（テスト時は別アカウントをご利用ください）',
      );
      return;
    }
    const list = applicantsByRoleId[role.id] ?? [];
    const isMine = list.some((a) => a.id === authUserId);

    setClaimBusyId(role.id);
    try {
      if (!isMine) {
        const { error } = await supabase
          .from('band_role_applicants')
          .insert({ role_id: role.id, user_id: authUserId });
        if (error) {
          console.error(error);
          setToast(error.message ?? '応募に失敗しました。');
          return;
        }
        const me = await fetchUserById(authUserId);
        if (me) {
          setApplicantsByRoleId((prev) => {
            const cur = prev[role.id] ?? [];
            if (cur.some((x) => x.id === me.id)) return prev;
            return { ...prev, [role.id]: [{ id: me.id, name: me.name, avatar: me.avatar }, ...cur] };
          });
        } else {
          setApplicantsByRoleId((prev) => {
            const cur = prev[role.id] ?? [];
            if (cur.some((x) => x.id === authUserId)) return prev;
            return { ...prev, [role.id]: [{ id: authUserId, name: 'ユーザー', avatar: '' }, ...cur] };
          });
        }
      } else {
        const { error } = await supabase
          .from('band_role_applicants')
          .delete()
          .eq('role_id', role.id)
          .eq('user_id', authUserId);
        if (error) {
          console.error(error);
          setToast(error.message ?? '取り消しに失敗しました。');
          return;
        }
        setApplicantsByRoleId((prev) => {
          const cur = prev[role.id];
          if (!cur) return prev;
          const next = cur.filter((x) => x.id !== authUserId);
          return { ...prev, [role.id]: next };
        });
      }
    } finally {
      setClaimBusyId(null);
    }
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="mb-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-400">
          <UserPlus className="h-4 w-4 text-emerald-500/80" />
          バンド募集
        </h3>
        {isOwnProfile ? (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition-colors hover:border-emerald-400/50 hover:bg-emerald-500/15"
          >
            <Plus className="h-3.5 w-3.5" />
            募集を作成
          </button>
        ) : null}
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">読み込み中…</p>
      ) : projects.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-700/80 bg-zinc-900/30 px-4 py-6 text-center text-sm text-zinc-500">
          {isOwnProfile
            ? '「募集を作成」からバンド名・説明・募集パートを登録できます。'
            : 'まだバンド募集の投稿はありません。'}
        </p>
      ) : (
        <div className="space-y-4">
          {projects.map((proj) => (
            <motion.article
              key={proj.id}
              layout
              className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 shadow-inner shadow-black/20"
            >
              <div className="flex items-start justify-between gap-3">
                <h4 className="min-w-0 flex-1 text-lg font-bold text-zinc-100">
                  {proj.band_name}
                </h4>
                {authUserId && proj.owner_id === authUserId ? (
                  <button
                    type="button"
                    disabled={deleteBusyId === proj.id}
                    onClick={(e) => void handleDeleteProject(proj, e)}
                    className="shrink-0 rounded-lg border border-zinc-700/80 bg-zinc-800/60 p-2 text-zinc-400 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
                    aria-label="募集を削除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
              {proj.description ? (
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
                  {proj.description}
                </p>
              ) : null}
              <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-amber-500/90">
                Wanted — 募集中パート
              </p>
              <div className="mt-2 flex flex-wrap gap-2.5">
                {proj.roles.map((role) => {
                  const Icon = INSTRUMENT_ICONS[role.instrument_type];
                  const isOwner =
                    Boolean(authUserId) && proj.owner_id === authUserId;
                  const roleApplicants = applicantsByRoleId[role.id] ?? [];
                  const isMine = Boolean(authUserId) && roleApplicants.some((a) => a.id === authUserId);
                  const disabled = claimBusyId === role.id || isOwner;

                  return (
                    <button
                      key={role.id}
                      type="button"
                      disabled={disabled}
                      onClick={(e) => void handleBandRoleClick(proj, role, e)}
                      className={`group relative flex min-w-[4.5rem] flex-col items-center gap-1 rounded-xl border px-2.5 py-2.5 transition-all ${
                        isOwner
                          ? 'cursor-default border-zinc-700/60 border-dashed bg-zinc-950/60 opacity-80'
                          : isMine
                            ? 'cursor-pointer border-emerald-500/35 bg-zinc-900/70'
                            : 'cursor-pointer border-amber-500/35 bg-amber-500/[0.07] hover:border-amber-400/55 hover:bg-amber-500/12 active:scale-[0.98]'
                      } disabled:opacity-50`}
                      title={
                        isOwner
                          ? '自分の募集'
                          : authUserId
                            ? isMine
                              ? 'タップで応募を取り消す'
                              : 'このパートで参加したい（タップ）'
                            : 'タップでログインの案内'
                      }
                    >
                      <div
                        className="relative flex h-[4.25rem] w-[4.25rem] items-center justify-center rounded-xl bg-zinc-950/80 ring-1 ring-inset ring-zinc-700/50"
                      >
                        <Icon
                          className={`h-6 w-6 ${
                            isOwner
                              ? 'text-zinc-500'
                              : isMine
                                ? 'text-emerald-400/95'
                                : 'text-amber-400/90 group-hover:text-amber-300'
                          }`}
                        />
                      </div>
                      <div className="flex -space-x-2">
                        {roleApplicants.slice(0, 3).map((a) => (
                          <img
                            key={a.id}
                            src={
                              a.avatar?.trim()
                                ? a.avatar
                                : 'https://placehold.co/32x32/27272a/a1a1aa?text=?'
                            }
                            alt=""
                            className="h-5 w-5 rounded-full object-cover ring-2 ring-zinc-950"
                          />
                        ))}
                      </div>
                      <span className="text-[10px] font-medium text-zinc-500">
                        {isOwner ? '募集中' : isMine ? '応募済み' : '応募'}
                        {roleApplicants.length > 0 ? ` · ${roleApplicants.length}` : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            </motion.article>
          ))}
        </div>
      )}

      <AnimatePresence>
        {createOpen ? (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm"
              onClick={() => !submitting && setCreateOpen(false)}
              aria-hidden
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="fixed inset-0 z-[60] flex items-end justify-center p-4 sm:items-center"
            >
              <div
                role="dialog"
                aria-modal
                aria-labelledby="band-create-title"
                className="max-h-[90dvh] w-full max-w-md overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
                  <h2
                    id="band-create-title"
                    className="text-base font-semibold text-zinc-50"
                  >
                    バンド募集を作成
                  </h2>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => setCreateOpen(false)}
                    className="rounded-full p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                    aria-label="閉じる"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <form onSubmit={handleCreate} className="space-y-4 overflow-y-auto p-4">
                  {formError ? (
                    <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
                      {formError}
                    </p>
                  ) : null}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-400">
                      バンド / プロジェクト名
                    </label>
                    <input
                      value={bandName}
                      onChange={(e) => setBandName(e.target.value)}
                      className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                      placeholder="例: 週末セッション"
                      maxLength={120}
                      disabled={submitting}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-400">
                      説明（任意）
                    </label>
                    <textarea
                      value={bandDesc}
                      onChange={(e) => setBandDesc(e.target.value)}
                      rows={3}
                      className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                      placeholder="何月のライブでやりたい！この曲をやりたい！等々..."
                      maxLength={500}
                      disabled={submitting}
                    />
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium text-zinc-400">
                      募集パート（複数選択）
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {INSTRUMENTS.map((inst) => {
                        const Icon = INSTRUMENT_ICONS[inst];
                        const on = picked.has(inst);
                        return (
                          <button
                            key={inst}
                            type="button"
                            disabled={submitting}
                            onClick={() => togglePick(inst)}
                            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                              on
                                ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200'
                                : 'border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:border-zinc-600'
                            }`}
                          >
                            <Icon className="h-4 w-4" />
                            {INSTRUMENT_LABEL[inst]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={submitting || picked.size === 0}
                    className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {submitting ? '作成中…' : '募集を公開'}
                  </button>
                </form>
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>

      {toast ? (
        <div className="fixed bottom-24 left-1/2 z-[70] max-w-sm -translate-x-1/2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-center text-sm text-zinc-200 shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
