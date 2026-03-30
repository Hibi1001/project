import { useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Music2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSpotifySignIn = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'spotify',
        options: {
          redirectTo:
            typeof window !== 'undefined' ? window.location.origin : undefined,
          scopes: 'user-read-recently-played',
        },
      });
      if (oauthError) throw oauthError;
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'ログインを開始できませんでした';
      setError(msg);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 overflow-hidden bg-zinc-950">
      <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black opacity-90" />
      <div className="absolute inset-0 opacity-10 blur-3xl">
        <div className="absolute -top-20 -left-20 h-72 w-72 rounded-full bg-emerald-500/30" />
        <div className="absolute -bottom-24 -right-24 h-96 w-96 rounded-full bg-teal-500/20" />
      </div>

      <div className="relative z-10 flex h-full items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <div className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/70 shadow-2xl backdrop-blur-md">
            <div className="flex items-center gap-3 border-b border-zinc-800 p-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/20">
                <Music2 className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-zinc-50">
                  Today&apos;s 1 Song
                </h1>
                <p className="text-sm text-zinc-400">1日1曲、気分をシェア</p>
              </div>
            </div>

            <div className="p-6">
              {error ? (
                <p className="mb-4 rounded-xl bg-red-400/10 px-4 py-3 text-sm text-red-400">
                  {error}
                </p>
              ) : null}

              <p className="mb-4 text-center text-sm leading-relaxed text-zinc-400">
                続行するには Spotify アカウントでサインインしてください。
              </p>

              <button
                type="button"
                onClick={() => void handleSpotifySignIn()}
                disabled={isSubmitting}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1DB954] py-3.5 px-6 text-base font-bold text-white shadow-lg shadow-black/30 transition-all hover:bg-[#1ed760] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>接続中…</span>
                  </>
                ) : (
                  <span>Sign in with Spotify</span>
                )}
              </button>

              <p className="mt-6 text-center text-xs leading-relaxed text-zinc-500">
                ログインすると、今日の1曲を投稿してタイムラインを楽しめます。
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
