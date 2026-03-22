import { useState } from 'react';
import { motion } from 'framer-motion';
import { Music2, LogIn, UserPlus, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Mode = 'signin' | 'signup';

function emailPrefix(email: string) {
  const at = email.indexOf('@');
  if (at <= 0) return email;
  return email.slice(0, at);
}

/** Never throws. Logs failures. Only sends `id`, `email`, `display_name` — never `display_id`. */
async function syncPublicUserRowAfterSignup(
  userId: string,
  trimmedEmail: string,
  displayName: string,
): Promise<boolean> {
  try {
    const minimalUserRow: {
      id: string;
      email: string;
      display_name: string;
    } = {
      id: userId,
      email: trimmedEmail,
      display_name: displayName,
    };

    const { error: profileError } = await supabase
      .from('users')
      .upsert(minimalUserRow, { onConflict: 'id' });

    if (profileError) {
      console.error(
        '[Login signup] public.users upsert failed (auth still OK) — full error:',
        profileError,
      );
      console.error(
        '[Login signup] details:',
        JSON.stringify(
          profileError,
          ['name', 'message', 'code', 'details', 'hint'],
          2,
        ),
      );
      return false;
    }
    return true;
  } catch (caught: unknown) {
    console.error(
      '[Login signup] public.users upsert threw (auth still OK) — full error:',
      caught,
    );
    if (caught instanceof Error) {
      console.error('[Login signup] stack:', caught.stack);
    }
    return false;
  }
}

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
    if (!email.trim() || !password) {
      setError('メールアドレスとパスワードを入力してください');
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'signup') {
        const trimmedEmail = email.trim();
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
        });

        // Auth is the source of truth for "signup succeeded". Profile sync is best-effort only.
        if (signUpError) {
          setError(signUpError.message);
          return;
        }

        const userId = data.user?.id;
        const displayName =
          emailPrefix(trimmedEmail) || trimmedEmail || 'User';

        if (!userId) {
          setMessage(
            '新規登録しました。メール認証が必要な場合は受信箱を確認してください。'
          );
        } else {
          const profileSynced = await syncPublicUserRowAfterSignup(
            userId,
            trimmedEmail,
            displayName,
          );
          if (profileSynced) {
            setMessage(
              '新規登録しました。メール認証が必要な場合は受信箱を確認してください。表示IDはプロフィール編集で後から設定できます。'
            );
          } else {
            setMessage(
              'Signed up! If your profile doesn\'t load immediately, please set it up in the Profile page. ログイン後「プロフィールを編集」から保存してください。メール認証が必要な場合は受信箱を確認してください。'
            );
          }
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
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
    <div className="fixed inset-0 bg-zinc-950 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black opacity-90" />
      <div className="absolute inset-0 opacity-10 blur-3xl">
        <div className="absolute -top-20 -left-20 w-72 h-72 bg-emerald-500/30 rounded-full" />
        <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-teal-500/20 rounded-full" />
      </div>

      <div className="relative z-10 h-full flex items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <div className="bg-zinc-900/70 backdrop-blur-md border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-zinc-800 flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <Music2 className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-zinc-50">
                  Today’s 1 Song
                </h1>
                <p className="text-zinc-400 text-sm">
                  1日1曲、気分をシェア
                </p>
              </div>
            </div>

            <div className="p-6">
              <div className="flex gap-2 mb-6">
                <button
                  type="button"
                  onClick={() => setMode('signin')}
                  className={`flex-1 py-2.5 rounded-full text-sm font-semibold transition-colors border ${
                    mode === 'signin'
                      ? 'bg-zinc-50 text-zinc-950 border-zinc-50'
                      : 'bg-zinc-800/50 text-zinc-200 border-zinc-700 hover:bg-zinc-800'
                  }`}
                >
                  ログイン
                </button>
                <button
                  type="button"
                  onClick={() => setMode('signup')}
                  className={`flex-1 py-2.5 rounded-full text-sm font-semibold transition-colors border ${
                    mode === 'signup'
                      ? 'bg-zinc-50 text-zinc-950 border-zinc-50'
                      : 'bg-zinc-800/50 text-zinc-200 border-zinc-700 hover:bg-zinc-800'
                  }`}
                >
                  新規登録
                </button>
              </div>

              {error && (
                <p className="text-sm text-red-400 bg-red-400/10 rounded-xl px-4 py-3 mb-4">
                  {error}
                </p>
              )}
              {message && (
                <p className="text-sm text-emerald-300 bg-emerald-400/10 rounded-xl px-4 py-3 mb-4">
                  {message}
                </p>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="email"
                    className="block text-sm font-medium text-zinc-400 mb-2"
                  >
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    placeholder="you@example.com"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-50 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-shadow"
                    disabled={isSubmitting}
                  />
                </div>

                <div>
                  <label
                    htmlFor="password"
                    className="block text-sm font-medium text-zinc-400 mb-2"
                  >
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={
                      mode === 'signup' ? 'new-password' : 'current-password'
                    }
                    placeholder="••••••••"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-50 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-shadow"
                    disabled={isSubmitting}
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting || !email.trim() || !password}
                  className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-semibold py-3 px-6 rounded-xl shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all inline-flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>処理中...</span>
                    </>
                  ) : mode === 'signup' ? (
                    <>
                      <UserPlus className="w-5 h-5" />
                      <span>新規登録</span>
                    </>
                  ) : (
                    <>
                      <LogIn className="w-5 h-5" />
                      <span>ログイン</span>
                    </>
                  )}
                </button>
              </form>

              <div className="mt-6 text-xs text-zinc-500 leading-relaxed">
                {mode === 'signup' ? (
                  <p>
                    新規登録後、設定によってはメール認証が必要です。届かない場合は迷惑メールも確認してください。
                  </p>
                ) : (
                  <p>ログインすると、今日の1曲を投稿してタイムラインを楽しめます。</p>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

