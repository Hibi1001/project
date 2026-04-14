import { useCallback, useEffect, useState } from 'react';
import LoadingSpinner from './LoadingSpinner';
import {
  fetchApplicantsForRole,
  removeApplicantFromProjectRole,
  updateApplicantStatus,
  type RoleApplicantRow,
} from '../lib/profileBandRecruitment';

type ApplicantListProps = {
  roleId: string;
  isOpen: boolean;
  mode?: 'manage' | 'view';
  onViewProfile?: (profileSlug: string) => void;
  onClose?: () => void;
};

export default function ApplicantList({
  roleId,
  isOpen,
  mode = 'view',
  onViewProfile,
  onClose,
}: ApplicantListProps) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<RoleApplicantRow[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApplicantsForRole(roleId);
      setRows(data);
    } catch (e) {
      console.error('[ApplicantList] load', e);
      setError('応募一覧の取得に失敗しました。');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [roleId, isOpen]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAccept = useCallback(async (row: RoleApplicantRow) => {
    const key = `${row.roleId}:${row.userId}:accept`;
    setBusyKey(key);
    setError(null);
    try {
      const ok = await updateApplicantStatus(row.roleId, row.userId, 'accepted');
      if (!ok) {
        setError('承認に失敗しました。');
        return;
      }
      setRows((prev) =>
        prev.map((x) =>
          x.roleId === row.roleId && x.userId === row.userId
            ? { ...x, status: 'accepted' }
            : x,
        ),
      );
    } catch (e) {
      console.error('[ApplicantList] accept', e);
      setError('承認に失敗しました。');
    } finally {
      setBusyKey(null);
    }
  }, []);

  const handleDecline = useCallback(async (row: RoleApplicantRow) => {
    const key = `${row.roleId}:${row.userId}:decline`;
    setBusyKey(key);
    setError(null);
    try {
      const ok = await removeApplicantFromProjectRole(row.roleId, row.userId);
      if (!ok) {
        setError('辞退処理に失敗しました。');
        return;
      }
      setRows((prev) =>
        prev.filter((x) => !(x.roleId === row.roleId && x.userId === row.userId)),
      );
    } catch (e) {
      console.error('[ApplicantList] decline', e);
      setError('辞退処理に失敗しました。');
    } finally {
      setBusyKey(null);
    }
  }, []);

  const handleOpenProfile = useCallback(
    (userId: string) => {
      const id = userId.trim();
      if (!id) return;
      if (onViewProfile) {
        onViewProfile(id);
        return;
      }
      if (typeof window === 'undefined') return;
      window.history.pushState(null, '', `/user/${encodeURIComponent(id)}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
    [onViewProfile],
  );

  if (!isOpen) return null;

  return (
    <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Applicants
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
            className="rounded-md border border-zinc-700 px-2 py-1 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-800"
          >
            Close
          </button>
        ) : null}
      </div>
      {loading ? (
        <div className="py-4">
          <LoadingSpinner compact label="応募者を読み込み中…" />
        </div>
      ) : error ? (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-700/70 px-3 py-5 text-center text-sm text-zinc-500">
          No applicants yet
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const acceptKey = `${row.roleId}:${row.userId}:accept`;
            const declineKey = `${row.roleId}:${row.userId}:decline`;
            const accepting = busyKey === acceptKey;
            const declining = busyKey === declineKey;
            const rowKey = `${row.roleId}:${row.userId || 'unknown-user'}`;
            return (
              <div
                key={rowKey}
                className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2"
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleOpenProfile(row.userId);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left hover:bg-zinc-800/50"
                >
                  <img
                    src={
                      row.avatarUrl?.trim()
                        ? row.avatarUrl
                        : 'https://placehold.co/48x48/27272a/a1a1aa?text=?'
                    }
                    alt=""
                    className="h-9 w-9 rounded-full object-cover"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-100">
                      {row.displayName}
                    </p>
                  </div>
                </button>
                {row.status === 'accepted' ? (
                  <span
                    className="h-2.5 w-2.5 rounded-full bg-emerald-400"
                    title="Accepted"
                  />
                ) : null}
                {mode === 'manage' ? (
                  <>
                    <button
                      type="button"
                      disabled={accepting || declining || row.status === 'accepted'}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void handleAccept(row);
                      }}
                      className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {row.status === 'accepted' ? 'Accepted' : accepting ? '...' : 'Accept'}
                    </button>
                    <button
                      type="button"
                      disabled={accepting || declining}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void handleDecline(row);
                      }}
                      className="rounded-lg border border-zinc-600 px-2.5 py-1 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                    >
                      {declining ? '...' : 'Decline'}
                    </button>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
