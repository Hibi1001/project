import { AnimatePresence, motion } from 'framer-motion';
import { Music, Lock } from 'lucide-react';

interface LockScreenProps {
  /** Primary action: App = go to timeline; Timeline (can post) = open share modal. */
  onUnlock: () => void;
  /** True during 12h cooldown — secondary share is disabled. */
  shareSongDisabled?: boolean;
  /** e.g. 「次のシェアまであと ○時間○分」 */
  shareCooldownText?: string;
  /**
   * Optional override for the main CTA when `shareSongDisabled` (e.g. Timeline bypass).
   * If omitted, `onUnlock` is used (e.g. App lock → `handleUnlock`).
   */
  onViewTimelineWhenCooldown?: () => void;
}

export default function LockScreen({
  onUnlock,
  shareSongDisabled = false,
  shareCooldownText = '',
  onViewTimelineWhenCooldown,
}: LockScreenProps) {
  /** 12h cooldown always drives the zinc 「タイムラインを見る」 main button. */
  const showCooldownMain = shareSongDisabled;
  const onCooldownMainClick =
    onViewTimelineWhenCooldown ?? onUnlock;

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

        <p className="text-zinc-400 mb-8 text-sm leading-relaxed">
          毎日1曲、あなたの「今日の気分」を<br />
          仲間とシェアしてタイムラインをアンロック
        </p>

        {showCooldownMain ? (
          <p className="text-xs text-zinc-500 mb-4 text-left leading-relaxed">
            シェアは12時間に1回までです。次にシェアできるまでのあいだ、タイムラインだけ閲覧できます。
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
                  次のシェアは上記の時刻以降に「曲をシェア」からどうぞ
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
                  className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-semibold py-4 px-8 rounded-full shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50 transition-shadow"
                >
                  今日の1曲をシェアして
                  <br />
                  タイムラインをアンロック
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <p className="text-zinc-600 text-xs mt-6">
          {shareSongDisabled
            ? 'シェアのクールダウン中です（上のボタンでタイムラインを開けます）'
            : '右下の＋から今日の1曲を投稿できます'}
        </p>
      </motion.div>
    </div>
  );
}
