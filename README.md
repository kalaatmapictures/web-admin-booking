# Kalaatma Pictures — Web Admin

Web admin untuk landing page booking Kalaatma ([`form-booking`](https://github.com/marselcerebrum-jpg/form-booking)):
dashboard, kelola menu (layanan, grup paket, paket, add-on), syarat & ketentuan, pengaturan pembayaran/kontak, dan log aktivitas admin.

Dibangun dengan Vite (HTML/CSS/JS murni) + Supabase, hosting Vercel.

## Bagaimana admin & landing page terhubung

```
 web-admin-booking ──(simpan menu, login, log)──▶  Supabase  ◀──(baca menu, kirim booking)── form-booking
                                                 app_config · admin_activity · bookings · admins
```

- Menu disimpan sebagai satu dokumen JSON di tabel `app_config` (key `catalog`). Landing page membacanya setiap kali dibuka.
- Format dokumen ditetapkan di `src/shared/catalog.js`. File ini **identik** di kedua repo, jadi ubah di keduanya bila formatnya berubah.
- Bila dua admin mengedit bersamaan, perubahan yang kalah tidak menimpa diam-diam: admin diberi tahu dan data terbaru dimuat ulang.
- Log aktivitas di Supabase tidak bisa diubah atau dihapus (jejak audit).

## Mode

| Mode | Kapan | Perilaku |
| --- | --- | --- |
| **Lokal** | `VITE_SUPABASE_*` kosong | Tanpa login. Perubahan hanya di browser ini dan **tidak** tampil di landing page. Untuk mencoba tampilan. |
| **Supabase** | `VITE_SUPABASE_*` diisi | Login admin, data di Supabase, langsung dipakai landing page. |

## Menjalankan lokal

```bash
npm install
npm run dev        # http://localhost:5174 (landing page di 5173)
npm run build
```

## Menghubungkan ke Supabase (nanti)

1. Buat project Supabase, lalu jalankan `supabase/schema.sql` di SQL Editor.
2. Buat akun admin di Authentication → Users, lalu daftarkan:
   ```sql
   insert into public.admins (user_id, name)
   select id, 'Nama Admin' from auth.users where email = 'admin@contoh.com';
   ```
3. Isi env di kedua project Vercel (nilai Supabase sama):
   - admin: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_LANDING_URL`
   - landing: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
4. Masuk ke admin. Penyimpanan pertama mengisi menu ke database. Sampai saat itu landing page memakai pricelist bawaan.

## Struktur

| File | Isi |
| --- | --- |
| `index.html`, `src/admin.css` | Tampilan admin, login |
| `src/main.js` | Halaman & logika admin |
| `src/data/store.js` | Penyimpanan: Supabase atau lokal |
| `src/shared/catalog.js` | Kontrak format menu (sama dengan landing page) |
| `src/shared/catalog-default.js` | Pricelist bawaan Kalaatma 2026 |
| `supabase/schema.sql` | Tabel & aturan akses (RLS) |
