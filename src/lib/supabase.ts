import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl) {
  throw new Error('VITE_SUPABASE_URL is not set in your environment variables.');
}

if (!supabaseAnonKey) {
  throw new Error('VITE_SUPABASE_ANON_KEY is not set in your environment variables.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Base URL for Supabase OAuth / magic-link redirects.
 * In the browser: current origin (e.g. http://localhost:5173 in dev, your Vercel URL in prod).
 * Optional override: set VITE_SITE_URL when the public URL is not the same as window.location.origin.
 */
export function getAuthRedirectBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  const fromEnv = (import.meta.env.VITE_SITE_URL as string | undefined)?.trim();
  return fromEnv?.replace(/\/$/, '') ?? '';
}

