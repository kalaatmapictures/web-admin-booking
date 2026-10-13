/**
 * Akses environment variables di satu tempat.
 *
 * - Variabel `NEXT_PUBLIC_*` boleh terlihat di browser (URL & anon key Supabase
 *   memang publik; keamanannya dijaga RLS).
 * - Variabel lain HANYA dibaca di server. Lihat `src/lib/env.server.ts`.
 *
 * Next.js mengganti `process.env.NEXT_PUBLIC_*` saat build, jadi nama variabel
 * harus ditulis lengkap (tidak boleh `process.env[name]`).
 */

export type PublicEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  appUrl: string;
};

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Mengembalikan null bila Supabase belum dikonfigurasi (tidak melempar error). */
export function readPublicEnv(): PublicEnv | null {
  const supabaseUrl = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const supabaseAnonKey = clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!supabaseUrl || !supabaseAnonKey) return null;

  return {
    supabaseUrl,
    supabaseAnonKey,
    appUrl: clean(process.env.NEXT_PUBLIC_APP_URL) ?? "http://localhost:3000",
  };
}

export function getPublicEnv(): PublicEnv {
  const env = readPublicEnv();
  if (!env) {
    throw new Error(
      "Supabase belum dikonfigurasi. Isi NEXT_PUBLIC_SUPABASE_URL dan " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY di .env.local (lihat README).",
    );
  }
  return env;
}
