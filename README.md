# Kalaatma Pictures — BMS (Business Management System)

Web admin Kalaatma: Dashboard, Booking, Joblist (kanban), **Task Board** (ala Trello), Lead, Completed Client, Freelancer, Paket & Harga,
**Menu Landing Page**, Keuangan/Kas, Kalender, dan **Log Aktivitas**. Terhubung dengan landing page booking
([`form-booking`](https://github.com/marselcerebrum-jpg/form-booking)) lewat satu project Supabase.

Vite (HTML/CSS/JS murni) + Supabase, hosting Vercel.

## Alur integrasi

```
 Pelanggan ── landing page (form-booking) ──┐ baca menu (app_config)
                                             │ kirim booking (bookings, status NEW)
                                             ▼
                                         SUPABASE
                                             ▲
 Admin ───── BMS (web-admin-booking) ────────┘ login → kelola semua data
```

| Kejadian | Akibatnya |
| --- | --- |
| Pelanggan booking di landing page | Masuk ke BMS: Joblist kolom **Booking** (label "Baru · Website"), notifikasi lonceng, Dashboard |
| Admin ubah harga di **Paket & Harga** atau **Menu Landing Page** | Landing page langsung memakai harga/menu baru (satu sumber harga) |
| Admin sembunyikan layanan/paket/add-on | Hilang dari landing page; booking ke paket itu ditolak server |
| Admin ubah DP %, rekening, WhatsApp | Dipakai landing page, perhitungan BMS, dan invoice |
| Admin catat pembayaran | Otomatis tercatat di **Keuangan / Kas** (trigger database) |
| Status booking jadi CONFIRMED dst. | Nomor invoice terbit otomatis |
| Booking masuk tahap Joblist baru | Tugas SOP tahap itu otomatis dibuat di **Task Board** (board *Produksi Project*) |
| Crew booking diganti | Tugas photographer/videographer yang belum selesai ikut pindah PIC |
| Tugas dicentang / dipindah ke kolom selesai | Progres di kartu Joblist & detail booking ikut berubah; bila semua tugas tahap beres muncul "siap ke tahap berikutnya" |
| Setiap perubahan oleh admin | Tercatat di **Log Aktivitas** (tidak bisa diubah/dihapus) |

Keamanan di server (bukan hanya di tampilan):
- Harga booking **dihitung ulang dari menu** oleh database — pelanggan tidak bisa mengirim harga sendiri.
- Pelanggan (anon) hanya bisa *mengirim* booking dan hanya kolom form; tidak bisa membaca data apa pun selain menu.
- Semua data BMS hanya bisa diakses akun yang terdaftar di tabel `admins`.
- Dua admin mengedit menu bersamaan tidak saling menimpa diam-diam.

## Task Board

Papan tugas ala Trello: **board → kolom → kartu**. Kartu punya checklist, komentar, PIC (admin atau freelancer),
deadline, prioritas, label, dan bisa ditautkan ke booking. Drag & drop antar kolom (desktop) atau pilih kolom di detail kartu (HP).

- **Produksi Project** — board yang tersinkron dengan Joblist. Tugas SOP masuk ke kolom pertamanya.
- **Marketing & Konten**, **Operasional Studio** — board bawaan untuk tugas di luar project; tambah board sendiri lewat **+ Board**.
- **Template SOP** — atur tugas otomatis per tahap (Booking, Onboarding, Event, Delivery, Done): judul, checklist,
  PIC otomatis (photographer/videographer booking), dan deadline relatif (mis. H-1 sesi, 10 hari setelah masuk tahap).
  Perubahan berlaku untuk booking yang masuk tahap berikutnya; untuk booking berjalan pakai **Terapkan SOP** di detail booking.
- Kolom bertanda **Selesai**: kartu yang masuk otomatis tercentang, dan kartu yang dicentang otomatis pindah ke sana.
- Tugas booking yang dibatalkan disembunyikan (tidak dihapus).

## Menjalankan lokal

```bash
npm install
npm run dev        # http://localhost:5174 (landing page di 5173)
npm run build
```

BMS selalu memakai data asli di Supabase. Tanpa env Supabase, halaman login menampilkan petunjuk pengisian env dan tombol Masuk dinonaktifkan.

## Setup Supabase

1. Buat project Supabase, buka **SQL Editor**, jalankan `supabase/schema.sql` (aman dijalankan ulang).
   Project yang sudah berjalan cukup menjalankan ulang file ini untuk mengaktifkan Task Board — board, kolom, dan
   Template SOP bawaan dibuat sekali, dan booking yang sedang berjalan langsung mendapat tugas tahapnya.
2. **Authentication → Users → Add user** untuk tiap admin (email + password), lalu daftarkan:
   ```sql
   insert into public.admins (user_id, name)
   select id, 'Atep' from auth.users where email = 'admin@kalaatma.id';
   ```
3. Isi env (Vercel → Project Settings → Environment Variables), **nilai Supabase sama** di kedua project:
   - BMS: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_LANDING_URL`
   - Landing page: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
4. Login ke BMS. Simpan pertama di Menu / Paket & Harga mengisi menu ke database; sebelum itu landing page memakai pricelist bawaan.
5. Opsional: isi HPP tiap paket di **Paket & Harga** supaya profit di Dashboard akurat.

## Struktur

| File | Isi |
| --- | --- |
| `index.html`, `src/styles.css` | Shell & tampilan BMS |
| `src/main.js` | Titik masuk, mendaftarkan halaman |
| `src/core.js` | Helper, state, data layer Supabase, log aktivitas, auth, router |
| `src/pages/*.js` | Satu file per halaman; `detail.js` = drawer booking, invoice & PDF, notifikasi; `task.js` = Task Board, Template SOP, bagian tugas di drawer |
| `src/stages.js`, `src/datepicker.js` | Tahap Joblist, kategori, label · pemilih tanggal |
| `src/shared/catalog.js` | Kontrak format menu — **identik** dengan repo landing page |
| `src/shared/catalog-default.js` | Pricelist bawaan Kalaatma 2026 |
| `supabase/schema.sql` | Tabel, view, trigger, dan aturan akses |
