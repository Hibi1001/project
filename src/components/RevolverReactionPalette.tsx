import { useEffect, useRef } from 'react';
import type { MotionValue } from 'framer-motion';
import {
  animate,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from 'framer-motion';
import { Mic, Guitar, Music2, Drum, Piano } from 'lucide-react';
import type { InstrumentType, Post } from '../types';

const ORDER: InstrumentType[] = [
  'vocal',
  'guitar',
  'bass',
  'drum',
  'keyboard',
];

const ICONS: Record<InstrumentType, typeof Mic> = {
  vocal: Mic,
  guitar: Guitar,
  bass: Music2,
  drum: Drum,
  keyboard: Piano,
};

interface RevolverReactionPaletteProps {
  activePost: Post;
  userReactionSet: Set<InstrumentType>;
  toggleReaction: (postId: string, instrument: InstrumentType) => void;
}

function ArcIconButton({
  index,
  instrument,
  scrollSpring,
  count,
  isMine,
  onCommit,
}: {
  index: number;
  instrument: InstrumentType;
  scrollSpring: MotionValue<number>;
  count: number;
  isMine: boolean;
  onCommit: (i: number) => void;
}) {
  const Icon = ICONS[instrument];

  const x = useTransform(scrollSpring, (s) => {
    const offset = index - s;
    const angle = Math.PI / 2 - offset * 0.44;
    return Math.cos(angle) * 120;
  });
  const y = useTransform(scrollSpring, (s) => {
    const offset = index - s;
    const angle = Math.PI / 2 - offset * 0.44;
    return -Math.sin(angle) * 120;
  });
  const scale = useTransform(scrollSpring, (s) => {
    const d = Math.abs(index - s);
    return 1 + 0.2 * Math.exp(-d * d * 2.2);
  });
  const glow = useTransform(scrollSpring, (s) => {
    const d = Math.abs(index - s);
    return Math.max(0.25, Math.exp(-d * d * 1.8));
  });
  const boxShadow = useTransform(
    glow,
    (g) =>
      `0 0 ${12 + g * 28}px rgba(16, 185, 129, ${0.15 + g * 0.45})`,
  );

  return (
    <motion.button
      type="button"
      style={{
        x,
        y,
        scale,
        boxShadow,
      }}
      onClick={() => onCommit(index)}
      className={`pointer-events-auto absolute left-0 top-0 flex h-[52px] w-[52px] -translate-x-1/2 -translate-y-full flex-col items-center justify-center rounded-full border bg-zinc-900/92 backdrop-blur-md transition-colors ${
        isMine
          ? 'border-emerald-500/70 ring-2 ring-emerald-500/35'
          : 'border-zinc-600/75'
      }`}
      aria-label={`${instrument} リアクション`}
    >
      <Icon
        className={`h-6 w-6 ${isMine ? 'text-emerald-400' : 'text-zinc-300'}`}
      />
      <span className="mt-0.5 text-[10px] font-bold tabular-nums text-zinc-400">
        {count}
      </span>
    </motion.button>
  );
}

/** Semi-circular “revolver” selector: pan horizontally to spin; tap center (or focused) icon to toggle reaction. */
export default function RevolverReactionPalette({
  activePost,
  userReactionSet,
  toggleReaction,
}: RevolverReactionPaletteProps) {
  const n = ORDER.length;
  const center = (n - 1) / 2;
  const scroll = useMotionValue(center);
  const scrollSpring = useSpring(scroll, { stiffness: 420, damping: 34 });
  const panOrigin = useRef(0);

  useEffect(() => {
    scroll.set(center);
  }, [activePost.id, center, scroll]);

  const handleIconCommit = (i: number) => {
    const s = scroll.get();
    const nearest = Math.round(
      Math.max(0, Math.min(n - 1, s)),
    );
    if (nearest === i) {
      toggleReaction(activePost.id, ORDER[i]);
    } else {
      void animate(scroll, i, { type: 'spring', stiffness: 420, damping: 32 });
    }
  };

  return (
    <div
      className="pointer-events-auto fixed inset-x-0 bottom-0 z-20 flex h-[min(200px,28vh)] justify-center pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-6"
      role="toolbar"
      aria-label="楽器リアクション"
    >
      <div className="relative h-full w-full max-w-lg">
        <div className="pointer-events-none absolute bottom-[4.25rem] left-1/2 z-20 h-0 w-0">
          {ORDER.map((instrument, index) => (
            <ArcIconButton
              key={instrument}
              index={index}
              instrument={instrument}
              scrollSpring={scrollSpring}
              count={activePost.reactions[instrument]}
              isMine={userReactionSet.has(instrument)}
              onCommit={handleIconCommit}
            />
          ))}
        </div>

        <motion.div
          className="absolute inset-x-0 bottom-0 z-10 h-14 touch-pan-x rounded-t-2xl bg-zinc-950/40 backdrop-blur-[2px]"
          onPanStart={() => {
            panOrigin.current = scroll.get();
          }}
          onPan={(_, info) => {
            const raw = panOrigin.current - info.offset.x / 48;
            scroll.set(Math.max(0, Math.min(n - 1, raw)));
          }}
          onPanEnd={() => {
            void animate(
              scroll,
              Math.round(
                Math.max(0, Math.min(n - 1, scroll.get())),
              ),
              { type: 'spring', stiffness: 380, damping: 30 },
            );
          }}
          aria-label="リアクションを回転"
        />

        <p className="pointer-events-none absolute bottom-[3.25rem] left-0 right-0 z-[5] text-center text-[10px] text-zinc-500">
          下をスワイプで回転 · 中央をタップでリアクション
        </p>
      </div>
    </div>
  );
}
