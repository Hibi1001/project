import { motion } from 'framer-motion';
import { Music, Lock, Plus } from 'lucide-react';
import { DAILY_POST_LIMIT } from '../constants/posting';

interface LockScreenProps {
  /** Opens the share flow (modal) — works for 1st, 2nd, or 3rd slot of the day when this screen is shown. */
  onUnlock: () => void;
  /** Optional: view the timeline without posting first (0 slots used). */
  onViewTimelineOnly?: () => void;
  /** How many songs the user has already shared today. */
  slotsUsed: number;
  /** Defaults to `DAILY_POST_LIMIT`. */
  slotsLimit?: number;
}

export default function LockScreen({
  onUnlock,
  onViewTimelineOnly,
  slotsUsed,
  slotsLimit = DAILY_POST_LIMIT,
}: LockScreenProps) {
  const nextSlot = Math.min(slotsUsed + 1, slotsLimit);
  const remaining = Math.max(0, slotsLimit - slotsUsed);

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

        <p className="text-zinc-300 mb-2 text-sm font-medium leading-relaxed">
          Today&apos;s limit: {slotsLimit} songs. You have used{' '}
          <span className="tabular-nums text-emerald-400">
            {slotsUsed} / {slotsLimit}
          </span>{' '}
          slots.
        </p>
        <p className="text-zinc-500 mb-8 text-xs leading-relaxed">
          1日の上限は{slotsLimit}曲です。本日 {slotsUsed}/{slotsLimit}
          曲シェア済み。あと {remaining} 枠あります。
        </p>

        <div className="w-full space-y-3">
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onUnlock}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 py-4 px-8 text-base font-semibold text-white shadow-lg shadow-emerald-500/30 transition-shadow hover:shadow-emerald-500/50"
          >
            <Plus className="h-5 w-5 shrink-0" />
            <span>
              {slotsUsed === 0
                ? '曲をシェアしてロックを解除'
                : `次の曲をシェア（${nextSlot}/${slotsLimit} 枠目）`}
            </span>
          </motion.button>

          {slotsUsed === 0 && onViewTimelineOnly ? (
            <button
              type="button"
              onClick={onViewTimelineOnly}
              className="w-full rounded-full border border-zinc-600/80 bg-zinc-800/40 py-3 px-6 text-sm font-medium text-zinc-200 backdrop-blur-md transition-colors hover:border-zinc-500/70 hover:bg-zinc-800/60"
            >
              先にタイムラインだけ見る
            </button>
          ) : null}
        </div>

        <p className="text-zinc-600 mt-6 text-xs leading-relaxed">
          Daily limit: {slotsLimit} songs. {remaining} share
          {remaining === 1 ? '' : 's'} left today.
        </p>
      </motion.div>
    </div>
  );
}
