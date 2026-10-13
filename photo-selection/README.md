# Kalaatma Photo Selection

Galeri online agar klien Kalaatma Pictures bisa memilih foto yang akan diedit, tanpa mencatat kode foto
satu per satu. Foto asli tetap di Google Drive; aplikasi ini hanya menyimpan metadata foto, pilihan klien,
dan status seleksi di Supabase.

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Supabase (PostgreSQL + Auth) · Google Drive API · Vercel

## Status pengembangan

| Tahap | Isi | Status |
| --- | --- | --- |
| 1 | Fondasi, skema database, halaman awal | **Selesai** |
| 2 | Dashboard admin (login, kelola proyek) | Belum |
| 3 | Integrasi Google Drive (OAuth, sinkronisasi, thumbnail) | Belum |
| 4 | Galeri klien (pilih foto, kuota real time) | Belum |
| 5 | Finalisasi (submit, CSV, kunci/buka seleksi) | Belum |

## Arsitektur

```
 Klien (tanpa akun) ──  /g/<token>  ──┐
                                      │  Server Next.js (Vercel)
 Admin (login) ──────── /admin ───────┤   • verifikasi token galeri (hash SHA-256)
                                      │   • sesi admin via Supabase Auth (cookie)
                                      │   • rahasia hanya di server
                                      ▼
                     ┌──────────── Supabase ────────────┐        Google Drive
                     │ PostgreSQL + RLS + trigger kuota │        (file asli, privat)
                     └──────────────────────────────────┘              ▲
                                      ▲                                │
                                      └──── server membaca metadata & thumbnail (Tahap 3)
```

Dua jalur akses data:

| Pengguna | Cara akses | Pembatas |
| --- | --- | --- |
| Admin | Klien Supabase dengan sesi login (`src/lib/supabase/server.ts`) | RLS: hanya akun di tabel `selection_admins` |
| Klien galeri | Tidak menyentuh Supabase. Server memverifikasi token → memakai service role (`src/lib/supabase/service.ts`) hanya untuk proyek itu | Validasi token di server + trigger database |

Peran `anon` Supabase tidak punya akses ke tabel apa pun, sehingga anon key yang publik tidak bisa dipakai
untuk membaca data.

### Struktur folder

```
photo-selection/
├── src/
│   ├── app/                      # Routing (App Router)
│   │   ├── layout.tsx            # Layout root: font, metadata, bahasa
│   │   ├── page.tsx              # Halaman awal
│   │   ├── not-found.tsx         # 404 (juga untuk tautan galeri tidak valid)
│   │   ├── icon.svg              # Favicon
│   │   ├── api/health/route.ts   # Cek konfigurasi & koneksi database
│   │   ├── admin/ …              # (Tahap 2) dashboard admin
│   │   └── g/[token]/ …          # (Tahap 4) galeri klien
│   ├── components/
│   │   └── layout/               # Header, footer, container, logo
│   ├── lib/
│   │   ├── env.ts                # Env publik (NEXT_PUBLIC_*)
│   │   ├── env.server.ts         # Env rahasia (server-only)
│   │   └── supabase/
│   │       ├── server.ts         # Klien atas nama admin (RLS berlaku)
│   │       └── service.ts        # Klien service role (melewati RLS, server-only)
│   └── types/database.ts         # Tipe TypeScript skema database
├── supabase/
│   ├── migrations/               # Migrasi SQL (urut berdasarkan nama file)
│   └── tests/                    # Uji skema di PostgreSQL lokal
├── next.config.ts                # Header keamanan, noindex untuk /admin & /g
└── .env.example                  # Daftar environment variables (tanpa nilai)
```

File yang mengimpor `server-only` akan membuat build gagal bila tidak sengaja dipakai di komponen browser —
pengaman agar service role key tidak bocor.

## Skema database

Migrasi: `supabase/migrations/20261013000000_initial_schema.sql` (aman dijalankan ulang).

| Tabel | Isi |
| --- | --- |
| `selection_admins` | Akun Supabase Auth yang boleh masuk dashboard |
| `projects` | Klien, jenis acara, tanggal, folder Drive, kuota, tenggat, `status` (`draft`/`active`/`archived`), `selection_status` (`open`/`submitted`/`locked`), hash token galeri |
| `project_photos` | Metadata file Drive: `drive_file_id`, nama file, MIME, `photo_code`, ukuran, urutan, `is_available` |
| `photo_selections` | Foto yang sedang dipilih klien |
| `selection_submissions` | Snapshot permanen setiap kali klien menyelesaikan seleksi (nomor urut, daftar foto JSON, catatan) |

Aturan yang ditegakkan **di database**, bukan hanya di tampilan:

- **Tanpa duplikasi foto**: unik `(project_id, drive_file_id)` dan `(project_id, photo_code)`.
- **Foto hanya milik proyeknya**: foreign key komposit `(project_id, photo_id)` → foto proyek lain ditolak.
- **Kuota & race condition**: trigger mengunci baris proyek (`SELECT … FOR UPDATE`) lalu menghitung kuota.
  Klik cepat atau request paralel diproses berurutan; pilihan ganda diabaikan tanpa error.
- **Seleksi terkunci**: bila proyek bukan `active` atau seleksi bukan `open`, memilih/membatalkan ditolak.
- **Finalisasi atomik**: fungsi `submit_selection()` menyimpan snapshot dan mengubah status dalam satu
  transaksi. Snapshot tidak bisa diubah.
- **Token galeri**: hanya hash SHA-256 (64 karakter hex) yang bisa disimpan; mencabut tautan = mengosongkan hash.
- **File terhapus di Drive**: foto ditandai `is_available = false`, bukan dihapus, agar riwayat tetap utuh.
- **RLS**: admin hanya bisa membaca semua tabel serta membuat/mengubah proyek. Tidak ada policy DELETE
  untuk proyek (diarsipkan, bukan dihapus).

Kode error dari database (untuk ditampilkan dengan ramah di tahap berikutnya): `QUOTA_EXCEEDED`,
`SELECTION_CLOSED`, `PROJECT_NOT_ACTIVE`, `PHOTO_NOT_AVAILABLE`, `SELECTION_EMPTY`, `PROJECT_NOT_FOUND`.

## Environment variables

Salin `.env.example` menjadi `.env.local` lalu isi nilainya. Jangan commit `.env.local`.

| Variabel | Wajib | Rahasia? | Keterangan |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Ya | Tidak | URL project Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Ya | Tidak | Anon key (atau *publishable key* `sb_publishable_…`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Ya | **Ya** | Service role key (atau *secret key* `sb_secret_…`). Hanya server |
| `NEXT_PUBLIC_APP_URL` | Ya (produksi) | Tidak | Alamat aplikasi untuk membuat tautan galeri. Default `http://localhost:3000` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY` | Tahap 3 | **Ya** (kecuali client ID) | Belum dipakai |

Jangan pernah memberi awalan `NEXT_PUBLIC_` pada nilai rahasia — awalan itu membuat nilainya ikut terkirim ke browser.

## Menyiapkan Supabase

1. Buka <https://supabase.com/dashboard> → **New project**. Disarankan project terpisah dari BMS agar data dan
   akses admin terisolasi. (Nama tabel tidak bentrok dengan BMS, jadi satu project juga bisa.)
2. **Project Settings → API** (atau **API Keys**):
   - *Project URL* → `NEXT_PUBLIC_SUPABASE_URL`
   - *anon / publishable key* → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - *service_role / secret key* → `SUPABASE_SERVICE_ROLE_KEY`
3. Jalankan migrasi, pilih salah satu:
   - **SQL Editor**: buka **SQL Editor → New query**, tempel isi
     `supabase/migrations/20261013000000_initial_schema.sql`, lalu **Run**.
   - **Supabase CLI** (dari folder `photo-selection`): `npx supabase init` (sekali, membuat
     `supabase/config.toml`), `npx supabase login`, `npx supabase link --project-ref <PROJECT_REF>`,
     lalu `npx supabase db push`.
4. Cek di **Table Editor**: lima tabel di atas muncul dengan label RLS aktif.
5. (Persiapan Tahap 2) **Authentication → Users → Add user** untuk akun admin, lalu daftarkan di SQL Editor:
   ```sql
   insert into public.selection_admins (user_id, display_name)
   select id, 'Nama Admin' from auth.users where email = 'email-admin@contoh.com';
   ```

## Menjalankan secara lokal

Butuh Node.js 20.9 atau lebih baru.

```bash
cd photo-selection
npm install
cp .env.example .env.local   # lalu isi nilainya
npm run dev                  # http://localhost:3000
```

Perintah lain:

```bash
npm run lint        # ESLint
npm run typecheck   # TypeScript
npm run build       # build produksi
npm run db:test     # uji skema di PostgreSQL lokal (lihat di bawah)
```

### Cara menguji Tahap 1

1. Buka `http://localhost:3000` — halaman awal tampil; coba juga lebar layar HP.
2. Buka `http://localhost:3000/api/health`:
   - Sebelum env diisi: `"supabaseEnv": "missing"` (HTTP 503).
   - Setelah env diisi dan migrasi dijalankan: `"ok": true` dengan semua cek `"ok"` (HTTP 200).
   - Bila migrasi belum dijalankan: `"database": "error"` dengan pesan untuk menjalankan migrasi.
3. Uji skema (opsional, butuh PostgreSQL lokal — tidak menyentuh project Supabase):
   ```bash
   PGURL="postgresql://postgres@localhost:5432/postgres" npm run db:test
   ```
   Skrip membuat database sementara, menerapkan migrasi dua kali, menguji kuota, status seleksi, snapshot,
   RLS, dan 50 request paralel ke kuota 5, lalu menghapus database itu.

## Commit, push, dan deploy ke Vercel

```bash
git add photo-selection
git commit -m "Pesan commit"
git push -u origin <nama-branch>
```

Deploy awal:

1. <https://vercel.com/new> → **Import** repository `web-admin-booking`.
2. **Root Directory**: pilih `photo-selection` (wajib — root repo berisi aplikasi BMS).
   Framework terdeteksi otomatis sebagai Next.js.
3. **Environment Variables**: isi `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, dan `NEXT_PUBLIC_APP_URL` (alamat Vercel/domain Anda).
4. **Deploy**, lalu buka `https://<domain>/api/health` dan pastikan `"ok": true`.

Setiap mengubah variabel `NEXT_PUBLIC_*` di Vercel, lakukan **Redeploy** karena nilainya ditanam saat build.
