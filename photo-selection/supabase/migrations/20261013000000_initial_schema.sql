-- =============================================================================
-- Kalaatma Photo Selection — skema awal (Tahap 1)
--
-- Tabel:
--   selection_admins       akun Supabase Auth yang boleh masuk dashboard admin
--   projects               satu proyek = satu sesi foto satu klien
--   project_photos         metadata foto dari folder Google Drive (file asli tetap di Drive)
--   photo_selections       foto yang sedang dipilih klien (state "live")
--   selection_submissions  snapshot permanen setiap kali klien menekan "Selesaikan Seleksi"
--
-- Prinsip keamanan:
--   * RLS aktif di semua tabel. Peran `anon` tidak punya akses apa pun.
--   * Admin (authenticated + terdaftar di selection_admins) mengakses lewat RLS.
--   * Klien galeri TIDAK memakai Supabase langsung. Server Next.js memverifikasi
--     token galeri (hash SHA-256) lalu memakai service role untuk proyek itu saja.
--   * Aturan kuota & status seleksi ditegakkan oleh trigger di database dengan
--     row lock pada proyek, sehingga klik cepat / request paralel tidak bisa
--     melewati kuota.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tipe enum
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.project_status as enum ('draft', 'active', 'archived');
exception when duplicate_object then null; end $$;

-- open      : klien boleh memilih / membatalkan pilihan
-- submitted : klien sudah menekan "Selesaikan Seleksi" (klien tidak bisa mengubah)
-- locked    : admin mengunci seleksi (klien tidak bisa mengubah)
do $$ begin
  create type public.selection_status as enum ('open', 'submitted', 'locked');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Helper: updated_at otomatis
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- selection_admins
-- -----------------------------------------------------------------------------
create table if not exists public.selection_admins (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 100),
  created_at   timestamptz not null default now()
);

comment on table public.selection_admins is
  'Akun Supabase Auth yang boleh mengelola proyek. Ditambahkan manual lewat SQL Editor.';

-- SECURITY DEFINER agar bisa membaca selection_admins tanpa terhalang RLS-nya sendiri.
create or replace function public.is_selection_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.selection_admins where user_id = auth.uid()
  );
$$;

-- -----------------------------------------------------------------------------
-- projects
-- -----------------------------------------------------------------------------
create table if not exists public.projects (
  id                       uuid primary key default gen_random_uuid(),
  client_name              text not null check (char_length(btrim(client_name)) between 1 and 200),
  event_type               text not null check (char_length(btrim(event_type)) between 1 and 100),
  event_date               date,
  internal_notes           text check (internal_notes is null or char_length(internal_notes) <= 5000),

  -- Google Drive (diisi di Tahap 3)
  drive_folder_id          text check (drive_folder_id is null or drive_folder_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  drive_folder_name        text,
  last_synced_at           timestamptz,

  -- Seleksi
  photo_quota              integer not null check (photo_quota between 1 and 10000),
  selection_deadline       timestamptz,
  status                   public.project_status   not null default 'draft',
  selection_status         public.selection_status not null default 'open',
  selection_submitted_at   timestamptz,
  selection_locked_at      timestamptz,

  -- Tautan galeri: hanya HASH SHA-256 (hex) dari token yang disimpan.
  -- NULL = belum ada tautan / tautan sudah dicabut.
  gallery_token_hash       text unique check (gallery_token_hash is null or gallery_token_hash ~ '^[0-9a-f]{64}$'),
  gallery_token_created_at timestamptz,
  gallery_token_revoked_at timestamptz,

  created_by               uuid references auth.users (id) on delete set null default auth.uid(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  archived_at              timestamptz
);

comment on column public.projects.gallery_token_hash is
  'SHA-256 (hex) dari token tautan galeri. Token mentah tidak pernah disimpan.';

create index if not exists projects_status_created_idx on public.projects (status, created_at desc);

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- project_photos
-- -----------------------------------------------------------------------------
create table if not exists public.project_photos (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects (id) on delete cascade,

  drive_file_id     text not null check (drive_file_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  file_name         text not null check (char_length(file_name) between 1 and 500),
  mime_type         text not null check (mime_type like 'image/%'),
  -- Kode yang dilihat klien & diekspor ke CSV (mis. "DSC_1234"). Unik per proyek.
  photo_code        text not null check (char_length(photo_code) between 1 and 200),

  size_bytes        bigint check (size_bytes is null or size_bytes >= 0),
  width             integer check (width is null or width > 0),
  height            integer check (height is null or height > 0),
  md5_checksum      text,
  drive_created_at  timestamptz,
  drive_modified_at timestamptz,
  sort_order        integer not null default 0,

  -- File yang hilang dari Drive tidak dihapus (agar riwayat pilihan tetap utuh),
  -- tetapi ditandai tidak tersedia dan disembunyikan dari galeri.
  is_available      boolean not null default true,
  unavailable_since timestamptz,
  last_seen_at      timestamptz not null default now(),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Sinkronisasi memakai upsert pada (project_id, drive_file_id) → tidak ada duplikasi.
  constraint project_photos_drive_file_unique unique (project_id, drive_file_id),
  constraint project_photos_code_unique       unique (project_id, photo_code),
  -- Target foreign key komposit dari photo_selections.
  constraint project_photos_project_id_id_key unique (project_id, id)
);

create index if not exists project_photos_gallery_idx
  on public.project_photos (project_id, sort_order, file_name)
  where is_available;

drop trigger if exists project_photos_set_updated_at on public.project_photos;
create trigger project_photos_set_updated_at
  before update on public.project_photos
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- photo_selections
-- -----------------------------------------------------------------------------
create table if not exists public.photo_selections (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  photo_id    uuid not null,
  selected_at timestamptz not null default now(),

  -- Satu foto hanya bisa dipilih sekali per proyek.
  constraint photo_selections_unique unique (project_id, photo_id),
  -- Foto wajib milik proyek yang sama (tidak bisa memilih foto proyek lain).
  constraint photo_selections_photo_fkey foreign key (project_id, photo_id)
    references public.project_photos (project_id, id) on delete cascade
);

-- Indeks (project_id, photo_id) dari constraint unik sudah melayani hitungan kuota per proyek.
create index if not exists photo_selections_photo_idx on public.photo_selections (photo_id);

-- Aturan memilih foto. Row lock pada proyek menyerialkan semua perubahan pilihan
-- satu proyek, jadi hitungan kuota selalu akurat walau ada request paralel.
create or replace function public.photo_selections_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_project public.projects%rowtype;
  v_count   integer;
begin
  select * into v_project from public.projects where id = new.project_id for update;
  if not found then
    raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_project.status <> 'active' then
    raise exception 'PROJECT_NOT_ACTIVE' using errcode = 'P0001';
  end if;
  if v_project.selection_status <> 'open' then
    raise exception 'SELECTION_CLOSED' using errcode = 'P0001';
  end if;

  -- Sudah dipilih → abaikan tanpa error (idempoten untuk klik ganda).
  if exists (
    select 1 from public.photo_selections
    where project_id = new.project_id and photo_id = new.photo_id
  ) then
    return null;
  end if;

  if not exists (
    select 1 from public.project_photos
    where id = new.photo_id and project_id = new.project_id and is_available
  ) then
    raise exception 'PHOTO_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  select count(*) into v_count from public.photo_selections where project_id = new.project_id;
  if v_count >= v_project.photo_quota then
    raise exception 'QUOTA_EXCEEDED' using errcode = 'P0001';
  end if;

  new.selected_at := now();
  return new;
end;
$$;

create or replace function public.photo_selections_before_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_project public.projects%rowtype;
begin
  select * into v_project from public.projects where id = old.project_id for update;
  -- Proyek sedang dihapus (cascade) → izinkan.
  if not found then
    return old;
  end if;
  if v_project.status <> 'active' then
    raise exception 'PROJECT_NOT_ACTIVE' using errcode = 'P0001';
  end if;
  if v_project.selection_status <> 'open' then
    raise exception 'SELECTION_CLOSED' using errcode = 'P0001';
  end if;
  return old;
end;
$$;

create or replace function public.photo_selections_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'SELECTION_IMMUTABLE' using errcode = 'P0001';
end;
$$;

drop trigger if exists photo_selections_before_insert on public.photo_selections;
create trigger photo_selections_before_insert
  before insert on public.photo_selections
  for each row execute function public.photo_selections_before_insert();

drop trigger if exists photo_selections_before_delete on public.photo_selections;
create trigger photo_selections_before_delete
  before delete on public.photo_selections
  for each row execute function public.photo_selections_before_delete();

drop trigger if exists photo_selections_before_update on public.photo_selections;
create trigger photo_selections_before_update
  before update on public.photo_selections
  for each row execute function public.photo_selections_before_update();

-- -----------------------------------------------------------------------------
-- selection_submissions
-- -----------------------------------------------------------------------------
create table if not exists public.selection_submissions (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects (id) on delete cascade,
  submission_number integer not null check (submission_number > 0),
  photo_count       integer not null check (photo_count >= 0),
  photo_quota       integer not null check (photo_quota > 0),
  -- Snapshot: [{ "photo_id", "photo_code", "file_name", "drive_file_id" }, ...]
  photos            jsonb not null check (jsonb_typeof(photos) = 'array'),
  client_note       text check (client_note is null or char_length(client_note) <= 2000),
  submitted_at      timestamptz not null default now(),

  constraint selection_submissions_number_unique unique (project_id, submission_number)
);

create index if not exists selection_submissions_project_idx
  on public.selection_submissions (project_id, submitted_at desc);

create or replace function public.selection_submissions_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'SUBMISSION_IMMUTABLE' using errcode = 'P0001';
end;
$$;

drop trigger if exists selection_submissions_immutable on public.selection_submissions;
create trigger selection_submissions_immutable
  before update on public.selection_submissions
  for each row execute function public.selection_submissions_immutable();

-- Finalisasi seleksi dalam satu transaksi: kunci proyek, simpan snapshot,
-- ubah status menjadi 'submitted'. Dipanggil server (service role) setelah
-- token galeri diverifikasi.
create or replace function public.submit_selection(p_project_id uuid, p_client_note text default null)
returns public.selection_submissions
language plpgsql
set search_path = ''
as $$
declare
  v_project    public.projects%rowtype;
  v_submission public.selection_submissions;
  v_photos     jsonb;
  v_count      integer;
  v_note       text := nullif(btrim(p_client_note), '');
begin
  select * into v_project from public.projects where id = p_project_id for update;
  if not found then
    raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_project.status <> 'active' then
    raise exception 'PROJECT_NOT_ACTIVE' using errcode = 'P0001';
  end if;
  if v_project.selection_status <> 'open' then
    raise exception 'SELECTION_CLOSED' using errcode = 'P0001';
  end if;

  select
    count(*),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'photo_id',      p.id,
          'photo_code',    p.photo_code,
          'file_name',     p.file_name,
          'drive_file_id', p.drive_file_id
        )
        order by p.sort_order, p.file_name
      ),
      '[]'::jsonb
    )
  into v_count, v_photos
  from public.photo_selections s
  join public.project_photos p on p.id = s.photo_id and p.project_id = s.project_id
  where s.project_id = p_project_id;

  if v_count = 0 then
    raise exception 'SELECTION_EMPTY' using errcode = 'P0001';
  end if;

  insert into public.selection_submissions
    (project_id, submission_number, photo_count, photo_quota, photos, client_note)
  values (
    p_project_id,
    coalesce((select max(submission_number) from public.selection_submissions
              where project_id = p_project_id), 0) + 1,
    v_count,
    v_project.photo_quota,
    v_photos,
    v_note
  )
  returning * into v_submission;

  update public.projects
     set selection_status = 'submitted',
         selection_submitted_at = v_submission.submitted_at
   where id = p_project_id;

  return v_submission;
end;
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.selection_admins      enable row level security;
alter table public.projects              enable row level security;
alter table public.project_photos        enable row level security;
alter table public.photo_selections      enable row level security;
alter table public.selection_submissions enable row level security;

-- Pertahanan berlapis: anon tidak punya hak apa pun di tabel internal.
revoke all on public.selection_admins, public.projects, public.project_photos,
              public.photo_selections, public.selection_submissions from anon;

drop policy if exists "admin membaca dirinya" on public.selection_admins;
create policy "admin membaca dirinya" on public.selection_admins
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "admin membaca proyek" on public.projects;
create policy "admin membaca proyek" on public.projects
  for select to authenticated
  using ((select public.is_selection_admin()));

drop policy if exists "admin membuat proyek" on public.projects;
create policy "admin membuat proyek" on public.projects
  for insert to authenticated
  with check ((select public.is_selection_admin()));

drop policy if exists "admin mengubah proyek" on public.projects;
create policy "admin mengubah proyek" on public.projects
  for update to authenticated
  using ((select public.is_selection_admin()))
  with check ((select public.is_selection_admin()));
-- Sengaja tidak ada policy DELETE: proyek diarsipkan, bukan dihapus.

drop policy if exists "admin membaca foto" on public.project_photos;
create policy "admin membaca foto" on public.project_photos
  for select to authenticated
  using ((select public.is_selection_admin()));

drop policy if exists "admin membaca pilihan" on public.photo_selections;
create policy "admin membaca pilihan" on public.photo_selections
  for select to authenticated
  using ((select public.is_selection_admin()));

drop policy if exists "admin membaca submission" on public.selection_submissions;
create policy "admin membaca submission" on public.selection_submissions
  for select to authenticated
  using ((select public.is_selection_admin()));

-- -----------------------------------------------------------------------------
-- Hak eksekusi fungsi
-- Supabase memberi EXECUTE ke anon/authenticated secara default; cabut yang tidak perlu.
-- -----------------------------------------------------------------------------
revoke execute on function public.is_selection_admin() from public, anon;
grant  execute on function public.is_selection_admin() to authenticated, service_role;

revoke execute on function public.submit_selection(uuid, text) from public, anon, authenticated;
grant  execute on function public.submit_selection(uuid, text) to service_role;

revoke execute on function public.set_updated_at()                  from public, anon, authenticated;
revoke execute on function public.photo_selections_before_insert()  from public, anon, authenticated;
revoke execute on function public.photo_selections_before_delete()  from public, anon, authenticated;
revoke execute on function public.photo_selections_before_update()  from public, anon, authenticated;
revoke execute on function public.selection_submissions_immutable() from public, anon, authenticated;
