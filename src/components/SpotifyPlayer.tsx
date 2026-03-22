import { useEffect, useRef, useCallback } from 'react';

/** UI progress bar length (seconds cap). */
export const PREVIEW_UI_DURATION_SEC = 15;

export interface SpotifyPlayerProps {
  src: string | null;
  playing: boolean;
  setPlaying: (next: boolean) => void;
  onProgress: (ratio: number) => void;
}

/**
 * Hidden `<audio>` for timeline previews: volume, unmuted, load + play coordination, time updates.
 */
export default function SpotifyPlayer({
  src,
  playing,
  setPlaying,
  onProgress,
}: SpotifyPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastSrcRef = useRef<string | null>(null);
  const onProgressRef = useRef(onProgress);
  const setPlayingRef = useRef(setPlaying);
  const playingRef = useRef(playing);

  onProgressRef.current = onProgress;
  setPlayingRef.current = setPlaying;
  playingRef.current = playing;

  const updateProgress = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    const rawDur = a.duration;
    const dur =
      rawDur && Number.isFinite(rawDur) && rawDur > 0
        ? Math.min(rawDur, PREVIEW_UI_DURATION_SEC)
        : PREVIEW_UI_DURATION_SEC;
    const t = Math.min(a.currentTime, dur);
    onProgressRef.current(Math.min(1, Math.max(0, t / dur)));
  }, []);

  // Assign src once per URL
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    if (!src) {
      a.pause();
      a.removeAttribute('src');
      lastSrcRef.current = null;
      a.load();
      onProgressRef.current(0);
      return;
    }

    if (lastSrcRef.current === src) {
      a.volume = 1;
      a.muted = false;
      return;
    }

    lastSrcRef.current = src;
    a.pause();
    a.src = src;
    a.volume = 1;
    a.muted = false;
    a.load();
    a.currentTime = 0;
    onProgressRef.current(0);

    const onReady = () => {
      a.volume = 1;
      a.muted = false;
      if (playingRef.current) {
        void a.play().catch(() => {
          setPlayingRef.current(false);
        });
      }
    };

    a.addEventListener('canplay', onReady, { once: true });

    return () => {
      a.removeEventListener('canplay', onReady);
    };
  }, [src]);

  // Play / pause when the element already has data (avoid racing a fresh load())
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !src || lastSrcRef.current !== src) return;

    a.volume = 1;
    a.muted = false;

    if (playing) {
      if (a.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
        void a.play().catch(() => {
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
      setPlayingRef.current(false);
      onProgressRef.current(1);
    };

    a.addEventListener('timeupdate', onTime);
    a.addEventListener('ended', onEnded);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('ended', onEnded);
    };
  }, [src, updateProgress]);

  if (!src) return null;

  return (
    <audio
      ref={audioRef}
      className="hidden"
      playsInline
      preload="auto"
      aria-hidden
    />
  );
}
