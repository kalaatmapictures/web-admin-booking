import "server-only";

/**
 * Rahasia yang hanya boleh ada di server. `server-only` membuat build gagal
 * bila file ini (atau file yang mengimpornya) terbawa ke komponen client.
 */

export function readServiceRoleKey(): string | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return key ? key : null;
}

export function getServiceRoleKey(): string {
  const key = readServiceRoleKey();
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY belum diisi. Variabel ini hanya untuk server " +
        "dan tidak boleh diberi awalan NEXT_PUBLIC_ (lihat README).",
    );
  }
  return key;
}
