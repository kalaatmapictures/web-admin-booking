-- =====================================================================
-- KALAATMA — skema Supabase bersama
--   • landing page  (repo form-booking)       : baca menu, kirim booking
--   • web admin BMS (repo web-admin-booking)  : semua tabel, khusus admin
--
-- Jalankan sekali di Supabase: Dashboard → SQL Editor → tempel file ini → Run.
-- Aman dijalankan ulang (idempotent) untuk memperbarui fungsi, view, dan policy.
-- =====================================================================

-- tanggal "hari ini" mengikuti WIB, bukan UTC server
create or replace function public.today_wib()
returns date language sql stable as $$ select (now() at time zone 'Asia/Jakarta')::date $$;

-- ---------------------------------------------------------------------
-- ADMIN
-- Akun dibuat di Authentication → Users, lalu didaftarkan di sini:
--   insert into public.admins (user_id, name)
--   select id, 'Nama Admin' from auth.users where email = 'admin@contoh.com';
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- MENU LANDING PAGE — satu dokumen JSON (key 'catalog').
-- Format: src/shared/catalog.js (identik di kedua repo).
-- Sumber tunggal harga paket untuk landing page, BMS, dan validasi booking.
-- ---------------------------------------------------------------------
create table if not exists public.app_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id)
);

-- updated_at selalu berubah → dipakai admin untuk mendeteksi dua admin mengedit bersamaan
create or replace function public.touch_config()
returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists app_config_touch on public.app_config;
create trigger app_config_touch before update on public.app_config
  for each row execute function public.touch_config();

-- HPP per paket (id paket dari menu). Tidak pernah tampil ke pelanggan.
create table if not exists public.package_costs (
  package_id   text primary key,
  hpp_estimate bigint not null default 0 check (hpp_estimate >= 0),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- FREELANCER
-- ---------------------------------------------------------------------
create table if not exists public.freelancers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  role       text not null default 'PHOTOGRAPHER'
             check (role in ('PHOTOGRAPHER','VIDEOGRAPHER','EDITOR','ASSISTANT','WCC','OTHER')),
  whatsapp   text,
  email      text,
  rate       bigint not null default 0 check (rate >= 0),
  rate_type  text not null default 'PER_PROJECT' check (rate_type in ('PER_PROJECT','PER_HOUR','PER_DAY')),
  is_active  boolean not null default true,
  gear       text[] not null default '{}',
  created_at timestamptz not null default now()
);
-- kolom rate/rate_type di atas tidak dipakai lagi; rate kini per event di freelancer_rates

/* Daftar pilihan yang bisa diatur admin: jenis rate (Per Project, Per Jam, …)
   dan event (Wedding, Graduation, …). */
create table if not exists public.freelancer_options (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('RATE_TYPE','EVENT')),
  label      text not null check (length(trim(label)) > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (kind, label)
);
insert into public.freelancer_options (kind, label, sort_order) values
  ('RATE_TYPE','Per Project',1), ('RATE_TYPE','Per Jam',2), ('RATE_TYPE','Per Hari',3),
  ('EVENT','Umum',0), ('EVENT','Wedding',1), ('EVENT','Prewedding',2), ('EVENT','Engagement',3),
  ('EVENT','Graduation',4), ('EVENT','Family',5), ('EVENT','Maternity',6)
on conflict (kind, label) do nothing;

/* Satu freelancer bisa punya beberapa rate, berbeda per event.
   event & rate_type disimpan sebagai teks label supaya rate lama tetap
   terbaca walau pilihannya dihapus. Peran (role) per rate membuat satu
   freelancer bisa ditugaskan di beberapa peran. */
create table if not exists public.freelancer_rates (
  id            uuid primary key default gen_random_uuid(),
  freelancer_id uuid not null references public.freelancers (id) on delete cascade,
  event         text not null,
  rate_type     text not null,
  rate          bigint not null default 0 check (rate >= 0),
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists freelancer_rates_fl_idx on public.freelancer_rates (freelancer_id);
-- satu freelancer bisa memegang beberapa peran; rate dicatat per peran
alter table public.freelancer_rates add column if not exists role text
  check (role in ('PHOTOGRAPHER','VIDEOGRAPHER','EDITOR','ASSISTANT','WCC','OTHER'));
update public.freelancer_rates r set role = f.role
  from public.freelancers f where f.id = r.freelancer_id and r.role is null;

-- pindahkan rate lama (satu rate per freelancer) menjadi rate event "Umum", sekali saja
insert into public.freelancer_rates (freelancer_id, event, rate_type, rate)
select f.id, 'Umum',
       case f.rate_type when 'PER_HOUR' then 'Per Jam' when 'PER_DAY' then 'Per Hari' else 'Per Project' end,
       f.rate
  from public.freelancers f
 where f.rate > 0
   and not exists (select 1 from public.freelancer_rates r where r.freelancer_id = f.id);
update public.freelancers set rate = 0 where rate > 0;

-- ---------------------------------------------------------------------
-- BOOKING — dibuat pelanggan dari landing page, dikelola di BMS
-- ---------------------------------------------------------------------
create sequence if not exists public.invoice_seq;

create table if not exists public.bookings (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  booking_id           text not null unique,
  source               text not null default 'website',
  status               text not null default 'NEW'
                       check (status in ('NEW','CONTACTED','WAITING_DP','CONFIRMED','BOOKED','EVENT_DONE','DELIVERED','COMPLETED','CANCELLED')),

  -- dari landing page
  service              text not null,
  service_id           text,
  sub_category         text,
  package_id           text,
  package_name         text not null,
  package_price        bigint not null default 0,          -- harga master saat booking (sudah × orang bila per orang)
  add_ons              jsonb not null default '[]',
  add_on_price         bigint not null default 0,
  number_of_people     integer,
  session_date         date not null,
  session_time         time not null,
  session_end_time     time,
  location             text not null,
  map_link             text,
  latitude             double precision,
  longitude            double precision,
  whatsapp             text not null,
  notes                text,
  estimated_total      bigint,                              -- snapshot estimasi yang dilihat pelanggan
  estimated_dp         bigint,
  estimated_remaining  bigint,
  bride_name           text,
  bride_instagram      text,
  groom_name           text,
  groom_instagram      text,
  client_name          text,
  client_instagram     text,

  -- dikelola di BMS
  custom_package_price bigint,                              -- null = pakai harga master
  additional_charge    bigint not null default 0,
  extra_time_charge    bigint not null default 0,
  transport_charge     bigint not null default 0,
  other_charge         bigint not null default 0,
  discount             bigint not null default 0,
  hpp_snapshot         bigint not null default 0,
  photographer_id      uuid references public.freelancers (id) on delete set null,
  videographer_id      uuid references public.freelancers (id) on delete set null,
  needs_photographer   boolean not null default true,
  needs_videographer   boolean not null default true,
  crew_override_note   text,
  photo_drive_link     text,
  video_drive_link     text,
  raw_file_link        text,
  final_file_link      text,
  delivery_date        date,
  invoice_number       text unique,
  payment_due_date     date,
  gcal_event_id        text,
  labels               text[] not null default '{}',

  constraint bookings_end_after_start check (session_end_time is null or session_end_time > session_time)
);
create index if not exists bookings_session_date_idx on public.bookings (session_date);
create index if not exists bookings_status_idx on public.bookings (status);

/* Booking baru: harga dihitung ulang dari menu di server, jadi pelanggan
   tidak bisa mengirim harga sendiri. HPP disalin dari package_costs. */
create or replace function public.bookings_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cat jsonb; svc jsonb; pkg jsonb; addon jsonb; item jsonb;
  addons jsonb := '[]'; addon_total bigint := 0; qty int; price bigint; pct numeric; hpp bigint;
begin
  if auth.role() = 'anon' then
    new.status := 'NEW';
    new.source := 'website';
  end if;

  select value into cat from app_config where key = 'catalog';
  if cat is not null and new.package_id is not null then
    select s into svc from jsonb_array_elements(cat->'services') s where s->>'id' = new.service_id;
    if svc is null or coalesce((svc->>'hidden')::boolean, false) then
      raise exception 'Layanan tidak tersedia' using errcode = 'P0001';
    end if;
    select p into pkg
      from jsonb_array_elements(svc->'groups') g, jsonb_array_elements(g->'packages') p
     where p->>'id' = new.package_id;
    if pkg is null or coalesce((pkg->>'hidden')::boolean, false) then
      raise exception 'Paket tidak tersedia' using errcode = 'P0001';
    end if;

    price := (pkg->>'price')::bigint;
    if coalesce((pkg->>'perPerson')::boolean, false) then
      price := price * greatest(coalesce(new.number_of_people, 1), 1);
    end if;
    new.service := svc->>'label';
    new.package_name := pkg->>'name';
    new.package_price := price;

    for item in select * from jsonb_array_elements(coalesce(new.add_ons, '[]')) loop
      select x into addon from jsonb_array_elements(svc->'addons') x where x->>'id' = item->>'id';
      if addon is null or coalesce((addon->>'hidden')::boolean, false) then
        raise exception 'Add-on tidak tersedia' using errcode = 'P0001';
      end if;
      qty := case when coalesce((addon->>'qty')::boolean, false)
                  then least(greatest(coalesce((item->>'qty')::int, 1), 1), 99) else 1 end;
      addons := addons || jsonb_build_object(
        'id', addon->>'id', 'name', addon->>'name', 'qty', qty,
        'unit_price', (addon->>'price')::bigint, 'total', (addon->>'price')::bigint * qty);
      addon_total := addon_total + (addon->>'price')::bigint * qty;
    end loop;
    new.add_ons := addons;
    new.add_on_price := addon_total;

    pct := coalesce((cat->'settings'->>'dpPercent')::numeric, 40);
    new.estimated_total := price + addon_total;
    new.estimated_dp := round(new.estimated_total * pct / 100);
    new.estimated_remaining := new.estimated_total - new.estimated_dp;
  end if;

  select hpp_estimate into hpp from package_costs where package_id = new.package_id;
  new.hpp_snapshot := coalesce(hpp, 0);
  return new;
end $$;
drop trigger if exists bookings_insert on public.bookings;
create trigger bookings_insert before insert on public.bookings
  for each row execute function public.bookings_before_insert();

/* Nomor invoice terbit otomatis saat booking dikonfirmasi */
create or replace function public.bookings_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.invoice_number is null
     and new.status in ('CONFIRMED','BOOKED','EVENT_DONE','DELIVERED','COMPLETED') then
    new.invoice_number := 'INV-KAL-' || to_char(now() at time zone 'Asia/Jakarta', 'YYYYMM')
                          || '-' || lpad(nextval('public.invoice_seq')::text, 3, '0');
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists bookings_update on public.bookings;
create trigger bookings_update before update on public.bookings
  for each row execute function public.bookings_before_update();

-- ---------------------------------------------------------------------
-- PEMBAYARAN, FEE CREW, KAS
-- ---------------------------------------------------------------------
create table if not exists public.payments (
  id         uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  amount     bigint not null check (amount > 0),
  kind       text not null check (kind in ('DP','INSTALLMENT','SETTLEMENT','REFUND')),
  method     text,
  paid_at    date not null default public.today_wib(),
  created_at timestamptz not null default now()
);
create index if not exists payments_booking_idx on public.payments (booking_id);

create table if not exists public.crew_fees (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references public.bookings (id) on delete cascade,
  freelancer_id uuid references public.freelancers (id) on delete set null,
  role          text,
  fee           bigint not null default 0 check (fee >= 0),
  created_at    timestamptz not null default now()
);
create index if not exists crew_fees_booking_idx on public.crew_fees (booking_id);

create table if not exists public.transactions (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('IN','OUT')),
  amount      bigint not null check (amount > 0),
  category    text,
  description text,
  booking_id  uuid references public.bookings (id) on delete set null,
  payment_id  uuid references public.payments (id) on delete cascade,
  occurred_on date not null default public.today_wib(),
  created_at  timestamptz not null default now()
);
create index if not exists transactions_date_idx on public.transactions (occurred_on desc);

/* Setiap pembayaran booking otomatis tercatat di kas */
create or replace function public.payments_to_kas()
returns trigger language plpgsql security definer set search_path = public as $$
declare label text;
begin
  label := case new.kind when 'DP' then 'DP Booking' when 'INSTALLMENT' then 'Cicilan'
                         when 'SETTLEMENT' then 'Pelunasan' else 'Refund' end;
  insert into transactions (kind, amount, category, description, booking_id, payment_id, occurred_on)
  select case when new.kind = 'REFUND' then 'OUT' else 'IN' end, new.amount, label,
         label || ' — ' || coalesce(b.client_name, nullif(concat_ws(' & ', b.bride_name, b.groom_name), ''), b.booking_id),
         new.booking_id, new.id, new.paid_at
    from bookings b where b.id = new.booking_id;
  return new;
end $$;
drop trigger if exists payments_kas on public.payments;
create trigger payments_kas after insert on public.payments
  for each row execute function public.payments_to_kas();

-- ---------------------------------------------------------------------
-- TASK AFTER EVENT — pekerjaan pasca-event per booking (edit foto, edit
-- video, layout album, …), dikelola di tab Joblist → Task After Event
-- ---------------------------------------------------------------------
create table if not exists public.post_tasks (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.bookings (id) on delete cascade,
  title       text not null check (length(trim(title)) > 0),
  task_type   text,
  assignee_id uuid references public.freelancers (id) on delete set null,
  status      text not null default 'TODO' check (status in ('TODO','IN_PROGRESS','REVIEW','DONE')),
  due_date    date,
  notes       text,
  done_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists post_tasks_booking_idx on public.post_tasks (booking_id);

-- ---------------------------------------------------------------------
-- LEAD & CLIENT
-- ---------------------------------------------------------------------
create table if not exists public.leads (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  whatsapp        text,
  email           text,
  category        text,
  source          text,
  status          text not null default 'NEW'
                  check (status in ('NEW','CONTACTED','QUALIFIED','NEGOTIATION','WON','LOST')),
  follow_up_date  date,
  estimated_value bigint not null default 0,
  notes           text,
  created_at      timestamptz not null default now()
);

create table if not exists public.clients (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  whatsapp          text,
  email             text,
  instagram         text,
  drive_folder_link text,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- LOG AKTIVITAS ADMIN (append-only)
-- ---------------------------------------------------------------------
create table if not exists public.admin_activity (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  actor_id uuid not null default auth.uid() references auth.users (id),
  actor    text not null,
  action   text not null check (action in ('create','update','status','delete','hide','show','reorder','system')),
  entity   text not null,
  target   text not null,
  detail   text
);
create index if not exists admin_activity_at_idx on public.admin_activity (at desc);

-- ---------------------------------------------------------------------
-- VIEW — kolom turunan (total, DP, status bayar, crew, profit) untuk BMS
-- security_invoker: view tunduk pada RLS tabel di bawahnya.
-- ---------------------------------------------------------------------
create or replace view public.v_bookings_board with (security_invoker = true) as
select
  b.*,
  coalesce(b.client_name, nullif(concat_ws(' & ', b.bride_name, b.groom_name), ''), b.booking_id) as client_display,
  c1.eff                                         as effective_package_price,
  b.package_price                                as master_reference_price,
  c2.subtotal,
  c3.total                                       as total_invoice,
  round(c3.total * c1.dp)::bigint                as dp_amount,
  c1.paid                                        as paid_amount,
  c3.total - c1.paid                             as remaining_payment,
  case when c1.paid <= 0 then 'UNPAID'
       when c1.paid >= c3.total then 'FULLY_PAID'
       when c1.paid >= c3.total * c1.dp then 'DP_PAID'
       else 'PARTIALLY_PAID' end                 as payment_status,
  c4.overdue                                     as payment_overdue,
  c1.crew_cost,
  c3.total - b.hpp_snapshot - c1.crew_cost       as profit,
  c1.crew                                        as crew_status,
  ph.name as photographer_name, ph.whatsapp as photographer_wa, ph.email as photographer_email,
  vg.name as videographer_name, vg.whatsapp as videographer_wa, vg.email as videographer_email,
  c1.deliv_missing                               as delivery_missing,
  (b.gcal_event_id is not null)                  as gcal_synced,
  (c1.crew <> 'COMPLETE' or c4.overdue
     or (b.status in ('EVENT_DONE','DELIVERED') and c1.deliv_missing)) as needs_attention
from public.bookings b
left join public.freelancers ph on ph.id = b.photographer_id
left join public.freelancers vg on vg.id = b.videographer_id
cross join lateral (
  select
    coalesce(b.custom_package_price, b.package_price, 0)::bigint as eff,
    coalesce((select (value->'settings'->>'dpPercent')::numeric from public.app_config where key = 'catalog'), 40) / 100.0 as dp,
    coalesce((select sum(case when p.kind = 'REFUND' then -p.amount else p.amount end)
                from public.payments p where p.booking_id = b.id), 0)::bigint as paid,
    coalesce((select sum(f.fee) from public.crew_fees f where f.booking_id = b.id), 0)::bigint as crew_cost,
    case when (not b.needs_photographer or b.photographer_id is not null)
           and (not b.needs_videographer or b.videographer_id is not null) then 'COMPLETE'
         when b.photographer_id is not null or b.videographer_id is not null then 'PARTIAL'
         else 'NOT_ASSIGNED' end as crew,
    (b.photo_drive_link is null and b.video_drive_link is null and b.final_file_link is null) as deliv_missing
) c1
cross join lateral (select c1.eff + b.add_on_price + b.additional_charge + b.extra_time_charge
                           + b.transport_charge + b.other_charge as subtotal) c2
cross join lateral (select c2.subtotal - b.discount as total) c3
cross join lateral (select (b.payment_due_date is not null and b.payment_due_date < public.today_wib()
                            and c1.paid < c3.total) as overdue) c4;

create or replace view public.v_leads_board with (security_invoker = true) as
select l.*,
  case when l.status in ('WON','LOST') then 'CLOSED'
       when l.follow_up_date is null then 'NONE'
       when l.follow_up_date < public.today_wib() then 'OVERDUE'
       when l.follow_up_date = public.today_wib() then 'TODAY'
       else 'SAFE' end as follow_up_state
from public.leads l;

-- ---------------------------------------------------------------------
-- HAK AKSES (RLS + grant)
-- ---------------------------------------------------------------------
-- tabel internal: hanya admin, lewat login
do $$
declare t text;
begin
  foreach t in array array['admins','package_costs','freelancers','freelancer_options','freelancer_rates','post_tasks','payments','crew_fees','transactions','leads','clients'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists "admin penuh" on public.%I', t);
    execute format('create policy "admin penuh" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- menu: siapa pun boleh membaca katalog, hanya admin yang menulis
alter table public.app_config enable row level security;
revoke all on public.app_config from anon;
grant select on public.app_config to anon;
drop policy if exists "publik membaca katalog" on public.app_config;
create policy "publik membaca katalog" on public.app_config
  for select to anon, authenticated using (key = 'catalog');
drop policy if exists "admin menulis konfigurasi" on public.app_config;
create policy "admin menulis konfigurasi" on public.app_config
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- booking: pelanggan hanya boleh MENGIRIM booking baru, hanya kolom form
alter table public.bookings enable row level security;
revoke all on public.bookings from anon;
grant insert (booking_id, status, service, service_id, sub_category, package_id, package_name, package_price,
              add_ons, add_on_price, number_of_people, session_date, session_time, session_end_time,
              location, map_link, latitude, longitude, whatsapp, notes,
              estimated_total, estimated_dp, estimated_remaining,
              bride_name, bride_instagram, groom_name, groom_instagram, client_name, client_instagram)
  on public.bookings to anon;
drop policy if exists "publik mengirim booking" on public.bookings;
create policy "publik mengirim booking" on public.bookings
  for insert to anon with check (status = 'NEW');
drop policy if exists "admin penuh" on public.bookings;
create policy "admin penuh" on public.bookings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant usage on sequence public.invoice_seq to authenticated;

-- log aktivitas: admin membaca & menambah, tidak bisa mengubah/menghapus
alter table public.admin_activity enable row level security;
revoke all on public.admin_activity from anon;
revoke update, delete, truncate on public.admin_activity from authenticated;
drop policy if exists "admin membaca log" on public.admin_activity;
create policy "admin membaca log" on public.admin_activity
  for select to authenticated using (public.is_admin());
drop policy if exists "admin menambah log" on public.admin_activity;
create policy "admin menambah log" on public.admin_activity
  for insert to authenticated with check (public.is_admin() and actor_id = auth.uid());

revoke all on public.v_bookings_board, public.v_leads_board from anon;
grant select on public.v_bookings_board, public.v_leads_board to authenticated;
