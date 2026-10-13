//go:build windows

package main

import (
	"bufio"
	"io"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const (
	lockAddr = "127.0.0.1:47391" // hanya lokal: penanda satu instance + perintah hentikan/perbarui
	runKey   = `Software\Microsoft\Windows\CurrentVersion\Run`
	runName  = "KalaatmaWA"
)

func installPath() string {
	base, err := os.UserCacheDir() // %LOCALAPPDATA%
	if err != nil {
		base = os.TempDir()
	}
	return filepath.Join(base, "KalaatmaWA", "kalaatma-wa.exe")
}

func samePath(a, b string) bool {
	ea, _ := filepath.EvalSymlinks(a)
	eb, _ := filepath.EvalSymlinks(b)
	return strings.EqualFold(filepath.Clean(ea), filepath.Clean(eb)) && ea != ""
}

// platformStartup: true = program selesai di sini (dipasang / dihentikan / sudah berjalan)
func platformStartup(dataDir string) bool {
	self, _ := os.Executable()
	target := installPath()

	ln, err := net.Listen("tcp", lockAddr)
	if err != nil {
		return secondInstance(self, target)
	}

	// dijalankan dari file unduhan → pasang ke folder aplikasi, daftarkan ke startup, jalankan
	if !samePath(self, target) {
		ln.Close()
		if err := install(self, target); err != nil {
			showMessage(appName, "Gagal memasang: "+err.Error())
			return true
		}
		showMessage(appName, "Kalaatma WA sudah terpasang dan berjalan di latar belakang.\n\n"+
			"Buka web admin → Lead → Hubungkan WhatsApp, lalu scan QR dari HP (WhatsApp → Perangkat tertaut).\n\n"+
			"Program akan menyala sendiri setiap laptop dinyalakan. File unduhan ini boleh dihapus.")
		return true
	}

	setAutostart(target)
	go serveControl(ln)
	return false
}

func install(self, target string) error {
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return err
	}
	if err := copyFile(self, target); err != nil {
		return err
	}
	setAutostart(target)
	cmd := exec.Command(target)
	cmd.Dir = filepath.Dir(target)
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

// program sudah berjalan → tawarkan perbarui (kalau ini file unduhan) atau hentikan
func secondInstance(self, target string) bool {
	if !samePath(self, target) {
		if !askYesNo(appName, "Kalaatma WA sudah berjalan di laptop ini.\n\nPasang ulang / perbarui dengan file ini?") {
			return true
		}
		sendControl("quit")
		waitUnlocked()
		if err := install(self, target); err != nil {
			showMessage(appName, "Gagal memperbarui: "+err.Error())
			return true
		}
		showMessage(appName, "Kalaatma WA sudah diperbarui dan berjalan lagi.")
		return true
	}
	if askYesNo(appName, "Kalaatma WA sedang berjalan.\n\nHentikan dan hapus dari startup laptop?\n"+
		"(Lead dari WhatsApp tidak akan masuk lagi sampai program dijalankan kembali.)") {
		sendControl("uninstall")
		showMessage(appName, "Kalaatma WA dihentikan dan tidak akan menyala otomatis lagi.\n\n"+
			"Untuk menyalakan lagi, jalankan file kalaatma-wa.exe dari web admin.")
	}
	return true
}

func serveControl(ln net.Listener) {
	for {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		line, _ := bufio.NewReader(io.LimitReader(c, 64)).ReadString('\n')
		c.Close()
		switch strings.TrimSpace(line) {
		case "quit":
			log.Print("dihentikan untuk pembaruan")
			os.Exit(0)
		case "uninstall":
			log.Print("dihentikan & dihapus dari startup")
			removeAutostart()
			os.Exit(0)
		}
	}
}

func sendControl(cmd string) {
	c, err := net.DialTimeout("tcp", lockAddr, 3*time.Second)
	if err != nil {
		return
	}
	_, _ = c.Write([]byte(cmd + "\n"))
	c.Close()
}

func waitUnlocked() {
	for i := 0; i < 50; i++ {
		if ln, err := net.Listen("tcp", lockAddr); err == nil {
			ln.Close()
			time.Sleep(300 * time.Millisecond) // beri waktu file exe dilepas
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".new"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, dst)
}

func setAutostart(path string) {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, runKey, registry.SET_VALUE)
	if err != nil {
		log.Printf("autostart: %v", err)
		return
	}
	defer k.Close()
	_ = k.SetStringValue(runName, `"`+path+`"`)
}

func removeAutostart() {
	k, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.SET_VALUE)
	if err != nil {
		return
	}
	defer k.Close()
	_ = k.DeleteValue(runName)
}

func showMessage(title, msg string) {
	t, _ := windows.UTF16PtrFromString(title)
	m, _ := windows.UTF16PtrFromString(msg)
	_, _ = windows.MessageBox(0, m, t, windows.MB_OK|windows.MB_ICONINFORMATION|windows.MB_SETFOREGROUND)
}

func askYesNo(title, msg string) bool {
	t, _ := windows.UTF16PtrFromString(title)
	m, _ := windows.UTF16PtrFromString(msg)
	r, _ := windows.MessageBox(0, m, t, windows.MB_YESNO|windows.MB_ICONQUESTION|windows.MB_SETFOREGROUND)
	return r == 6 // IDYES
}
