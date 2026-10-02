/* Klien Supabase — dipakai untuk login (sesi diperbarui otomatis)
   dan sebagai sumber token untuk panggilan REST di core.js. */
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, supabaseReady } from './config.js';

export const sb = supabaseReady() ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
export { SUPABASE_URL, SUPABASE_ANON_KEY, supabaseReady };
