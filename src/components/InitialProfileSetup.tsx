import { useState } from 'react';
import { supabase } from '../lib/supabase';

type Props = {
  userId: string;
  onComplete: () => void;
};

/**
 * First-launch overlay: require a non-empty display name before using the app.
 */
export default function InitialProfileSetup({ userId, onComplete }: Props) {
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = displayName.trim();
    if (!name) {
      setError('表示名を入力してください。');
      return;
    }
    setSubmitting(true);
    setError(null);

    const bioVal = bio.trim() || null;
    let avatarUrl: string | null = null;

    const file = avatarFile;
    if (file && file.size > 0) {
      const objectPath = `${userId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(objectPath, file, {
          cacheControl: '3600',
          upsert: true,
          contentType: file.type || 'application/octet-stream',
        });
      if (upErr) {
        setError(upErr.message);
        setSubmitting(false);
        return;
      }
      const {
        data: { publicUrl },
      } = supabase.storage.from('avatars').getPublicUrl(objectPath);
      avatarUrl = publicUrl;
    }

    const { data: existing, error: exErr } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (exErr) {
      setError(exErr.message);
      setSubmitting(false);
      return;
    }

    if (!existing) {
      const { error: insErr } = await supabase.from('users').insert({
        id: userId,
        display_name: name,
        recruitment_status: bioVal,
        ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
      });
      if (insErr) {
        setError(insErr.message);
        setSubmitting(false);
        return;
      }
    } else {
      const { error: updErr } = await supabase
        .from('users')
        .update({
          display_name: name,
          recruitment_status: bioVal,
          ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
        })
        .eq('id', userId);
      if (updErr) {
        setError(updErr.message);
        setSubmitting(false);
        return;
      }
    }

    setSubmitting(false);
    onComplete();
  };

  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-zinc-950 px-4 py-8">
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-emerald-950/40 via-zinc-950 to-zinc-950"
        aria-hidden
      />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/95 p-6 shadow-2xl backdrop-blur-md">
        <h1 className="text-lg font-semibold text-zinc-50">プロフィールを設定</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          タイムラインを利用する前に、表示名の登録が必要です。
        </p>
        <form onSubmit={(e) => void handleSubmit(e)} className="mt-6 space-y-4">
          {error ? (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          ) : null}
          <div>
            <label
              htmlFor="initial-display-name"
              className="mb-1 block text-xs font-medium text-zinc-400"
            >
              表示名 <span className="text-red-400">*</span>
            </label>
            <input
              id="initial-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              placeholder="例: 山田ギター"
              maxLength={80}
              autoComplete="name"
              autoFocus
              disabled={submitting}
              required
            />
          </div>
          <div>
            <label
              htmlFor="initial-bio"
              className="mb-1 block text-xs font-medium text-zinc-400"
            >
              自己紹介（任意）
            </label>
            <textarea
              id="initial-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              maxLength={500}
              disabled={submitting}
              className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              placeholder="例：ベース弾けます！普段はロックやR&Bをよく聴きます。"
            />
          </div>
          <div>
            <label
              htmlFor="initial-avatar"
              className="mb-1 block text-xs font-medium text-zinc-400"
            >
              アイコン画像（任意）
            </label>
            <input
              id="initial-avatar"
              type="file"
              accept="image/*"
              disabled={submitting}
              onChange={(ev) => setAvatarFile(ev.target.files?.[0] ?? null)}
              className="w-full text-xs text-zinc-400 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
          >
            {submitting ? '保存中…' : 'はじめる'}
          </button>
        </form>
      </div>
    </div>
  );
}
