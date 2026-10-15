// Kalaatma WA — menyambungkan WhatsApp admin ke halaman Lead di web admin.
//
// Program ini berjalan di laptop admin sebagai "perangkat tertaut" WhatsApp
// (seperti WhatsApp Web) memakai library whatsmeow. Chat dari nomor baru
// dikirim ke Supabase Edge Function wa-bridge dan menjadi Lead.
//
//   - QR untuk menautkan muncul di web admin (halaman Lead → Hubungkan WhatsApp).
//   - Saat laptop mati, WhatsApp menahan pesan untuk perangkat tertaut;
//     begitu program tersambung lagi, pesan yang tertunda ikut diproses.
//   - Data yang belum terkirim (mis. internet putus) disimpan di antrian
//     lokal dan dikirim ulang otomatis.
//
// Program tidak membuka port ke internet — hanya menyambung keluar ke
// WhatsApp dan ke Supabase. Pesan tidak disimpan; yang dikirim ke web admin
// hanya nama, nomor, waktu, dan cuplikan pesan pertama.
package main

import (
	"context"
	"database/sql"
	"log"
	"os"
	"path/filepath"

	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"modernc.org/sqlite"
)

// Diisi saat build: go build -ldflags "-X main.BridgeURL=... -X main.BridgeSecret=..."
var (
	BridgeURL    = ""
	BridgeSecret = ""
	Version      = "1.1.0"
)

const appName = "Kalaatma WA"

func init() {
	// whatsmeow memakai nama driver "sqlite3"; modernc (tanpa cgo) terdaftar sebagai "sqlite"
	sql.Register("sqlite3", &sqlite.Driver{})
}

func main() {
	if v := os.Getenv("KALAATMA_WA_URL"); v != "" {
		BridgeURL = v
	}
	if v := os.Getenv("KALAATMA_WA_SECRET"); v != "" {
		BridgeSecret = v
	}

	dir := dataDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		fatal("Tidak bisa membuat folder data: " + err.Error())
	}
	setupLog(filepath.Join(dir, "kalaatma-wa.log"))

	// pemasangan, satu instance, dan perintah dari instance kedua (mis. "hentikan")
	if handled := platformStartup(dir); handled {
		return
	}
	if BridgeURL == "" || BridgeSecret == "" {
		fatal("Program ini belum dikonfigurasi (alamat/kunci web admin kosong). Unduh ulang dari admin.")
	}
	log.Printf("%s %s mulai (data: %s)", appName, Version, dir)

	store.SetOSInfo(appName, [3]uint32{1, 0, 0})
	store.DeviceProps.RequireFullSync = new(bool) // tidak perlu riwayat lengkap

	db, err := sql.Open("sqlite3", "file:"+filepath.Join(dir, "session.db")+"?_pragma=foreign_keys(1)&_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)")
	if err != nil {
		fatal("Gagal membuka database: " + err.Error())
	}
	db.SetMaxOpenConns(1)
	ctx := context.Background()
	container := sqlstore.NewWithDB(db, "sqlite3", waLogger("store"))
	if err := container.Upgrade(ctx); err != nil {
		fatal("Gagal menyiapkan database: " + err.Error())
	}
	ob, err := newOutbox(db)
	if err != nil {
		fatal("Gagal menyiapkan antrian: " + err.Error())
	}

	b := &Bridge{container: container, outbox: ob, api: newAPI(BridgeURL, BridgeSecret), device: hostname()}
	b.Run(ctx)
}

func dataDir() string {
	if d, err := os.UserConfigDir(); err == nil {
		return filepath.Join(d, "KalaatmaWA")
	}
	return "KalaatmaWA"
}

func hostname() string {
	h, _ := os.Hostname()
	if h == "" {
		h = "Laptop"
	}
	return h
}

// log ke file (dipangkas kalau sudah > 5 MB)
func setupLog(path string) {
	if st, err := os.Stat(path); err == nil && st.Size() > 5<<20 {
		_ = os.Rename(path, path+".old")
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	log.SetOutput(f)
	log.SetFlags(log.LstdFlags)
}

func fatal(msg string) {
	log.Print("FATAL: " + msg)
	showMessage(appName, msg)
	os.Exit(1)
}
