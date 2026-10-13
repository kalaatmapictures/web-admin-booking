import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getPublicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * Klien Supabase atas nama admin yang sedang login (sesi dari cookie).
 * Semua query tunduk pada RLS — admin hanya bisa melakukan yang diizinkan policy.
 * Dipakai di Server Components, Server Actions, dan Route Handlers.
 */
export async function createSupabaseServerClient() {
  const { supabaseUrl, supabaseAnonKey } = getPublicEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component tidak boleh menulis cookie. Penyegaran sesi
          // akan ditangani proxy (Tahap 2), jadi aman diabaikan di sini.
        }
      },
    },
  });
}
