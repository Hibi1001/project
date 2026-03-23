import {
  useLayoutEffect,
  useEffect,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react';

export const PREVIEW_UI_DURATION_SEC = 30;

export interface SpotifyPlayerProps {
  src: string | null;
  playing: boolean;
  setPlaying: (next: boolean) => void;
  onProgress: (ratio: number) => void;
}

export type SpotifyPlayerHandle = {
  /** load() → canplay → unmute → play() in one chain (call from click after flushSync). */
  loadAndPlayFromGesture: () => Promise<void>;
};

function effectiveDurationSeconds(a: HTMLAudioElement): number {
  const d = a.duration;
  if (
    !Number.isFinite(d) ||
    Number.isNaN(d) ||
    d <= 0 ||
    d === Number.POSITIVE_INFINITY
  ) {
    return PREVIEW_UI_DURATION_SEC;
  }
  return Math.min(d, PREVIEW_UI_DURATION_SEC);
}

/** Force unmute + full volume in the same turn as play(). */
function playAudible(a: HTMLAudioElement): Promise<void> {
  a.muted = false;
  a.volume = 1.0;
  return a.play().catch((err) => {
    console.warn('Audio play blocked or failed:', err);
    throw err;
  });
}

/** After load(), wait until media can play (single promise chain). */
function afterLoadCanPlay(a: HTMLAudioElement): Promise<void> {
  if (a.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const onReady = () => {
      a.removeEventListener('canplay', onReady);
      a.removeEventListener('error', onErr);
      resolve();
    };
    const onErr = () => {
      a.removeEventListener('canplay', onReady);
      a.removeEventListener('error', onErr);
      reject(new Error('audio error'));
    };
    a.addEventListener('canplay', onReady, { once: true });
    a.addEventListener('error', onErr, { once: true });
  });
}

const SpotifyPlayer = forwardRef<SpotifyPlayerHandle, SpotifyPlayerProps>(
  function SpotifyPlayer(
    { src, playing, setPlaying, onProgress },
    imperativeRef,
  ) {
    const audioRef = useRef<HTMLAudioElement>(null);
    /** URL we successfully bound to <audio> (skip redundant load when unchanged). */
    const lastBoundSrcRef = useRef<string | null>(null);
    const latestSrcRef = useRef<string | null>(null);
    const onProgressRef = useRef(onProgress);
    const setPlayingRef = useRef(setPlaying);
    const playingRef = useRef(playing);
    const rafRef = useRef<number | null>(null);

    latestSrcRef.current = src;
    onProgressRef.current = onProgress;
    setPlayingRef.current = setPlaying;
    playingRef.current = playing;

    const updateProgress = useCallback(() => {
      const a = audioRef.current;
      if (!a) return;
      const den = effectiveDurationSeconds(a);
      if (a.currentTime >= den - 0.02) {
        a.pause();
        a.currentTime = den;
        setPlayingRef.current(false);
        onProgressRef.current(1);
        return;
      }
      const t = a.currentTime;
      onProgressRef.current(Math.min(1, Math.max(0, t / den)));
    }, []);

    const stopRaf = useCallback(() => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }, []);

    const tickRaf = useCallback(() => {
      updateProgress();
      if (playingRef.current) {
        rafRef.current = requestAnimationFrame(tickRaf);
      } else {
        rafRef.current = null;
      }
    }, [updateProgress]);

    /**
     * Single chain: assign src → load() → canplay → optional play (with unmute inside play path).
     */
    const loadThenMaybePlay = useCallback(
      async (a: HTMLAudioElement, url: string, shouldPlay: boolean) => {
        a.pause();
        a.src = url;
        a.load();

        try {
          await afterLoadCanPlay(a);
        } catch {
          lastBoundSrcRef.current = null;
          setPlayingRef.current(false);
          onProgressRef.current(0);
          return;
        }

        lastBoundSrcRef.current = url;
        a.currentTime = 0;
        onProgressRef.current(0);
        a.muted = false;
        a.volume = 1.0;

        if (!shouldPlay) {
          a.pause();
          return;
        }

        try {
          await playAudible(a);
        } catch {
          setPlayingRef.current(false);
        }
      },
      [],
    );

    useImperativeHandle(imperativeRef, () => ({
      loadAndPlayFromGesture: async () => {
        const a = audioRef.current;
        const url = latestSrcRef.current;
        if (!a || !url) return;
        playingRef.current = true;
        await loadThenMaybePlay(a, url, true);
      },
    }));

    useLayoutEffect(() => {
      const a = audioRef.current;
      if (!a) return;

      let cancelled = false;

      const sync = async () => {
        if (!src) {
          stopRaf();
          lastBoundSrcRef.current = null;
          a.pause();
          a.removeAttribute('src');
          a.load();
          onProgressRef.current(0);
          return;
        }

        const needLoad = lastBoundSrcRef.current !== src;

        if (needLoad) {
          await loadThenMaybePlay(a, src, playing);
          if (cancelled) return;
          if (!playing) {
            a.pause();
          }
          return;
        }

        // Same src: playing true → play; playing false → pause only (keep currentTime)
        a.muted = false;
        a.volume = 1.0;

        if (playing) {
          try {
            await playAudible(a);
          } catch {
            if (!cancelled) setPlayingRef.current(false);
          }
        } else {
          a.pause();
        }
      };

      void sync();

      return () => {
        cancelled = true;
      };
    }, [src, playing, loadThenMaybePlay, stopRaf]);

    useEffect(() => {
      const a = audioRef.current;
      if (!playing || !src || !a) {
        stopRaf();
        return;
      }
      stopRaf();
      rafRef.current = requestAnimationFrame(tickRaf);
      return stopRaf;
    }, [playing, src, tickRaf, stopRaf]);

    useEffect(() => {
      const a = audioRef.current;
      if (!a) return;

      const onTime = () => updateProgress();
      const onEnded = () => {
        stopRaf();
        setPlayingRef.current(false);
        onProgressRef.current(1);
      };

      a.addEventListener('timeupdate', onTime);
      a.addEventListener('ended', onEnded);
      return () => {
        a.removeEventListener('timeupdate', onTime);
        a.removeEventListener('ended', onEnded);
      };
    }, [src, updateProgress, stopRaf]);

    return (
      <audio
        ref={audioRef}
        className="hidden"
        playsInline
        preload="auto"
        muted={false}
        aria-hidden
      />
    );
  },
);

SpotifyPlayer.displayName = 'SpotifyPlayer';

export default SpotifyPlayer;
