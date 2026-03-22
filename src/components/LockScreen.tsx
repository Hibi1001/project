import { AnimatePresence, motion } from 'framer-motion';
import { Music, Lock, Plus } from 'lucide-react';

interface LockScreenProps {
  /** Primary action: App = go to timeline; Timeline (can post) = open share modal. */
  onUnlock: () => void;
  onShareSong: () => void;
  /** True during 12h cooldown — secondary share is disabled. */
  shareSongDisabled?: boolean;
  /** e.g. 「次のシェアまであと ○時間○分」 */
  shareCooldownText?: string;
  /**
   * Timeline only: when set and `shareSongDisabled`, the main CTA becomes
   * 「タイムラインを見る」 with subtle styling instead of opening share.
   */
  onViewTimelineWhenCooldown?: () => void;
}

export default function LockScreen({
  onUnlock,
  onShareSong,
  shareSongDisabled = false,
  shareCooldownText = '',
  onViewTimelineWhenCooldown,
}: LockScreenProps) {
  const useCooldownTimelineMain =
    Boolean(shareSongDisabled && onViewTimelineWhenCooldown);

  const showTopCooldownNotice =
    shareSongDisabled &&
    shareCooldownText &&
    !useCooldownTimelineMain;

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

        {showTopCooldownNotice ? (
          <div className="mb-6 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-left">
            <p className="text-xs font-semibold text-amber-200/95 mb-1">
              シェアの間隔制限（12時間）
            </p>
            <p className="text-sm text-amber-100/90 leading-snug">
              直近の投稿から12時間経過するまで、新しい曲をシェアできません。
            </p>
            <p className="text-sm text-amber-300 font-medium mt-2 tabular-nums">
              {shareCooldownText}
            </p>
          </div>
        ) : null}

        <div className="w-full">
          <AnimatePresence mode="wait" initial={false}>
            {useCooldownTimelineMain ? (
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
                  onClick={onViewTimelineWhenCooldown}
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

        <motion.button
          whileHover={shareSongDisabled ? {} : { scale: 1.02 }}
          whileTap={shareSongDisabled ? {} : { scale: 0.98 }}
          onClick={shareSongDisabled ? undefined : onShareSong}
          disabled={shareSongDisabled}
          className={`mt-4 w-full flex items-center justify-center gap-2 py-3 px-6 rounded-full border transition-colors ${
            shareSongDisabled
              ? 'text-zinc-500 border-zinc-700 cursor-not-allowed opacity-60 pointer-events-none'
              : 'text-zinc-300 border-zinc-600 hover:bg-zinc-800/50 hover:text-zinc-50'
          }`}
        >
          <Plus className="w-5 h-5" />
          <span className="text-sm font-medium">曲をシェア</span>
        </motion.button>

        <p className="text-zinc-600 text-xs mt-6">
          {shareSongDisabled
            ? useCooldownTimelineMain
              ? 'シェアのクールダウン中です（上のボタンでタイムラインのみ閲覧できます）'
              : 'クールダウン中は上記の時刻までシェアできません'
            : '曲をシェアから今日の1曲を投稿できます'}
        </p>
      </motion.div>
    </div>
  );
}
