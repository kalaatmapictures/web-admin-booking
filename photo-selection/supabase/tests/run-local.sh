#!/usr/bin/env bash
# Menguji migrasi di PostgreSQL lokal (bukan project Supabase Anda).
#
# Pemakaian:
#   PGURL="postgresql://postgres@localhost:5432/postgres" ./supabase/tests/run-local.sh
#
# Skrip membuat database sementara `photo_selection_test`, lalu menghapusnya lagi.
set -euo pipefail

PGURL="${PGURL:-postgresql://postgres@localhost:5432/postgres}"
DB=photo_selection_test
DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEST_URL="${PGURL%/*}/$DB"

psql "$PGURL" -qc "drop database if exists $DB" -c "create database $DB"
trap 'psql "$PGURL" -qc "drop database if exists $DB with (force)"' EXIT

run() { PGOPTIONS="-c client_min_messages=warning" psql "$TEST_URL" -q -v ON_ERROR_STOP=1 "$@"; }

run -f "$DIR/tests/supabase_stub.sql"
for f in "$DIR"/migrations/*.sql; do
  run -f "$f"
  run -f "$f" # dijalankan dua kali: migrasi harus aman diulang
done
echo "Migrasi diterapkan (2x) tanpa error."

run -f "$DIR/tests/schema_test.sql"

# --- Uji race condition: 40 request paralel memilih 40 foto berbeda, kuota 5.
run <<'SQL'
insert into public.projects (id, client_name, event_type, photo_quota, status)
  values ('30000000-0000-0000-0000-000000000001', 'Race', 'Uji', 5, 'active');
insert into public.project_photos (project_id, drive_file_id, file_name, mime_type, photo_code)
  select '30000000-0000-0000-0000-000000000001', 'raceDriveFile' || g, 'R' || g || '.jpg', 'image/jpeg', 'R' || g
  from generate_series(1, 40) g;
SQL

# "Barrier": satu sesi memegang advisory lock 3 detik; semua worker menunggu lock
# yang sama lalu dilepas serentak, sehingga insert benar-benar bersamaan.
psql "$TEST_URL" -qc "select pg_advisory_lock(4242); select pg_sleep(3);" >/dev/null &
sleep 0.5
worker() {
  psql "$TEST_URL" -q -c "select pg_advisory_lock_shared(4242);" -c "set role service_role;" \
    -c "insert into public.photo_selections (project_id, photo_id)
        select project_id, id from public.project_photos where photo_code = '$1'
        on conflict do nothing;" >/dev/null 2>&1
}
for i in $(seq 1 40); do worker "R$i" & done
# Klik ganda paralel pada foto yang sama juga tidak boleh menggandakan.
for i in $(seq 1 10); do worker "R1" & done
wait

COUNT=$(psql "$TEST_URL" -Atc "select count(*) from public.photo_selections where project_id = '30000000-0000-0000-0000-000000000001'")
if [ "$COUNT" != "5" ]; then
  echo "GAGAL race condition: $COUNT pilihan tersimpan, kuota 5" >&2
  exit 1
fi
echo "Race condition: 50 request paralel → tepat 5 pilihan tersimpan (kuota 5). LULUS"
