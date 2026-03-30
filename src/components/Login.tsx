import { useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, LogIn, Music2, UserPlus } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Mode = 'signin' | 'signup';

export default function Login() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      setError('メールアドレスとパスワードを入力してください');
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'signup') {
        const { error: signUpError } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
        });
        if (signUpError) {
          setError(signUpError.message);
          return;
        }
        setMessage('登録用のメールを確認したら、この画面からログインしてください。');
        setMode('signin');
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (signInError) throw signInError;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '認証に失敗しました';
      setError(msg);
    } finally {
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
              <div className="mb-6 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setMode('signin');
                    setError(null);
                    setMessage(null);
                  }}
                  className={`flex-1 rounded-full border py-2.5 text-sm font-semibold transition-colors ${
                    mode === 'signin'
                      ? 'border-zinc-50 bg-zinc-50 text-zinc-950'
                      : 'border-zinc-700 bg-zinc-800/50 text-zinc-200 hover:bg-zinc-800'
                  }`}
                >
                  ログイン
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('signup');
                    setError(null);
                    setMessage(null);
                  }}
                  className={`flex-1 rounded-full border py-2.5 text-sm font-semibold transition-colors ${
                    mode === 'signup'
                      ? 'border-zinc-50 bg-zinc-50 text-zinc-950'
                      : 'border-zinc-700 bg-zinc-800/50 text-zinc-200 hover:bg-zinc-800'
                  }`}
                >
                  新規登録
                </button>
              </div>

              {error ? (
                <p className="mb-4 rounded-xl bg-red-400/10 px-4 py-3 text-sm text-red-400">
                  {error}
                </p>
              ) : null}
              {message ? (
                <p className="mb-4 rounded-xl bg-emerald-400/10 px-4 py-3 text-sm text-emerald-300">
                  {message}
                </p>
              ) : null}

              <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
                <div>
                  <label
                    htmlFor="login-email"
                    className="mb-2 block text-sm font-medium text-zinc-400"
                  >
                    メールアドレス
                  </label>
                  <input
                    id="login-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    placeholder="you@example.com"
                    disabled={isSubmitting}
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-zinc-50 placeholder-zinc-500 transition-shadow focus:border-transparent focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label
                    htmlFor="login-password"
                    className="mb-2 block text-sm font-medium text-zinc-400"
                  >
                    パスワード
                  </label>
                  <input
                    id="login-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={
                      mode === 'signup' ? 'new-password' : 'current-password'
                    }
                    placeholder="••••••••"
                    disabled={isSubmitting}
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-zinc-50 placeholder-zinc-500 transition-shadow focus:border-transparent focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting || !email.trim() || !password}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 py-3 px-6 font-semibold text-white shadow-lg shadow-emerald-500/20 transition-all hover:shadow-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span>処理中…</span>
                    </>
                  ) : mode === 'signup' ? (
                    <>
                      <UserPlus className="h-5 w-5" />
                      <span>アカウントを作成</span>
                    </>
                  ) : (
                    <>
                      <LogIn className="h-5 w-5" />
                      <span>ログイン</span>
                    </>
                  )}
                </button>
              </form>

              <p className="mt-6 text-center text-xs leading-relaxed text-zinc-500">
                {mode === 'signup'
                  ? '新規登録後、メール確認が必要な場合があります。'
                  : 'ログイン後、プロフィール未設定の場合は初期設定が表示されます。'}
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
