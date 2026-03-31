import { Bell, Plus, User as UserIcon } from 'lucide-react';

export interface NavbarProps {
  onOpenNotifications?: () => void;
  hasUnreadNotifications?: boolean;
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
  onOpenPost,
  postDisabled = false,
  onOpenProfile,
  profileAvatarUrl,
  profileLabel = 'マイプロフィール',
}: NavbarProps) {
  return (
    <nav
      className="pointer-events-auto fixed bottom-0 left-0 right-0 z-50 w-full border-t border-zinc-800 bg-zinc-950 shadow-[0_-1px_0_0_rgba(24,24,27,0.65)]"
      aria-label="メインナビゲーション"
      style={{
        paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)',
      }}
    >
      <div className="mx-auto flex min-h-0 max-w-lg items-center justify-between gap-3 px-4 py-3">
        <div className="flex w-11 shrink-0 justify-start">
          {onOpenNotifications ? (
            <button
              type="button"
              onClick={onOpenNotifications}
              className="relative flex h-11 w-11 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/90 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
              aria-label="通知"
            >
              <Bell className="h-5 w-5" strokeWidth={1.75} />
              {hasUnreadNotifications ? (
                <span
                  className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500 ring-2 ring-zinc-950"
                  aria-hidden
                />
              ) : null}
            </button>
          ) : (
            <span className="h-11 w-11 shrink-0" aria-hidden />
          )}
        </div>

        <div className="flex flex-1 justify-center">
          <button
            type="button"
            onClick={onOpenPost}
            disabled={postDisabled}
            title={
              postDisabled
                ? '本日のシェア上限に達しています'
                : '曲をシェア'
            }
            className={`flex h-11 w-11 items-center justify-center rounded-full border-2 border-emerald-400/40 bg-emerald-500 text-white shadow-md shadow-emerald-500/20 transition-transform hover:border-emerald-300/50 hover:bg-emerald-400 active:scale-[0.97] disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:shadow-none`}
            aria-label="曲をシェア"
          >
            <Plus className="h-5 w-5" strokeWidth={2.5} />
          </button>
        </div>

        <div className="flex w-11 shrink-0 justify-end">
          <button
            type="button"
            onClick={onOpenProfile}
            className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-800 bg-zinc-900/90 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            aria-label={profileLabel}
          >
            {profileAvatarUrl?.trim() ? (
              <img
                src={profileAvatarUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <UserIcon className="h-5 w-5" strokeWidth={1.75} />
            )}
          </button>
        </div>
      </div>
    </nav>
  );
}
