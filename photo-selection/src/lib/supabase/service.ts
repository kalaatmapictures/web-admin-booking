import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getPublicEnv } from "@/lib/env";
import { getServiceRoleKey } from "@/lib/env.server";
import type { Database } from "@/types/database";

/**
 * Klien Supabase dengan service role — MELEWATI RLS.
 *
 * Hanya untuk kode server yang sudah memvalidasi aksesnya sendiri, misalnya
 * galeri klien setelah token diverifikasi. Setiap query WAJIB dibatasi ke
 * proyek yang sudah terverifikasi (`.eq("project_id", ...)`).
 * Jangan pernah mengimpor file ini dari komponen client.
 */
export function createSupabaseServiceClient() {
  const { supabaseUrl } = getPublicEnv();

  return createClient<Database>(supabaseUrl, getServiceRoleKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
