-- Uji perilaku skema: kuota, status seleksi, snapshot, dan RLS.
-- Dijalankan oleh supabase/tests/run-local.sh. Setiap kegagalan menghentikan skrip.
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null

-- Helper: jalankan SQL dan pastikan gagal dengan pesan yang mengandung `expected`.
create or replace function pg_temp.expect_error(sql text, expected text)
returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'DIHARAPKAN GAGAL (%), tetapi berhasil: %', expected, sql;
exception when others then
  if sqlerrm not ilike '%' || expected || '%' then
    raise exception 'Pesan error tidak sesuai. Diharapkan "%", didapat "%" untuk: %', expected, sqlerrm, sql;
  end if;
end $$;

create or replace function pg_temp.expect_eq(actual anyelement, expected anyelement, label text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'GAGAL %: diharapkan %, didapat %', label, expected, actual;
  end if;
end $$;

-- ---------------------------------------------------------------- data uji
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'bukan-admin@test.local');
insert into public.selection_admins (user_id, display_name)
  values ('00000000-0000-0000-0000-00000000000a', 'Admin Uji');

set role service_role;

insert into public.projects (id, client_name, event_type, photo_quota, status) values
  ('10000000-0000-0000-0000-00000000000a', 'Klien A', 'Wedding', 2, 'active'),
  ('10000000-0000-0000-0000-00000000000b', 'Klien B', 'Wisuda', 5, 'active'),
  ('10000000-0000-0000-0000-00000000000c', 'Klien C', 'Family', 5, 'draft');

insert into public.project_photos (id, project_id, drive_file_id, file_name, mime_type, photo_code, is_available) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'driveFileA1xx', 'DSC_0001.jpg', 'image/jpeg', 'DSC_0001', true),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'driveFileA2xx', 'DSC_0002.jpg', 'image/jpeg', 'DSC_0002', true),
  ('20000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-00000000000a', 'driveFileA3xx', 'DSC_0003.jpg', 'image/jpeg', 'DSC_0003', true),
  ('20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'driveFileB1xx', 'IMG_0001.jpg', 'image/jpeg', 'IMG_0001', true),
  ('20000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-00000000000b', 'driveFileB2xx', 'IMG_0002.jpg', 'image/jpeg', 'IMG_0002', false),
  ('20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000c', 'driveFileC1xx', 'IMG_0001.jpg', 'image/jpeg', 'IMG_0001', true);

-- ------------------------------------------------- sinkronisasi tanpa duplikasi
select pg_temp.expect_error(
  $$insert into public.project_photos (project_id, drive_file_id, file_name, mime_type, photo_code)
    values ('10000000-0000-0000-0000-00000000000a', 'driveFileA1xx', 'lagi.jpg', 'image/jpeg', 'LAGI')$$,
  'project_photos_drive_file_unique');
select pg_temp.expect_error(
  $$insert into public.project_photos (project_id, drive_file_id, file_name, mime_type, photo_code)
    values ('10000000-0000-0000-0000-00000000000a', 'driveFileA9xx', 'x.pdf', 'application/pdf', 'X')$$,
  'check constraint');
select pg_temp.expect_error(
  $$update public.projects set gallery_token_hash = 'token-mentah' where id = '10000000-0000-0000-0000-00000000000a'$$,
  'check constraint');

-- ------------------------------------------------------------- kuota & pilihan
insert into public.photo_selections (project_id, photo_id)
  values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1');
-- Klik ganda: tidak error dan tidak menggandakan.
insert into public.photo_selections (project_id, photo_id)
  values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1');
insert into public.photo_selections (project_id, photo_id)
  values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1')
  on conflict (project_id, photo_id) do nothing;
select pg_temp.expect_eq((select count(*) from public.photo_selections where project_id = '10000000-0000-0000-0000-00000000000a'), 1::bigint, 'pilihan ganda diabaikan');

insert into public.photo_selections (project_id, photo_id)
  values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2');
-- Kuota penuh: memilih ulang foto yang sudah dipilih tetap aman.
insert into public.photo_selections (project_id, photo_id)
  values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2');
select pg_temp.expect_error(
  $$insert into public.photo_selections (project_id, photo_id)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a3')$$,
  'QUOTA_EXCEEDED');

-- Foto proyek lain, foto tidak tersedia, proyek draft.
select pg_temp.expect_error(
  $$insert into public.photo_selections (project_id, photo_id)
    values ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000a3')$$,
  'PHOTO_NOT_AVAILABLE');
select pg_temp.expect_error(
  $$insert into public.photo_selections (project_id, photo_id)
    values ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b2')$$,
  'PHOTO_NOT_AVAILABLE');
select pg_temp.expect_error(
  $$insert into public.photo_selections (project_id, photo_id)
    values ('10000000-0000-0000-0000-00000000000c', '20000000-0000-0000-0000-0000000000c1')$$,
  'PROJECT_NOT_ACTIVE');
select pg_temp.expect_error(
  $$update public.photo_selections set selected_at = now()$$,
  'SELECTION_IMMUTABLE');

-- ------------------------------------------------------------------ finalisasi
select pg_temp.expect_error(
  $$select public.submit_selection('10000000-0000-0000-0000-00000000000b')$$,
  'SELECTION_EMPTY');

select pg_temp.expect_eq(
  (select (s).submission_number from (select public.submit_selection('10000000-0000-0000-0000-00000000000a', '  Terima kasih  ') as s) x),
  1, 'submission pertama');
select pg_temp.expect_eq((select selection_status::text from public.projects where id = '10000000-0000-0000-0000-00000000000a'), 'submitted', 'status submitted');
select pg_temp.expect_eq((select photo_count from public.selection_submissions where submission_number = 1), 2, 'jumlah snapshot');
select pg_temp.expect_eq((select client_note from public.selection_submissions where submission_number = 1), 'Terima kasih', 'catatan di-trim');
select pg_temp.expect_eq((select photos->0->>'photo_code' from public.selection_submissions where submission_number = 1), 'DSC_0001', 'urutan snapshot');

-- Setelah submit, klien tidak bisa mengubah apa pun.
select pg_temp.expect_error(
  $$delete from public.photo_selections where photo_id = '20000000-0000-0000-0000-0000000000a1'$$,
  'SELECTION_CLOSED');
select pg_temp.expect_error(
  $$select public.submit_selection('10000000-0000-0000-0000-00000000000a')$$,
  'SELECTION_CLOSED');
select pg_temp.expect_error(
  $$update public.selection_submissions set photo_count = 0$$,
  'SUBMISSION_IMMUTABLE');

-- Admin membuka kembali → klien boleh mengubah → submission kedua.
update public.projects set selection_status = 'open' where id = '10000000-0000-0000-0000-00000000000a';
delete from public.photo_selections where photo_id = '20000000-0000-0000-0000-0000000000a2';
insert into public.photo_selections (project_id, photo_id)
  values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_eq(
  (select (s).submission_number from (select public.submit_selection('10000000-0000-0000-0000-00000000000a') as s) x),
  2, 'submission kedua');
select pg_temp.expect_eq((select photos->1->>'photo_code' from public.selection_submissions where submission_number = 2), 'DSC_0003', 'snapshot kedua');

-- Kunci oleh admin juga menghentikan klien.
update public.projects set selection_status = 'locked' where id = '10000000-0000-0000-0000-00000000000b';
select pg_temp.expect_error(
  $$insert into public.photo_selections (project_id, photo_id)
    values ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1')$$,
  'SELECTION_CLOSED');

reset role;

-- ------------------------------------------------------------------------ RLS
-- anon: tidak ada akses sama sekali.
set role anon;
select pg_temp.expect_error($$select count(*) from public.projects$$, 'permission denied');
select pg_temp.expect_error($$select count(*) from public.project_photos$$, 'permission denied');
select pg_temp.expect_error($$select count(*) from public.photo_selections$$, 'permission denied');
select pg_temp.expect_error($$select count(*) from public.selection_submissions$$, 'permission denied');
select pg_temp.expect_error($$select public.is_selection_admin()$$, 'permission denied');
select pg_temp.expect_error($$select public.submit_selection('10000000-0000-0000-0000-00000000000a')$$, 'permission denied');
reset role;

-- authenticated tetapi bukan admin: tidak melihat apa pun, tidak bisa menulis.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect_eq(public.is_selection_admin(), false, 'bukan admin');
select pg_temp.expect_eq((select count(*) from public.projects), 0::bigint, 'bukan admin: proyek');
select pg_temp.expect_eq((select count(*) from public.project_photos), 0::bigint, 'bukan admin: foto');
select pg_temp.expect_eq((select count(*) from public.selection_admins), 0::bigint, 'bukan admin: daftar admin');
select pg_temp.expect_error(
  $$insert into public.projects (client_name, event_type, photo_quota) values ('X', 'Y', 10)$$,
  'row-level security');
reset role;

-- admin: membaca semua, membuat & mengubah proyek, tidak bisa menghapus / memilih foto.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.expect_eq(public.is_selection_admin(), true, 'admin');
select pg_temp.expect_eq((select count(*) from public.projects), 3::bigint, 'admin: proyek');
select pg_temp.expect_eq((select count(*) from public.selection_submissions), 2::bigint, 'admin: submission');
insert into public.projects (id, client_name, event_type, photo_quota)
  values ('10000000-0000-0000-0000-00000000000d', 'Klien D', 'Prewedding', 50);
select pg_temp.expect_eq(
  (select created_by from public.projects where id = '10000000-0000-0000-0000-00000000000d'),
  '00000000-0000-0000-0000-00000000000a'::uuid, 'created_by otomatis');
update public.projects set status = 'archived', archived_at = now()
  where id = '10000000-0000-0000-0000-00000000000d';
select pg_temp.expect_eq(
  (select updated_at > created_at from public.projects where id = '10000000-0000-0000-0000-00000000000d'),
  true, 'updated_at diperbarui');
delete from public.projects where id = '10000000-0000-0000-0000-00000000000d';
select pg_temp.expect_eq((select count(*) from public.projects where id = '10000000-0000-0000-0000-00000000000d'), 1::bigint, 'admin tidak bisa menghapus');
update public.projects set selection_status = 'open' where id = '10000000-0000-0000-0000-00000000000b';
select pg_temp.expect_error(
  $$insert into public.photo_selections (project_id, photo_id)
    values ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1')$$,
  'row-level security');
select pg_temp.expect_error($$select public.submit_selection('10000000-0000-0000-0000-00000000000b')$$, 'permission denied');
reset role;
reset request.jwt.claim.sub;

-- ------------------------------------------- hapus proyek (cascade) tetap jalan
delete from public.projects where id = '10000000-0000-0000-0000-00000000000a';
select pg_temp.expect_eq((select count(*) from public.photo_selections where project_id = '10000000-0000-0000-0000-00000000000a'), 0::bigint, 'cascade pilihan');
select pg_temp.expect_eq((select count(*) from public.selection_submissions where project_id = '10000000-0000-0000-0000-00000000000a'), 0::bigint, 'cascade submission');

\echo 'schema_test.sql: SEMUA UJI LULUS'
