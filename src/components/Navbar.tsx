import { Bell, Plus, RotateCcw, Search, User as UserIcon } from 'lucide-react';

export interface NavbarProps {
  onOpenNotifications?: () => void;
  hasUnreadNotifications?: boolean;
  onOpenBoard?: () => void;
  onOpenTimeline?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  active?: 'timeline' | 'board';
  onOpenPost: () => void;
  /** When true, post button is visible but non-interactive (daily cap). */
  postDisabled?: boolean;
  onOpenProfile: () => void;
  profileAvatarUrl?: string;
  profileLabel?: string;
}

export default function Navbar({
  onOpenNotifications,
  hasUnreadNotifications = false,
  onOpenBoard,
  onOpenTimeline,
  onRefresh,
  refreshing = false,
  active = 'timeline',
  onOpenPost,
  postDisabled = false,
  onOpenProfile,
  profileAvatarUrl,
  profileLabel = 'マイプロフィール',
}: NavbarProps) {
  const iconTone =
    'text-zinc-500 hover:text-zinc-300 active:scale-90 transition-transform';
  const activeTone = 'text-emerald-500';

  return (
    <nav
      className="pointer-events-auto fixed bottom-0 left-0 right-0 z-50 w-full border-t border-zinc-800 bg-zinc-950/80 shadow-[0_-1px_0_0_rgba(24,24,27,0.65)] backdrop-blur-md"
      aria-label="メインナビゲーション"
    >
      <div className="grid h-16 w-full grid-cols-5 items-stretch pb-[env(safe-area-inset-bottom,0px)]">
        <button
          type="button"
          onClick={onOpenNotifications}
          disabled={!onOpenNotifications}
          className={`relative flex h-full w-full flex-col items-center justify-center ${iconTone} disabled:opacity-60 disabled:hover:text-zinc-500 disabled:active:scale-100`}
          aria-label="通知"
        >
          <Bell className={`h-6 w-6 ${active === 'timeline' ? activeTone : ''}`} strokeWidth={1.75} />
          {hasUnreadNotifications ? (
            <span
              className="absolute top-3 h-2 w-2 rounded-full bg-red-500 ring-2 ring-zinc-950"
              style={{ right: 'calc(50% - 10px)' }}
              aria-hidden
            />
          ) : null}
        </button>

        <button
          type="button"
          onClick={onRefresh}
          disabled={!onRefresh || refreshing}
          className={`flex h-full w-full flex-col items-center justify-center ${iconTone} disabled:opacity-60 disabled:hover:text-zinc-500 disabled:active:scale-100`}
          aria-label="更新"
          title="更新"
        >
          <RotateCcw
            className={`h-6 w-6 ${refreshing ? 'animate-spin' : ''}`}
            strokeWidth={1.75}
          />
        </button>

        <button
          type="button"
          onClick={onOpenPost}
          disabled={postDisabled}
          title={postDisabled ? '現在はシェアボタンを利用できません' : '曲をシェア'}
          className="flex h-full w-full flex-col items-center justify-center active:scale-90 transition-transform disabled:opacity-60 disabled:active:scale-100"
          aria-label="曲をシェア"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-emerald-400/45 bg-emerald-500 text-white shadow-lg shadow-emerald-500/25">
            <Plus className="h-6 w-6" strokeWidth={2.5} />
          </span>
        </button>

        <button
          type="button"
          onClick={active === 'board' ? onOpenTimeline : onOpenBoard}
          disabled={active === 'board' ? !onOpenTimeline : !onOpenBoard}
          className={`flex h-full w-full flex-col items-center justify-center ${
            active === 'board' ? activeTone : iconTone
          } disabled:opacity-60 disabled:hover:text-zinc-500 disabled:active:scale-100`}
          aria-label={active === 'board' ? 'タイムライン' : '募集ボード'}
          title={active === 'board' ? 'タイムライン' : '募集ボード'}
        >
          <Search className="h-6 w-6" strokeWidth={1.75} />
        </button>

        <button
          type="button"
          onClick={onOpenProfile}
          className={`flex h-full w-full flex-col items-center justify-center ${iconTone}`}
          aria-label={profileLabel}
        >
          <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-zinc-800 bg-zinc-900/70">
            {profileAvatarUrl?.trim() ? (
              <img src={profileAvatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <UserIcon className="h-6 w-6" strokeWidth={1.75} />
            )}
          </span>
        </button>
      </div>
    </nav>
  );
}
