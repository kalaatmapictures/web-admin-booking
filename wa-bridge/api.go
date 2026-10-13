package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"
)

// ---------- Edge Function wa-bridge ----------

type API struct {
	url, secret string
	http        *http.Client
}

func newAPI(url, secret string) *API {
	return &API{url: url, secret: secret, http: &http.Client{Timeout: 30 * time.Second}}
}

// errPermanent: server menolak isi permintaan (4xx selain 401/429) — jangan diulang
type errPermanent struct{ msg string }

func (e errPermanent) Error() string { return e.msg }

func (a *API) post(ctx context.Context, body any, out any) error {
	buf, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.url, bytes.NewReader(buf))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-bridge-secret", a.secret)
	res, err := a.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 400 {
		msg := fmt.Sprintf("HTTP %d: %s", res.StatusCode, bytes.TrimSpace(data))
		if res.StatusCode >= 400 && res.StatusCode < 500 && res.StatusCode != 401 && res.StatusCode != 429 && res.StatusCode != 408 {
			return errPermanent{msg}
		}
		return fmt.Errorf("%s", msg)
	}
	if out != nil && len(data) > 0 {
		return json.Unmarshal(data, out)
	}
	return nil
}

type heartbeat struct {
	Type     string `json:"type"`
	Status   string `json:"status"`
	Phone    string `json:"phone,omitempty"`
	PushName string `json:"push_name,omitempty"`
	Device   string `json:"device,omitempty"`
	Version  string `json:"version,omitempty"`
}

// pesan masuk yang dikirim ke web admin
type inbound struct {
	Type  string `json:"type"`
	JID   string `json:"jid"`
	LID   string `json:"lid,omitempty"`
	Phone string `json:"phone,omitempty"`
	Name  string `json:"name,omitempty"`
	Text  string `json:"text,omitempty"`
	TS    string `json:"ts"`
}

// ---------- antrian lokal (SQLite, satu file dengan sesi WhatsApp) ----------

type Outbox struct {
	db     *sql.DB
	notify chan struct{}
}

func newOutbox(db *sql.DB) (*Outbox, error) {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS kalaatma_outbox (
		id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL, created_at INTEGER NOT NULL)`)
	if err == nil {
		_, err = db.Exec(`CREATE TABLE IF NOT EXISTS kalaatma_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`)
	}
	return &Outbox{db: db, notify: make(chan struct{}, 1)}, err
}

func (o *Outbox) Add(msg inbound) {
	buf, _ := json.Marshal(msg)
	if _, err := o.db.Exec(`INSERT INTO kalaatma_outbox (body, created_at) VALUES (?, ?)`, string(buf), time.Now().Unix()); err != nil {
		log.Printf("antrian: gagal menyimpan: %v", err)
		return
	}
	select {
	case o.notify <- struct{}{}:
	default:
	}
}

func (o *Outbox) Get(k string) string {
	var v string
	_ = o.db.QueryRow(`SELECT v FROM kalaatma_kv WHERE k = ?`, k).Scan(&v)
	return v
}

func (o *Outbox) Set(k, v string) {
	_, _ = o.db.Exec(`INSERT INTO kalaatma_kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`, k, v)
}

// Flush mengirim antrian berurutan; berhenti di kesalahan jaringan (dicoba lagi nanti).
func (o *Outbox) Flush(ctx context.Context, a *API) {
	for {
		rows, err := o.db.Query(`SELECT id, body FROM kalaatma_outbox ORDER BY id LIMIT 25`)
		if err != nil {
			log.Printf("antrian: %v", err)
			return
		}
		type item struct {
			id   int64
			body string
		}
		var items []item
		for rows.Next() {
			var it item
			if rows.Scan(&it.id, &it.body) == nil {
				items = append(items, it)
			}
		}
		rows.Close()
		if len(items) == 0 {
			return
		}
		for _, it := range items {
			var res struct {
				Action string `json:"action"`
			}
			err := a.post(ctx, json.RawMessage(it.body), &res)
			if _, perm := err.(errPermanent); err != nil && !perm {
				log.Printf("antrian: belum terkirim (%v) — dicoba lagi nanti", err)
				return
			} else if perm {
				log.Printf("antrian: ditolak server, dibuang: %v", err)
			}
			_, _ = o.db.Exec(`DELETE FROM kalaatma_outbox WHERE id = ?`, it.id)
		}
	}
}
