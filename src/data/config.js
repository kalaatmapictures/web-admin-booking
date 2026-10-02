/* Konfigurasi dari environment variable (.env lokal / Vercel). */
export const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
export const LANDING_URL       = (import.meta.env.VITE_LANDING_URL || 'http://localhost:5173').replace(/\/+$/, '') + '/';

export const supabaseReady = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);
