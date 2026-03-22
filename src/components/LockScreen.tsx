import { motion } from 'framer-motion';
import { Music, Lock, Plus } from 'lucide-react';

interface LockScreenProps {
  onUnlock: () => void;
  onShareSong: () => void;
  /** True when 12h cooldown is active — disables Share Song (and optionally main CTA). */
  shareSongDisabled?: boolean;
  /** e.g. 「次のシェアまであと ○時間○分」 */
  shareCooldownText?: string;
  /** When both CTAs open the share modal, disable both during cooldown. */
  disableMainCtaWhenShareCooldown?: boolean;
}

export default function LockScreen({
  onUnlock,
  onShareSong,
  shareSongDisabled = false,
  shareCooldownText = '',
  disableMainCtaWhenShareCooldown = false,
}: LockScreenProps) {
  const mainDisabled =
    shareSongDisabled && Boolean(disableMainCtaWhenShareCooldown);
  return (
    <div className="fixed inset-0 bg-zinc-950 flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black opacity-90" />

      <div
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: 'url(https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=1200)',
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
            ease: "easeInOut"
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

        {shareSongDisabled && shareCooldownText ? (
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

        <motion.button
          whileHover={mainDisabled ? {} : { scale: 1.05 }}
          whileTap={mainDisabled ? {} : { scale: 0.95 }}
          onClick={mainDisabled ? undefined : onUnlock}
          disabled={mainDisabled}
          className={`w-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-semibold py-4 px-8 rounded-full shadow-lg shadow-emerald-500/30 transition-shadow ${
            mainDisabled
              ? 'opacity-40 cursor-not-allowed pointer-events-none'
              : 'hover:shadow-emerald-500/50'
          }`}
        >
          今日の1曲をシェアして<br />タイムラインをアンロック
        </motion.button>

        <motion.button
          whileHover={shareSongDisabled ? {} : { scale: 1.02 }}
          whileTap={shareSongDisabled ? {} : { scale: 0.98 }}
          onClick={shareSongDisabled ? undefined : onShareSong}
          disabled={shareSongDisabled}
          className={`mt-4 w-full flex items-center justify-center gap-2 py-3 px-6 rounded-full border border-zinc-600 transition-colors ${
            shareSongDisabled
              ? 'text-zinc-500 border-zinc-700 cursor-not-allowed opacity-60 pointer-events-none'
              : 'text-zinc-300 hover:bg-zinc-800/50 hover:text-zinc-50'
          }`}
        >
          <Plus className="w-5 h-5" />
          <span className="text-sm font-medium">曲をシェア</span>
        </motion.button>

        <p className="text-zinc-600 text-xs mt-6">
          {shareSongDisabled
            ? 'クールダウン中は上記の時刻までシェアできません'
            : '曲をシェアから今日の1曲を投稿できます'}
        </p>
      </motion.div>
    </div>
  );
}
