import { motion } from 'framer-motion';
import { Music, Lock, Plus } from 'lucide-react';

interface LockScreenProps {
  onUnlock: () => void;
  onShareSong: () => void;
}

export default function LockScreen({ onUnlock, onShareSong }: LockScreenProps) {
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

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onUnlock}
          className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-semibold py-4 px-8 rounded-full shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50 transition-shadow"
        >
          今日の1曲をシェアして<br />タイムラインをアンロック
        </motion.button>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onShareSong}
          className="mt-4 w-full flex items-center justify-center gap-2 py-3 px-6 rounded-full border border-zinc-600 text-zinc-300 hover:bg-zinc-800/50 hover:text-zinc-50 transition-colors"
        >
          <Plus className="w-5 h-5" />
          <span className="text-sm font-medium">Share Song</span>
        </motion.button>

        <p className="text-zinc-600 text-xs mt-6">
          Share Song から今日の1曲を投稿できます
        </p>
      </motion.div>
    </div>
  );
}
