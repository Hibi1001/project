import { AnimatePresence, motion } from 'framer-motion';
import { Music, Lock, Plus } from 'lucide-react';
import { DAILY_POST_LIMIT } from '../constants/posting';

interface LockScreenProps {
  /** Primary action: App = go to timeline; Timeline (can post) = open share modal. */
  onUnlock: () => void;
  /** True when share is blocked (e.g. 12h cooldown since last post). */
  shareSongDisabled?: boolean;
  /** e.g. cooldown countdown or daily-cap message from parent. */
  shareCooldownText?: string;
  /**
   * Optional override for the main CTA when `shareSongDisabled` (e.g. Timeline bypass).
   * If omitted, `onUnlock` is used (e.g. App lock → `handleUnlock`).
   */
  onViewTimelineWhenCooldown?: () => void;
  /** Posts already shared today (calendar day). */
  dailyPostCount?: number;
  /** Defaults to `DAILY_POST_LIMIT`. */
  dailyPostLimit?: number;
}

export default function LockScreen({
  onUnlock,
  shareSongDisabled = false,
  shareCooldownText = '',
  onViewTimelineWhenCooldown,
  dailyPostCount = 0,
  dailyPostLimit = DAILY_POST_LIMIT,
}: LockScreenProps) {
  const showCooldownMain = shareSongDisabled;
  const onCooldownMainClick =
    onViewTimelineWhenCooldown ?? onUnlock;
  const remaining = Math.max(0, dailyPostLimit - dailyPostCount);

  return (
    <div className="fixed inset-0 bg-zinc-950 flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black opacity-90" />

      <div
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage:
            'url(https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=1200)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(20px)',
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 max-w-md mx-auto px-6 text-center"
      >
        <motion.div
          animate={{
            scale: [1, 1.1, 1],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          className="mb-8 flex justify-center"
        >
          <div className="relative">
            <Lock className="w-20 h-20 text-zinc-600" />
            <Music className="w-10 h-10 text-emerald-400 absolute -bottom-2 -right-2" />
          </div>
        </motion.div>

        <h1 className="text-3xl font-bold text-zinc-50 mb-4">
          今日の音楽を<br />シェアしよう
        </h1>

        <p className="text-zinc-400 mb-2 text-sm leading-relaxed">
          1日最大{dailyPostLimit}曲までシェアできます。
          <span className="mt-1 block font-medium text-zinc-300 tabular-nums">
            本日 {dailyPostCount}/{dailyPostLimit} 曲シェア済み
          </span>
        </p>

        <p className="text-zinc-500 mb-6 text-xs leading-relaxed">
          Daily limit: {dailyPostLimit} songs. You have {remaining}{' '}
          {remaining === 1 ? 'share' : 'shares'} left for today.
        </p>

        {showCooldownMain ? (
          <p className="text-xs text-zinc-500 mb-4 text-left leading-relaxed">
            直近のシェアから12時間は次の投稿ができません。それまでタイムラインだけ閲覧できます。
            {remaining > 0 ? (
              <span className="mt-2 block text-zinc-400">
                ※ 本日の残り枠はあと {remaining} 回です（12時間経過後に利用できます）。
              </span>
            ) : null}
          </p>
        ) : null}

        <div className="w-full">
          <AnimatePresence mode="wait" initial={false}>
            {showCooldownMain ? (
              <motion.div
                key="timeline-view"
                layout
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                className="w-full"
              >
                <motion.button
                  type="button"
                  layout
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => onCooldownMainClick()}
                  className="w-full rounded-full border border-zinc-600/80 bg-zinc-800/40 backdrop-blur-md text-zinc-100 font-semibold py-4 px-8 shadow-inner shadow-black/20 hover:bg-zinc-800/60 hover:border-zinc-500/70 transition-colors"
                >
                  <span className="block text-base leading-snug">
                    タイムラインを見る
                  </span>
                  <span className="block text-xs font-normal text-zinc-400 mt-1">
                    みんなの音楽をチェック
                  </span>
                </motion.button>
                {shareCooldownText ? (
                  <p className="text-sm text-amber-300/95 font-medium mt-3 tabular-nums leading-snug">
                    {shareCooldownText}
                  </p>
                ) : null}
                <p className="text-xs text-zinc-500 mt-2 leading-relaxed">
                  次のシェアは上の案内に従って、ロック画面の「曲をシェア」からどうぞ
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="share-unlock"
                layout
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                className="w-full"
              >
                <motion.button
                  type="button"
                  layout
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={onUnlock}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-semibold py-4 px-8 rounded-full shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50 transition-shadow"
                >
                  <Plus className="w-5 h-5" />
                  <span>曲をシェアしてロックを解除</span>
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <p className="text-zinc-600 text-xs mt-6 leading-relaxed">
          {shareSongDisabled
            ? 'シェアは一時的に制限中です（上のボタンでタイムラインを開けます）'
            : `本日あと ${remaining} 回シェアできます（上限 ${dailyPostLimit} 回／日）。`}
        </p>
      </motion.div>
    </div>
  );
}
