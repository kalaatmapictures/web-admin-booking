import { connection } from "next/server";

import { readPublicEnv } from "@/lib/env";
import { readServiceRoleKey } from "@/lib/env.server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

type CheckStatus = "ok" | "missing" | "error";

/**
 * GET /api/health — memeriksa konfigurasi dan koneksi database.
 * Tidak pernah mengembalikan nilai rahasia, hanya status.
 */
export async function GET() {
  await connection(); // selalu dijalankan per request, tidak di-cache

  const publicEnv = readPublicEnv();
  const serviceKey = readServiceRoleKey();

  const checks: Record<"supabaseEnv" | "serviceRoleKey" | "database", CheckStatus> = {
    supabaseEnv: publicEnv ? "ok" : "missing",
    serviceRoleKey: serviceKey ? "ok" : "missing",
    database: "missing",
  };
  let databaseMessage: string | undefined;

  if (publicEnv && serviceKey) {
    // Query ringan: memastikan URL & key benar dan migrasi sudah dijalankan.
    const { error } = await createSupabaseServiceClient()
      .from("projects")
      .select("id", { count: "exact", head: true });

    if (error) {
      checks.database = "error";
      databaseMessage =
        error.code === "42P01" || error.code === "PGRST205"
          ? "Tabel belum ada. Jalankan migrasi di supabase/migrations."
          : "Tidak dapat terhubung ke database. Periksa URL dan key Supabase.";
      console.error("[health] database check failed", error);
    } else {
      checks.database = "ok";
    }
  }

  const ok = Object.values(checks).every((status) => status === "ok");

  return Response.json(
    { ok, checks, ...(databaseMessage ? { message: databaseMessage } : {}) },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
