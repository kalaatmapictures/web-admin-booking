-- =====================================================================
-- KALAATMA — jadwal sync Meta Ads otomatis (setiap hari 06.00 WIB)
-- Jalankan SEKALI di SQL Editor setelah Edge Function meta-ads-sync
-- di-deploy. Ganti dua nilai di bawah:
--   <PROJECT_REF>  → dari URL project: https://<PROJECT_REF>.supabase.co
--   <CRON_SECRET>  → sama persis dengan secret CRON_SECRET di Edge Functions
-- Aman dijalankan ulang (jadwal lama diganti).
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('meta-ads-sync') where exists (select 1 from cron.job where jobname = 'meta-ads-sync');

select cron.schedule(
  'meta-ads-sync',
  '0 23 * * *',            -- 23.00 UTC = 06.00 WIB
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/meta-ads-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body    := jsonb_build_object('days', 3),
    timeout_milliseconds := 120000
  );
  $$
);
