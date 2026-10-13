package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"
)

func TestMessageText(t *testing.T) {
	cases := []struct {
		msg  *waE2E.Message
		want string
		ok   bool
	}{
		{&waE2E.Message{Conversation: proto.String("Halo kak")}, "Halo kak", true},
		{&waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{Text: proto.String("tanya paket")}}, "tanya paket", true},
		{&waE2E.Message{ImageMessage: &waE2E.ImageMessage{Caption: proto.String("seperti ini")}}, "[Foto] seperti ini", true},
		{&waE2E.Message{ImageMessage: &waE2E.ImageMessage{}}, "[Foto]", true},
		{&waE2E.Message{ReactionMessage: &waE2E.ReactionMessage{Text: proto.String("👍")}}, "", false},
		{&waE2E.Message{ProtocolMessage: &waE2E.ProtocolMessage{}}, "", false},
		{nil, "", false},
	}
	for i, c := range cases {
		got, ok := messageText(c.msg)
		if got != c.want || ok != c.ok {
			t.Errorf("kasus %d: dapat (%q, %v), harusnya (%q, %v)", i, got, ok, c.want, c.ok)
		}
	}
}

func openTestOutbox(t *testing.T) *Outbox {
	db, err := sql.Open("sqlite3", "file:"+filepath.Join(t.TempDir(), "t.db")+"?_pragma=foreign_keys(1)")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	ob, err := newOutbox(db)
	if err != nil {
		t.Fatal(err)
	}
	return ob
}

func pending(t *testing.T, ob *Outbox) int {
	var n int
	if err := ob.db.QueryRow(`SELECT count(*) FROM kalaatma_outbox`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// Server mati → data tetap di antrian; server hidup → terkirim berurutan & antrian kosong.
func TestOutboxRetry(t *testing.T) {
	ob := openTestOutbox(t)
	ob.Add(inbound{Type: "message", JID: "1@s.whatsapp.net", TS: "2026-10-13T01:00:00Z"})
	ob.Add(inbound{Type: "message", JID: "2@s.whatsapp.net", TS: "2026-10-13T02:00:00Z"})

	var up atomic.Bool
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-bridge-secret") != "rahasia" {
			w.WriteHeader(401)
			return
		}
		if !up.Load() {
			w.WriteHeader(503)
			return
		}
		var m inbound
		_ = json.NewDecoder(r.Body).Decode(&m)
		got = append(got, m.JID)
		_, _ = w.Write([]byte(`{"action":"created"}`))
	}))
	defer srv.Close()
	api := newAPI(srv.URL, "rahasia")

	ob.Flush(context.Background(), api)
	if n := pending(t, ob); n != 2 {
		t.Fatalf("saat server error, antrian harus tetap 2, dapat %d", n)
	}
	up.Store(true)
	ob.Flush(context.Background(), api)
	if n := pending(t, ob); n != 0 {
		t.Fatalf("antrian harus kosong, dapat %d", n)
	}
	if len(got) != 2 || got[0] != "1@s.whatsapp.net" || got[1] != "2@s.whatsapp.net" {
		t.Fatalf("urutan kiriman salah: %v", got)
	}

	// kunci salah (401) → jangan dibuang, tunggu konfigurasi benar
	ob.Add(inbound{Type: "message", JID: "3@s.whatsapp.net"})
	ob.Flush(context.Background(), newAPI(srv.URL, "salah"))
	if n := pending(t, ob); n != 1 {
		t.Fatalf("saat 401 data harus tetap di antrian, dapat %d", n)
	}
}

// Isi yang ditolak server (400) dibuang supaya antrian tidak macet selamanya.
func TestOutboxDropsRejected(t *testing.T) {
	ob := openTestOutbox(t)
	ob.Add(inbound{Type: "message", JID: "x"})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(400) }))
	defer srv.Close()
	ob.Flush(context.Background(), newAPI(srv.URL, "k"))
	if n := pending(t, ob); n != 0 {
		t.Fatalf("data yang ditolak harus dibuang, sisa %d", n)
	}
}

func TestKV(t *testing.T) {
	ob := openTestOutbox(t)
	if ob.Get("paired_at") != "" {
		t.Fatal("harus kosong")
	}
	ob.Set("paired_at", "a")
	ob.Set("paired_at", "b")
	if ob.Get("paired_at") != "b" {
		t.Fatal("nilai tidak diperbarui")
	}
}
