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
 * Canonical site origin for Supabase OAuth (e.g. Spotify) redirects.
 *
 * **PWA standalone:** The redirect URL must stay within the same origin as your installed app
 * (`manifest.json` `scope` `/`). If `window.location.origin` ever differs from production (www vs
 * apex, preview URL, etc.), set `VITE_SITE_URL` to your public URL, e.g.
 * `https://project-five-pi-66.vercel.app` — and add that exact URL (and `.../`) in Supabase
 * Dashboard → Authentication → URL configuration → Redirect URLs.
 */
export function getAuthRedirectBaseUrl(): string {
  const fromEnv = (import.meta.env.VITE_SITE_URL as string | undefined)
    ?.trim()
    .replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return '';
}

/** OAuth `redirectTo`: always root path on the canonical origin (matches manifest `start_url`). */
export function getOAuthRedirectTo(): string | undefined {
  const base = getAuthRedirectBaseUrl();
  return base ? `${base}/` : undefined;
}

