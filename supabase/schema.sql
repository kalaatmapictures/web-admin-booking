-- =========================================================
-- KALAATMA — skema Supabase bersama
-- Dipakai oleh landing page (form-booking) dan web admin
-- (web-admin-booking). Jalankan sekali di Supabase:
-- Dashboard → SQL Editor → tempel seluruh file → Run.
-- =========================================================

-- ---------- Admin ----------
-- Akun dibuat di Authentication → Users, lalu didaftarkan di sini:
--   insert into public.admins (user_id, name)
--   select id, 'Nama Admin' from auth.users where email = 'admin@contoh.com';
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

alter table public.admins enable row level security;
drop policy if exists "admin membaca daftar admin" on public.admins;
create policy "admin membaca daftar admin" on public.admins
  for select to authenticated using (public.is_admin());

-- ---------- Katalog menu (satu dokumen JSON) ----------
-- key = 'catalog' berisi menu landing page; format lihat src/shared/catalog.js.
create table if not exists public.app_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id)
);

-- updated_at selalu diperbarui → dipakai admin untuk mendeteksi bentrok edit
create or replace function public.touch_updated()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists app_config_touch on public.app_config;
create trigger app_config_touch before update on public.app_config
  for each row execute function public.touch_updated();

alter table public.app_config enable row level security;
drop policy if exists "publik membaca katalog" on public.app_config;
create policy "publik membaca katalog" on public.app_config
  for select to anon, authenticated using (key = 'catalog');
drop policy if exists "admin menulis konfigurasi" on public.app_config;
create policy "admin menulis konfigurasi" on public.app_config
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- Log aktivitas admin (append-only) ----------
create table if not exists public.admin_activity (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  actor_id uuid not null default auth.uid() references auth.users (id),
  actor    text not null,
  action   text not null check (action in ('create','update','delete','hide','show','reorder','system')),
  entity   text not null,
  target   text not null,
  detail   text
);
create index if not exists admin_activity_at_idx on public.admin_activity (at desc);

alter table public.admin_activity enable row level security;
drop policy if exists "admin membaca log" on public.admin_activity;
create policy "admin membaca log" on public.admin_activity
  for select to authenticated using (public.is_admin());
drop policy if exists "admin menambah log" on public.admin_activity;
create policy "admin menambah log" on public.admin_activity
  for insert to authenticated with check (public.is_admin() and actor_id = auth.uid());
-- sengaja tidak ada policy update/delete: log tidak bisa diubah atau dihapus

-- ---------- Booking dari landing page ----------
create table if not exists public.bookings (
  id                bigint generated always as identity primary key,
  created_at        timestamptz not null default now(),
  booking_id        text not null unique,
  service           text not null,
  sub_category      text,
  package_name      text not null,
  package_price     integer not null,
  add_ons           jsonb not null default '[]',
  add_on_price      integer not null default 0,
  number_of_people  integer,
  session_date      date not null,
  session_time      time not null,
  session_end_time  time not null,
  location          text not null,
  map_link          text,
  latitude          double precision,
  longitude         double precision,
  whatsapp          text not null,
  notes             text,
  estimated_total   integer not null,
  estimated_dp      integer not null,
  remaining_payment integer not null,
  status            text not null default 'NEW',
  bride_name        text,
  bride_instagram   text,
  groom_name        text,
  groom_instagram   text,
  client_name       text,
  client_instagram  text
);

alter table public.bookings enable row level security;
-- pelanggan (anon) hanya boleh MENGIRIM booking baru, tidak bisa membaca
drop policy if exists "publik mengirim booking" on public.bookings;
create policy "publik mengirim booking" on public.bookings
  for insert to anon, authenticated with check (status = 'NEW');
drop policy if exists "admin membaca booking" on public.bookings;
create policy "admin membaca booking" on public.bookings
  for select to authenticated using (public.is_admin());
drop policy if exists "admin mengubah booking" on public.bookings;
create policy "admin mengubah booking" on public.bookings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
