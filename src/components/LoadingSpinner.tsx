import { Loader2 } from 'lucide-react';

type LoadingSpinnerProps = {
  label?: string;
  className?: string;
  /** Overlay / inline use — does not force full viewport height. */
  compact?: boolean;
};

/**
 * Lightweight loading indicator for auth/bootstrap — avoids a blank white screen.
 */
export default function LoadingSpinner({
  label,
  className = '',
  compact = false,
}: LoadingSpinnerProps) {
  return (
    <div
      className={`flex w-full flex-col items-center justify-center gap-3 bg-zinc-950 text-zinc-50 ${
        compact ? 'min-h-0' : 'min-h-[100dvh]'
      } ${className}`}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <Loader2
        className="h-9 w-9 animate-spin text-emerald-400/90"
        strokeWidth={2}
        aria-hidden
      />
      {label ? (
        <p className="max-w-xs text-center text-sm text-zinc-400">{label}</p>
      ) : null}
    </div>
  );
}
