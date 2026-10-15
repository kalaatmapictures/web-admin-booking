# Kalaatma Pictures — BMS (Business Management System)

Web admin Kalaatma: Dashboard, Booking, Joblist (kanban), Lead, Completed Client, Freelancer, Paket & Harga,
**Menu Landing Page**, Keuangan/Kas, **Meta Ads**, Kalender, dan **Log Aktivitas**. Terhubung dengan landing page booking
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
| Setiap perubahan oleh admin | Tercatat di **Log Aktivitas** (tidak bisa diubah/dihapus) |

Keamanan di server (bukan hanya di tampilan):
- Harga booking **dihitung ulang dari menu** oleh database — pelanggan tidak bisa mengirim harga sendiri.
- Pelanggan (anon) hanya bisa *mengirim* booking dan hanya kolom form; tidak bisa membaca data apa pun selain menu.
- Semua data BMS hanya bisa diakses akun yang terdaftar di tabel `admins`.
- Dua admin mengedit menu bersamaan tidak saling menimpa diam-diam.

## Meta Ads (performa iklan)

Halaman **Meta Ads** menampilkan performa iklan Facebook/Instagram: spend, chat WhatsApp dimulai, leads, klik link,
CPM, CTR, tren harian, dan rincian per campaign / ad set / iklan (bisa di-export CSV). BMS **hanya menampilkan data** —
tidak ada AI di dalam BMS dan tidak ada biaya tambahan. Meta Marketing API, Supabase Edge Function, dan pg_cron gratis.

```
 Meta Marketing API ──(setiap 06.00 WIB / tombol "Sync sekarang")──► Edge Function meta-ads-sync
                                                                        │ simpan
                                                                        ▼
                                  BMS halaman Meta Ads ◄── baca ── meta_ads_insights · meta_ads · meta_sync_runs
```

| File | Isi |
| --- | --- |
| `supabase/schema.sql` (bagian META ADS) | Tabel data iklan, fungsi ringkasan `meta_ads_by_ad` & `meta_ads_daily`, akses khusus admin |
| `supabase/functions/meta-ads-sync/index.ts` | Menarik data dari Meta lalu menyimpannya |
| `supabase/meta_ads_cron.sql` | Jadwal sync otomatis tiap pagi |
| `src/pages/ads.js` | Halaman Meta Ads |

"Hasil" tiap campaign mengikuti tujuannya: **chat** (percakapan WhatsApp/Messenger/DM dimulai), **lead**, **klik link**
(traffic), atau **reach** (awareness). Semua aksi mentah dari Meta juga disimpan di kolom `actions`.

### Setup (sekali saja)

1. **Database** — jalankan ulang `supabase/schema.sql` di SQL Editor (aman diulang).
2. **Token Meta** (gratis):
   1. Buka [business.facebook.com](https://business.facebook.com) → **Business Settings**.
   2. **Accounts → Apps** → *Add* → buat app baru di [developers.facebook.com](https://developers.facebook.com/apps)
      (tipe *Business*), lalu hubungkan ke Business Manager Kalaatma.
   3. **Users → System users** → *Add* (role Admin) → *Assign assets*: pilih **Ad account** Kalaatma, izin *View performance*
      cukup → *Assign assets*: app tadi.
   4. Masih di system user → **Generate new token** → pilih app tadi → centang **`ads_read`** → *Token expiration: Never* → salin token.
   5. Catat **Ad Account ID** (Business Settings → Accounts → Ad accounts), formatnya `act_1234567890`.
3. **Secrets** — Supabase → **Edge Functions → Secrets**, tambahkan:
   - `META_ACCESS_TOKEN` = token dari langkah 2
   - `META_AD_ACCOUNT_ID` = `act_...`
   - `CRON_SECRET` = teks acak panjang bebas (contoh hasil `openssl rand -hex 24`)

   Token **jangan** ditaruh di kode, `.env` BMS, atau Vercel — hanya di Secrets Supabase.
4. **Deploy Edge Function** (dengan [Supabase CLI](https://supabase.com/docs/guides/cli)):
   ```bash
   supabase login
   supabase functions deploy meta-ads-sync --no-verify-jwt --project-ref <PROJECT_REF>
   ```
   `--no-verify-jwt` diperlukan supaya jadwal otomatis bisa memanggilnya; fungsi tetap menolak semua pemanggil
   selain admin yang login atau pemegang `CRON_SECRET`.
5. **Jadwal otomatis** — buka `supabase/meta_ads_cron.sql`, ganti `<PROJECT_REF>` dan `<CRON_SECRET>`, jalankan di SQL Editor.
6. Buka BMS → **Meta Ads** → klik **Tarik 90 hari** untuk mengambil data pertama kali. Setelah itu data diperbarui
   otomatis setiap pagi (3 hari terakhir ditarik ulang karena angka Meta masih bisa berubah 1–2 hari).

Jika sync gagal, pesan error dari Meta tampil di kartu **Sinkronisasi Meta** dan tersimpan di tabel `meta_sync_runs`.

## Menjalankan lokal

```bash
npm install
npm run dev        # http://localhost:5174 (landing page di 5173)
npm run build
```

BMS selalu memakai data asli di Supabase. Tanpa env Supabase, halaman login menampilkan petunjuk pengisian env dan tombol Masuk dinonaktifkan.

## Setup Supabase

1. Buat project Supabase, buka **SQL Editor**, jalankan `supabase/schema.sql` (aman dijalankan ulang).
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
| `src/pages/*.js` | Satu file per halaman; `detail.js` = drawer booking, invoice & PDF, notifikasi |
| `src/stages.js`, `src/datepicker.js` | Tahap Joblist, kategori, label · pemilih tanggal |
| `src/shared/catalog.js` | Kontrak format menu — **identik** dengan repo landing page |
| `src/shared/catalog-default.js` | Pricelist bawaan Kalaatma 2026 |
| `supabase/schema.sql` | Tabel, view, trigger, dan aturan akses |
