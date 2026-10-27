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
-- TASK BOARD (ala Trello) — board → kolom (list) → kartu tugas.
-- Sinkron dengan Joblist: setiap kali booking masuk ke tahap baru
-- (Booking, Onboarding, Event, Delivery, Done), tugas SOP tahap itu
-- dibuat otomatis di board project dari tabel task_templates.
-- ---------------------------------------------------------------------
create table if not exists public.task_boards (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text not null default '#4A46E0',
  position   double precision not null default 0,
  is_project boolean not null default false,       -- tugas otomatis dari Joblist masuk ke board ini
  labels     jsonb not null default '[]',           -- [{id, name, color}]
  created_at timestamptz not null default now()
);
create unique index if not exists task_boards_one_project on public.task_boards (is_project) where is_project;

create table if not exists public.task_lists (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references public.task_boards (id) on delete cascade,
  name       text not null,
  position   double precision not null default 0,
  is_done    boolean not null default false,        -- kartu di kolom ini dihitung selesai
  created_at timestamptz not null default now()
);
create index if not exists task_lists_board_idx on public.task_lists (board_id);

-- SOP per tahap Joblist — bisa diubah dari halaman Task → Template SOP
create table if not exists public.task_templates (
  id          uuid primary key default gen_random_uuid(),
  stage       text not null check (stage in ('BOOKING','ONBOARDING','EVENT','DELIVERY','DONE')),
  title       text not null,
  description text,
  checklist   jsonb not null default '[]',          -- ["langkah 1", "langkah 2"]
  role        text check (role in ('PHOTOGRAPHER','VIDEOGRAPHER')),   -- otomatis ditugaskan ke crew booking
  due_anchor  text not null default 'STAGE' check (due_anchor in ('STAGE','SESSION')),
  due_offset  integer,                               -- hari dari masuk tahap / dari tanggal sesi; null = tanpa deadline
  priority    text not null default 'NORMAL' check (priority in ('LOW','NORMAL','HIGH','URGENT')),
  position    double precision not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.tasks (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  board_id               uuid not null references public.task_boards (id) on delete cascade,
  list_id                uuid not null references public.task_lists (id) on delete cascade,
  position               double precision not null default 0,
  title                  text not null,
  description            text,
  booking_id             uuid references public.bookings (id) on delete cascade,
  stage                  text,                       -- tahap Joblist asal tugas otomatis
  template_id            uuid references public.task_templates (id) on delete set null,
  role                   text,
  assignee_freelancer_id uuid references public.freelancers (id) on delete set null,
  assignee_admin_id      uuid references public.admins (user_id) on delete set null,
  due_date               date,
  priority               text not null default 'NORMAL' check (priority in ('LOW','NORMAL','HIGH','URGENT')),
  labels                 text[] not null default '{}',
  checklist              jsonb not null default '[]', -- [{id, text, done}]
  done                   boolean not null default false,
  done_at                timestamptz
);
create index if not exists tasks_list_idx on public.tasks (list_id, position);
create index if not exists tasks_booking_idx on public.tasks (booking_id);
-- satu template hanya sekali per booking, walau booking bolak-balik antar tahap
create unique index if not exists tasks_booking_template_uq on public.tasks (booking_id, template_id)
  where booking_id is not null and template_id is not null;

create table if not exists public.task_comments (
  id        uuid primary key default gen_random_uuid(),
  task_id   uuid not null references public.tasks (id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users (id),
  author    text not null,
  body      text not null,
  at        timestamptz not null default now()
);
create index if not exists task_comments_task_idx on public.task_comments (task_id);

create or replace function public.tasks_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.done and (tg_op = 'INSERT' or not old.done) then new.done_at := now(); end if;
  if not new.done then new.done_at := null; end if;
  return new;
end $$;
drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before insert or update on public.tasks
  for each row execute function public.tasks_touch();

/* Tahap Joblist dari status booking — sama dengan STAGES di src/stages.js */
create or replace function public.booking_stage(status text)
returns text language sql immutable as $$
  select case
    when status in ('NEW','CONTACTED','WAITING_DP') then 'BOOKING'
    when status = 'CONFIRMED'                       then 'ONBOARDING'
    when status = 'BOOKED'                          then 'EVENT'
    when status in ('EVENT_DONE','DELIVERED')       then 'DELIVERY'
    when status = 'COMPLETED'                       then 'DONE'
  end
$$;

/* Buat tugas SOP tahap booking saat ini di kolom pertama board project */
create or replace function public.seed_stage_tasks(b public.bookings)
returns void language plpgsql security definer set search_path = public as $$
declare st text; brd uuid; lst uuid; base double precision;
begin
  st := booking_stage(b.status);
  if st is null then return; end if;
  select id into brd from task_boards where is_project limit 1;
  if brd is null then return; end if;
  select id into lst from task_lists where board_id = brd and not is_done order by position limit 1;
  if lst is null then return; end if;
  select coalesce(max(position), 0) into base from tasks where list_id = lst;

  insert into tasks (board_id, list_id, position, title, description, booking_id, stage, template_id,
                     role, assignee_freelancer_id, due_date, priority, checklist)
  select brd, lst, base + row_number() over (order by t.position, t.created_at),
         t.title, t.description, b.id, st, t.id, t.role,
         case t.role when 'PHOTOGRAPHER' then b.photographer_id when 'VIDEOGRAPHER' then b.videographer_id end,
         case when t.due_offset is null then null
              when t.due_anchor = 'SESSION' then b.session_date + t.due_offset
              else today_wib() + t.due_offset end,
         t.priority,
         (select coalesce(jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'text', x, 'done', false)), '[]')
            from jsonb_array_elements_text(t.checklist) x)
    from task_templates t
   where t.stage = st and t.is_active
  on conflict (booking_id, template_id) where booking_id is not null and template_id is not null do nothing;
end $$;

/* Joblist → Task: tahap baru = tugas baru; crew diganti = tugas crew ikut pindah */
create or replace function public.bookings_sync_tasks()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    perform seed_stage_tasks(new);
  end if;
  if tg_op = 'UPDATE' then
    if new.photographer_id is distinct from old.photographer_id then
      update tasks set assignee_freelancer_id = new.photographer_id
       where booking_id = new.id and role = 'PHOTOGRAPHER' and not done
         and (assignee_freelancer_id is null or assignee_freelancer_id = old.photographer_id);
    end if;
    if new.videographer_id is distinct from old.videographer_id then
      update tasks set assignee_freelancer_id = new.videographer_id
       where booking_id = new.id and role = 'VIDEOGRAPHER' and not done
         and (assignee_freelancer_id is null or assignee_freelancer_id = old.videographer_id);
    end if;
  end if;
  return null;
end $$;
/* tombol "Terapkan SOP" di detail booking: lengkapi tugas tahap saat ini */
create or replace function public.apply_stage_tasks(p_booking uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Hanya admin' using errcode = '42501'; end if;
  perform seed_stage_tasks(b) from bookings b where b.id = p_booking;
end $$;
revoke execute on function public.seed_stage_tasks(public.bookings) from public, anon, authenticated;
revoke execute on function public.apply_stage_tasks(uuid) from public, anon;
grant execute on function public.apply_stage_tasks(uuid) to authenticated;

drop trigger if exists bookings_tasks on public.bookings;
create trigger bookings_tasks after insert or update on public.bookings
  for each row execute function public.bookings_sync_tasks();

/* Board, kolom, label, dan SOP bawaan — hanya diisi bila masih kosong */
do $$
declare brd uuid;
begin
  if not exists (select 1 from public.task_boards) then
    insert into public.task_boards (name, color, position, is_project, labels)
    values ('Produksi Project', '#4A46E0', 1, true,
      '[{"id":"urgent","name":"Urgent","color":"red"},{"id":"client","name":"Client","color":"blue"},
        {"id":"crew","name":"Crew","color":"teal"},{"id":"editing","name":"Editing","color":"orange"},
        {"id":"finance","name":"Keuangan","color":"green"}]')
    returning id into brd;
    insert into public.task_lists (board_id, name, position, is_done) values
      (brd, 'To Do', 1, false), (brd, 'Dikerjakan', 2, false), (brd, 'Review', 3, false), (brd, 'Selesai', 4, true);

    insert into public.task_boards (name, color, position, labels)
    values ('Marketing & Konten', '#E8951F', 2,
      '[{"id":"ig","name":"Instagram","color":"orange"},{"id":"tiktok","name":"TikTok","color":"teal"},
        {"id":"ads","name":"Iklan","color":"red"},{"id":"vendor","name":"Kolaborasi","color":"blue"}]')
    returning id into brd;
    insert into public.task_lists (board_id, name, position, is_done) values
      (brd, 'Ide', 1, false), (brd, 'Produksi Konten', 2, false), (brd, 'Terjadwal', 3, false), (brd, 'Terbit', 4, true);

    insert into public.task_boards (name, color, position, labels)
    values ('Operasional Studio', '#137285', 3,
      '[{"id":"gear","name":"Gear","color":"teal"},{"id":"admin","name":"Admin","color":"grey"},
        {"id":"finance","name":"Keuangan","color":"green"}]')
    returning id into brd;
    insert into public.task_lists (board_id, name, position, is_done) values
      (brd, 'To Do', 1, false), (brd, 'Dikerjakan', 2, false), (brd, 'Selesai', 3, true);
  end if;

  if not exists (select 1 from public.task_templates) then
    insert into public.task_templates (stage, title, checklist, role, due_anchor, due_offset, priority, position) values
      ('BOOKING',    'Follow up client via WhatsApp',          '["Sapa & ucapkan terima kasih","Konfirmasi tanggal, jam, lokasi","Jawab pertanyaan paket"]', null, 'STAGE', 0, 'HIGH', 1),
      ('BOOKING',    'Kirim invoice & tagih DP',               '["Kirim invoice","Kirim nomor rekening","Ingatkan batas waktu DP"]', null, 'STAGE', 1, 'HIGH', 2),
      ('BOOKING',    'Catat DP masuk & konfirmasi booking',    '[]', null, 'STAGE', 3, 'NORMAL', 3),
      ('ONBOARDING', 'Pastikan crew lengkap',                  '["Photographer","Videographer","Kirim brief assignment ke crew"]', null, 'STAGE', 1, 'HIGH', 1),
      ('ONBOARDING', 'Briefing konsep dengan client',          '["Moodboard / referensi","Rundown acara","Daftar foto wajib (must-have shots)","Kontak PIC di lokasi"]', null, 'SESSION', -14, 'NORMAL', 2),
      ('ONBOARDING', 'Survey / konfirmasi lokasi',             '["Cek titik lokasi","Cek izin & biaya lokasi","Cek parkir & akses"]', null, 'SESSION', -7, 'NORMAL', 3),
      ('EVENT',      'Persiapan gear foto',                    '["Charge baterai","Format memory card","Bersihkan lensa","Cek lighting"]', 'PHOTOGRAPHER', 'SESSION', -1, 'HIGH', 1),
      ('EVENT',      'Persiapan gear video',                   '["Charge baterai","Format memory card","Cek audio / mic","Cek gimbal / drone"]', 'VIDEOGRAPHER', 'SESSION', -1, 'HIGH', 2),
      ('EVENT',      'Konfirmasi ulang H-1 ke client & crew',  '["Jam kumpul crew","Titik lokasi","Kontak PIC"]', null, 'SESSION', -1, 'HIGH', 3),
      ('EVENT',      'Backup file mentah setelah sesi',        '["Backup ke hardisk","Upload raw ke Drive","Isi link raw di booking"]', 'PHOTOGRAPHER', 'SESSION', 1, 'URGENT', 4),
      ('DELIVERY',   'Culling foto',                           '[]', 'PHOTOGRAPHER', 'STAGE', 3, 'NORMAL', 1),
      ('DELIVERY',   'Editing foto',                           '["Color grading","Retouch foto pilihan","Export & cek kualitas"]', null, 'STAGE', 10, 'NORMAL', 2),
      ('DELIVERY',   'Editing video',                          '["Rough cut","Musik & color grading","Revisi client"]', 'VIDEOGRAPHER', 'STAGE', 14, 'NORMAL', 3),
      ('DELIVERY',   'Upload hasil & isi link deliverable',    '["Upload foto final","Upload video final","Isi link di detail booking","Kirim link ke client"]', null, 'STAGE', 14, 'HIGH', 4),
      ('DELIVERY',   'Tagih pelunasan',                        '[]', null, 'STAGE', 14, 'HIGH', 5),
      ('DONE',       'Minta testimoni & review Google',        '["Kirim link review Google","Minta izin posting portofolio"]', null, 'STAGE', 3, 'NORMAL', 1),
      ('DONE',       'Arsip file project',                     '["Pindahkan ke hardisk arsip","Hapus file sementara"]', null, 'STAGE', 14, 'LOW', 2);

    -- booking yang sedang berjalan langsung mendapat tugas tahapnya
    perform public.seed_stage_tasks(b) from public.bookings b where b.status not in ('COMPLETED','CANCELLED');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- HAK AKSES (RLS + grant)
-- ---------------------------------------------------------------------
-- tabel internal: hanya admin, lewat login
do $$
declare t text;
begin
  foreach t in array array['admins','package_costs','freelancers','payments','crew_fees','transactions','leads','clients',
                           'task_boards','task_lists','task_templates','tasks','task_comments'] loop
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
