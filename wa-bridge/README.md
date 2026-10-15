# Kalaatma WA — WhatsApp → Lead otomatis

Program kecil yang berjalan di laptop admin dan menyambung ke WhatsApp sebagai
**perangkat tertaut** (seperti WhatsApp Web), memakai library
[whatsmeow](https://github.com/tulir/whatsmeow). Setiap chat dari nomor baru
otomatis menjadi lead di web admin (halaman **Lead**).

```
WhatsApp ──► kalaatma-wa.exe (laptop) ──► Edge Function wa-bridge ──► tabel leads / wa_bridge
                                                       ▲
                     web admin (Lead → Hubungkan WhatsApp) membaca wa_bridge: status & QR
```

- QR untuk menautkan muncul di web admin; scan dari HP lewat
  *WhatsApp → Perangkat tertaut → Tautkan perangkat*.
- Laptop mati → WhatsApp menahan pesan untuk perangkat tertaut; begitu program
  tersambung lagi, chat yang tertunda ikut diproses (waktu lead = waktu chat asli).
  Kalau laptop mati lebih dari ±14 hari, WhatsApp bisa memutus tautan → scan ulang.
- Data yang belum terkirim (internet putus) disimpan di antrian lokal dan dikirim ulang.
- Saat ditautkan (scan QR), chat masuk dari **7 hari terakhir** ikut dijadikan lead
  (dari tiap percakapan: chat pertama untuk catatan, chat terakhir untuk "chat terakhir").
  Untuk mengambil ulang riwayat: web admin → Lead → Kelola → Putuskan, lalu scan QR lagi.
- Program tidak membuka port ke internet; isi percakapan tidak disimpan — hanya
  nama, nomor, waktu, dan cuplikan chat pertama.
- Nomor yang sudah jadi lead hanya diperbarui "chat terakhir"-nya; nomor client
  (booking) dan freelancer dilewati.

## Build

Alamat & kunci **tidak** disimpan di repo. Kunci ada di tabel `wa_bridge_secret`
(hanya bisa dibaca service role / SQL editor Supabase).

```bash
cd wa-bridge
go test ./...
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath \
  -ldflags "-s -w -H windowsgui \
    -X main.BridgeURL=https://<project>.supabase.co/functions/v1/wa-bridge \
    -X main.BridgeSecret=<isi wa_bridge_secret.secret>" \
  -o kalaatma-wa.exe .
```

Untuk uji coba di Mac/Linux: `KALAATMA_WA_URL=... KALAATMA_WA_SECRET=... go run .`

## Di laptop (Windows)

1. Jalankan `kalaatma-wa.exe` (sekali). Program menyalin dirinya ke
   `%LOCALAPPDATA%\KalaatmaWA\`, mendaftar ke startup Windows (HKCU\…\Run), lalu
   berjalan di latar belakang tanpa jendela.
2. Buka web admin → Lead → **Hubungkan WhatsApp** → scan QR.
3. Menjalankan `kalaatma-wa.exe` lagi saat program sudah berjalan:
   - dari file unduhan baru → tawaran **perbarui**;
   - dari folder aplikasi → tawaran **hentikan & hapus dari startup**.

Log: `%APPDATA%\KalaatmaWA\kalaatma-wa.log` · sesi & antrian: `session.db` di folder yang sama.

Mengganti kunci (mis. file exe tersebar): `update wa_bridge_secret set secret = encode(extensions.gen_random_bytes(24), 'hex');`
lalu build ulang exe. Edge Function menyimpan kunci di cache, jadi deploy ulang
`wa-bridge` supaya kunci lama langsung ditolak.

Catatan: whatsmeow tidak resmi dari Meta. Untuk sekadar membaca chat masuk
risikonya kecil, tapi jangan dipakai untuk kirim pesan massal.
