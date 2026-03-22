import {
  useEffect,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react';

/** Fixed timeline for the progress bar (seconds). */
export const PREVIEW_UI_DURATION_SEC = 15;

export interface SpotifyPlayerProps {
  src: string | null;
  playing: boolean;
  setPlaying: (next: boolean) => void;
  onProgress: (ratio: number) => void;
}

/** Call from a click handler (after flushSync) to satisfy autoplay policies when possible. */
export type SpotifyPlayerHandle = {
  /** Unmute, max volume, then play(). Returns the play() promise. */
  unlockAndPlay: () => Promise<void>;
};

function applyAudibleAndPlay(a: HTMLAudioElement): Promise<void> {
  a.muted = false;
  a.volume = 1.0;
  return a.play().catch((err) => {
    console.warn('Audio play blocked or failed:', err);
    throw err;
  });
}

const SpotifyPlayer = forwardRef<SpotifyPlayerHandle, SpotifyPlayerProps>(
  function SpotifyPlayer(
    { src, playing, setPlaying, onProgress },
    imperativeRef,
  ) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const lastSrcRef = useRef<string | null>(null);
    const onProgressRef = useRef(onProgress);
    const setPlayingRef = useRef(setPlaying);
    const playingRef = useRef(playing);
    const rafRef = useRef<number | null>(null);

    onProgressRef.current = onProgress;
    setPlayingRef.current = setPlaying;
    playingRef.current = playing;

    /** Progress uses fixed 15s so the bar stays predictable when duration is unknown. */
    const updateProgress = useCallback(() => {
      const a = audioRef.current;
      if (!a) return;
      const t = Math.min(a.currentTime, PREVIEW_UI_DURATION_SEC);
      onProgressRef.current(
        Math.min(1, Math.max(0, t / PREVIEW_UI_DURATION_SEC)),
      );
    }, []);

    useImperativeHandle(imperativeRef, () => ({
      unlockAndPlay: async () => {
        const a = audioRef.current;
        if (!a) return;
        try {
          a.muted = false;
          a.volume = 1.0;
          await applyAudibleAndPlay(a);
        } catch {
          setPlayingRef.current(false);
        }
      },
    }));

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

    // High-frequency progress while playing (timeupdate alone is too sparse for a smooth bar)
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

    // Load / swap src
    useEffect(() => {
      const a = audioRef.current;
      if (!a) return;

      if (!src) {
        stopRaf();
        a.pause();
        a.removeAttribute('src');
        lastSrcRef.current = null;
        a.load();
        onProgressRef.current(0);
        return;
      }

      if (lastSrcRef.current === src) {
        a.muted = false;
        a.volume = 1.0;
        return;
      }

      lastSrcRef.current = src;
      stopRaf();
      a.pause();
      a.src = src;
      a.muted = false;
      a.volume = 1.0;
      a.load();
      a.currentTime = 0;
      onProgressRef.current(0);

      const onReady = () => {
        const el = audioRef.current;
        if (!el) return;
        el.muted = false;
        el.volume = 1.0;
        if (playingRef.current) {
          void applyAudibleAndPlay(el).catch(() => {
            setPlayingRef.current(false);
          });
        }
      };

      a.addEventListener('canplay', onReady, { once: true });

      return () => {
        a.removeEventListener('canplay', onReady);
      };
    }, [src, stopRaf]);

    // Play / pause when media is already ready (same src)
    useEffect(() => {
      const a = audioRef.current;
      if (!a || !src || lastSrcRef.current !== src) return;

      a.muted = false;
      a.volume = 1.0;

      if (playing) {
        if (a.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
          void applyAudibleAndPlay(a).catch(() => {
            setPlayingRef.current(false);
          });
        }
      } else {
        a.pause();
      }
    }, [playing, src]);

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

    if (!src) return null;

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
