import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Users, Lock, UserPlus, LogIn, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Mode = 'create' | 'join';

interface GroupManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function GroupManager({ isOpen, onClose }: GroupManagerProps) {
  const [mode, setMode] = useState<Mode>('create');
  const [groupName, setGroupName] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.auth
      .getUser()
      .then(({ data, error: authError }) => {
        if (cancelled) return;
        if (authError) {
          setUserId(null);
        } else {
          setUserId(data.user?.id ?? null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setUserId(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resetMessages = () => {
    setError(null);
    setSuccess(null);
  };

  const handleClose = () => {
    if (isSubmitting) return;
    setGroupName('');
    setPassword('');
    resetMessages();
    onClose();
  };

  const handleCreateGroup = async () => {
    if (!userId) {
      setError('You need to be logged in to create a group.');
      return;
    }
    if (!groupName.trim() || !password.trim()) {
      setError('Group name and secret password are required.');
      return;
    }

    setIsSubmitting(true);
    resetMessages();
    try {
      const { data: group, error: createError } = await supabase
        .from('groups')
        .insert({
          name: groupName.trim(),
          secret_password: password.trim(),
          created_by: userId,
        })
        .select()
        .single();

      if (createError) {
        setError(createError.message);
        setIsSubmitting(false);
        return;
      }

      if (!group) {
        setError('Failed to create group.');
        setIsSubmitting(false);
        return;
      }

      const { error: memberError } = await supabase.from('group_members').insert({
        group_id: group.id,
        user_id: userId,
      });

      if (memberError) {
        setError(memberError.message);
        setIsSubmitting(false);
        return;
      }

      setSuccess('Group created and joined successfully.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unexpected error while creating group.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleJoinGroup = async () => {
    if (!userId) {
      setError('You need to be logged in to join a group.');
      return;
    }
    if (!groupName.trim() || !password.trim()) {
      setError('Group name and secret password are required.');
      return;
    }

    setIsSubmitting(true);
    resetMessages();
    try {
      const { data: group, error: fetchError } = await supabase
        .from('groups')
        .select('*')
        .eq('name', groupName.trim())
        .eq('secret_password', password.trim())
        .maybeSingle();

      if (fetchError) {
        setError(fetchError.message);
        setIsSubmitting(false);
        return;
      }

      if (!group) {
        setError('Group not found or password is incorrect.');
        setIsSubmitting(false);
        return;
      }

      const { error: memberError } = await supabase
        .from('group_members')
        .insert({
          group_id: group.id,
          user_id: userId,
        });

      if (memberError) {
        setError(memberError.message);
        setIsSubmitting(false);
        return;
      }

      setSuccess('Joined group successfully.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unexpected error while joining group.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'create') {
      void handleCreateGroup();
    } else {
      void handleJoinGroup();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40"
            aria-hidden
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', duration: 0.3 }}
            className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4"
          >
            <div className="w-full max-w-md max-h-[85vh] bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-800 overflow-hidden flex flex-col">
              <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                  <Users className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1">
                  <h2 className="text-base font-semibold text-zinc-50">
                    Group Manager
                  </h2>
                  <p className="text-xs text-zinc-400">
                    Create a new group or join an existing one
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isSubmitting}
                  className="text-zinc-400 hover:text-zinc-50 text-sm disabled:opacity-50"
                >
                  Close
                </button>
              </div>

              <div className="px-6 pt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    resetMessages();
                    setMode('create');
                  }}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-full text-xs font-semibold border transition-colors ${
                    mode === 'create'
                      ? 'bg-zinc-50 text-zinc-900 border-zinc-50'
                      : 'bg-zinc-800/60 text-zinc-200 border-zinc-700 hover:bg-zinc-800'
                  }`}
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Create Group</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetMessages();
                    setMode('join');
                  }}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-full text-xs font-semibold border transition-colors ${
                    mode === 'join'
                      ? 'bg-zinc-50 text-zinc-900 border-zinc-50'
                      : 'bg-zinc-800/60 text-zinc-200 border-zinc-700 hover:bg-zinc-800'
                  }`}
                >
                  <LogIn className="w-4 h-4" />
                  <span>Join Group</span>
                </button>
              </div>

              <form
                onSubmit={handleSubmit}
                className="p-6 space-y-4 overflow-y-auto"
              >
                {error && (
                  <p className="text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    <span>{error}</span>
                  </p>
                )}
                {success && (
                  <p className="text-sm text-emerald-300 bg-emerald-400/10 rounded-lg px-3 py-2 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{success}</span>
                  </p>
                )}

                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-2">
                    Group Name
                  </label>
                  <input
                    type="text"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    placeholder="e.g. Tokyo Jam Session"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-50 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-shadow"
                    disabled={isSubmitting}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-2">
                    Secret Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Shared secret for your group"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl pl-9 pr-4 py-3 text-zinc-50 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-shadow"
                      disabled={isSubmitting}
                    />
                  </div>
                </div>

                {!userId && (
                  <p className="text-xs text-zinc-500">
                    You&apos;re not logged in. Group actions will be disabled until
                    you sign in.
                  </p>
                )}

                <button
                  type="submit"
                  disabled={
                    isSubmitting || !groupName.trim() || !password.trim() || !userId
                  }
                  className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-semibold py-3 px-6 rounded-xl shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all inline-flex items-center justify-center gap-2 mt-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Processing...</span>
                    </>
                  ) : mode === 'create' ? (
                    <>
                      <UserPlus className="w-4 h-4" />
                      <span>Create Group</span>
                    </>
                  ) : (
                    <>
                      <LogIn className="w-4 h-4" />
                      <span>Join Group</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

