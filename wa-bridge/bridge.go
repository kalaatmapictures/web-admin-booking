package main

import (
	"context"
	"encoding/base64"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/skip2/go-qrcode"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
)

type Bridge struct {
	container *sqlstore.Container
	outbox    *Outbox
	api       *API
	device    string

	mu        sync.Mutex
	client    *whatsmeow.Client
	status    string    // starting | qr | qr_expired | connected | disconnected | logged_out
	wantPair  chan bool // perintah "Tampilkan QR" dari web admin
	wantOut   chan bool // perintah "Putuskan" dari web admin
	resetLoop chan bool // sesi berakhir (logout) → buat klien baru
}

func (b *Bridge) setStatus(s string) {
	b.mu.Lock()
	changed := b.status != s
	b.status = s
	b.mu.Unlock()
	if changed {
		log.Printf("status: %s", s)
		go b.sendHeartbeat(context.Background())
	}
}

func (b *Bridge) getStatus() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.status
}

func (b *Bridge) Run(ctx context.Context) {
	b.wantPair = make(chan bool, 1)
	b.wantOut = make(chan bool, 1)
	b.resetLoop = make(chan bool, 1)
	b.setStatus("starting")
	go b.heartbeatLoop(ctx)
	go b.outboxLoop(ctx)

	for {
		dev, err := b.container.GetFirstDevice(ctx)
		if err != nil {
			log.Printf("gagal membaca sesi: %v", err)
			time.Sleep(10 * time.Second)
			continue
		}
		cli := whatsmeow.NewClient(dev, waLogger("wa"))
		cli.EnableAutoReconnect = true
		cli.AddEventHandler(b.onEvent)
		b.mu.Lock()
		b.client = cli
		b.mu.Unlock()

		if cli.Store.ID == nil {
			b.pair(ctx, cli)
		} else if err := cli.Connect(); err != nil {
			log.Printf("gagal tersambung: %v — dicoba lagi", err)
			b.setStatus("disconnected")
			time.Sleep(15 * time.Second)
			continue
		}

		// tunggu sampai sesi berakhir (logout dari HP / web admin)
		select {
		case <-b.resetLoop:
		case <-b.wantOut:
			log.Print("perintah putuskan dari web admin")
			lctx, cancel := context.WithTimeout(ctx, 20*time.Second)
			if err := cli.Logout(lctx); err != nil {
				log.Printf("logout: %v", err)
				cli.Disconnect()
				_ = cli.Store.Delete(lctx)
			}
			cancel()
			b.setStatus("logged_out")
		}
		cli.Disconnect()
		b.outbox.Set("paired_at", "")
		drain(b.resetLoop)
	}
}

// pair menampilkan QR (dikirim ke web admin) sampai berhasil ditautkan.
// QR kedaluwarsa setelah ±2 menit → menunggu admin menekan "Tampilkan QR".
func (b *Bridge) pair(ctx context.Context, cli *whatsmeow.Client) {
	// pertama kali dipasang → QR langsung tampil; setelah logout / QR kedaluwarsa → tunggu admin
	waitClick := b.getStatus() != "starting"
	for {
		if waitClick {
			b.setStatus("qr_expired")
			<-b.wantPair
			waitClick = false
		}
		qrCh, err := cli.GetQRChannel(ctx)
		if err != nil {
			log.Printf("QR: %v", err)
			return
		}
		if err := cli.Connect(); err != nil {
			// belum ada internet → coba lagi sendiri, tanpa menunggu admin
			log.Printf("gagal tersambung untuk QR: %v — dicoba lagi", err)
			b.setStatus("disconnected")
			time.Sleep(15 * time.Second)
			continue
		}
		for item := range qrCh {
			switch {
			case item.Event == whatsmeow.QRChannelEventCode:
				png, err := qrcode.Encode(item.Code, qrcode.Medium, 320)
				if err != nil {
					continue
				}
				b.mu.Lock()
				b.status = "qr"
				b.mu.Unlock()
				qr := "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)
				if err := b.api.post(ctx, map[string]string{"type": "qr", "qr": qr}, nil); err != nil {
					log.Printf("gagal mengirim QR: %v", err)
				}
			case item == whatsmeow.QRChannelSuccess:
				log.Print("berhasil ditautkan")
				b.outbox.Set("paired_at", time.Now().UTC().Format(time.RFC3339))
				return
			default:
				log.Printf("QR selesai: %s", item.Event)
			}
		}
		cli.Disconnect()
		waitClick = true
	}
}

func (b *Bridge) onEvent(evt any) {
	switch e := evt.(type) {
	case *events.Connected:
		b.setStatus("connected")
	case *events.Disconnected:
		b.setStatus("disconnected")
	case *events.StreamReplaced:
		b.setStatus("disconnected")
	case *events.LoggedOut:
		log.Printf("dikeluarkan dari WhatsApp (%v)", e.Reason)
		b.setStatus("logged_out")
		select {
		case b.resetLoop <- true:
		default:
		}
	case *events.OfflineSyncCompleted:
		log.Printf("pesan tertunda selesai diproses (%d)", e.Count)
	case *events.Message:
		b.handleMessage(e, false)
	case *events.HistorySync:
		b.handleHistory(e)
	}
}

// handleMessage: hanya chat pribadi yang masuk dari orang lain
func (b *Bridge) handleMessage(m *events.Message, fromHistory bool) {
	info := m.Info
	if info.IsFromMe || info.IsGroup || info.Chat.Server == types.BroadcastServer ||
		info.Chat.Server == types.NewsletterServer || info.Chat.Server == types.GroupServer {
		return
	}
	text, ok := messageText(m.Message)
	if !ok {
		return
	}
	jid, lid, phone := b.resolve(info)
	if jid == "" {
		return
	}
	ts := info.Timestamp
	if ts.IsZero() {
		ts = time.Now()
	}
	if !fromHistory {
		log.Printf("chat masuk dari %s (%s)", maskPhone(phone, jid), ts.Format("02 Jan 15:04"))
	}
	b.outbox.Add(inbound{Type: "message", JID: jid, LID: lid, Phone: phone, Name: strings.TrimSpace(info.PushName),
		Text: text, TS: ts.UTC().Format(time.RFC3339)})
}

// Laptop mati lama → sebagian pesan bisa datang lewat sinkronisasi riwayat.
// Hanya pesan setelah perangkat ditautkan yang diproses (chat lama tidak diimpor).
func (b *Bridge) handleHistory(e *events.HistorySync) {
	pairedAt, err := time.Parse(time.RFC3339, b.outbox.Get("paired_at"))
	if err != nil {
		return
	}
	b.mu.Lock()
	cli := b.client
	b.mu.Unlock()
	for _, conv := range e.Data.GetConversations() {
		chat, err := types.ParseJID(conv.GetID())
		if err != nil || (chat.Server != types.DefaultUserServer && chat.Server != types.HiddenUserServer) {
			continue
		}
		for _, hm := range conv.GetMessages() {
			wm := hm.GetMessage()
			if wm == nil || time.Unix(int64(wm.GetMessageTimestamp()), 0).Before(pairedAt) {
				continue
			}
			if evt, err := cli.ParseWebMessage(chat, wm); err == nil {
				b.handleMessage(evt, true)
			}
		}
	}
}

// resolve → (jid kunci, lid, nomor). WhatsApp kini sering memakai ID tersembunyi (LID);
// nomor asli diambil dari alamat alternatif atau peta LID→nomor milik whatsmeow.
func (b *Bridge) resolve(info types.MessageInfo) (jid, lid, phone string) {
	sender := info.Sender.ToNonAD()
	if sender.IsEmpty() {
		sender = info.Chat.ToNonAD()
	}
	switch sender.Server {
	case types.DefaultUserServer:
		phone = sender.User
		if info.SenderAlt.Server == types.HiddenUserServer {
			lid = info.SenderAlt.ToNonAD().String()
		}
	case types.HiddenUserServer:
		lid = sender.String()
		if info.SenderAlt.Server == types.DefaultUserServer {
			phone = info.SenderAlt.User
		} else {
			b.mu.Lock()
			cli := b.client
			b.mu.Unlock()
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			if pn, err := cli.Store.LIDs.GetPNForLID(ctx, sender); err == nil && !pn.IsEmpty() {
				phone = pn.User
			}
			cancel()
		}
	default:
		return "", "", ""
	}
	if phone != "" {
		jid = phone + "@" + types.DefaultUserServer
	} else {
		jid = lid
	}
	return
}

// messageText: isi singkat untuk catatan lead; false = bukan chat sungguhan (reaksi, sistem, dll.)
func messageText(msg *waE2E.Message) (string, bool) {
	if msg == nil {
		return "", false
	}
	cap := func(label, c string) string {
		if c = strings.TrimSpace(c); c != "" {
			return label + " " + c
		}
		return label
	}
	switch {
	case msg.GetConversation() != "":
		return msg.GetConversation(), true
	case msg.GetExtendedTextMessage() != nil:
		return msg.GetExtendedTextMessage().GetText(), true
	case msg.GetImageMessage() != nil:
		return cap("[Foto]", msg.GetImageMessage().GetCaption()), true
	case msg.GetVideoMessage() != nil:
		return cap("[Video]", msg.GetVideoMessage().GetCaption()), true
	case msg.GetDocumentMessage() != nil:
		return cap("[Dokumen]", msg.GetDocumentMessage().GetFileName()), true
	case msg.GetAudioMessage() != nil:
		return "[Pesan suara]", true
	case msg.GetStickerMessage() != nil:
		return "[Stiker]", true
	case msg.GetLocationMessage() != nil:
		return "[Lokasi]", true
	case msg.GetContactMessage() != nil:
		return "[Kontak]", true
	case msg.GetButtonsResponseMessage() != nil:
		return msg.GetButtonsResponseMessage().GetSelectedDisplayText(), true
	case msg.GetListResponseMessage() != nil:
		return msg.GetListResponseMessage().GetTitle(), true
	}
	return "", false
}

func (b *Bridge) heartbeatLoop(ctx context.Context) {
	for {
		b.sendHeartbeat(ctx)
		wait := 30 * time.Second
		if s := b.getStatus(); s != "connected" {
			wait = 5 * time.Second // menunggu scan / perintah dari web admin
		}
		time.Sleep(wait)
	}
}

func (b *Bridge) sendHeartbeat(ctx context.Context) {
	hb := heartbeat{Type: "heartbeat", Status: b.getStatus(), Device: b.device, Version: Version}
	b.mu.Lock()
	cli := b.client
	b.mu.Unlock()
	if cli != nil && cli.Store.ID != nil && hb.Status == "connected" {
		hb.Phone = cli.Store.ID.User
		hb.PushName = cli.Store.PushName
	}
	var res struct {
		Command string `json:"command"`
	}
	cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	if err := b.api.post(cctx, hb, &res); err != nil {
		log.Printf("heartbeat: %v", err)
		return
	}
	switch res.Command {
	case "pair":
		select {
		case b.wantPair <- true:
		default:
		}
	case "logout":
		if hb.Status == "connected" || hb.Status == "disconnected" {
			select {
			case b.wantOut <- true:
			default:
			}
		}
	}
}

func (b *Bridge) outboxLoop(ctx context.Context) {
	t := time.NewTicker(20 * time.Second)
	defer t.Stop()
	for {
		b.outbox.Flush(ctx, b.api)
		select {
		case <-b.outbox.notify:
			time.Sleep(500 * time.Millisecond) // kumpulkan pesan yang datang beruntun
		case <-t.C:
		}
	}
}

func drain(c chan bool) {
	for {
		select {
		case <-c:
		default:
			return
		}
	}
}

func maskPhone(phone, jid string) string {
	if len(phone) > 6 {
		return phone[:4] + "…" + phone[len(phone)-3:]
	}
	if phone != "" {
		return phone
	}
	return "ID tersembunyi"
}

// ---------- log whatsmeow → file log (hanya peringatan & error) ----------

type fileLogger struct{ mod string }

func waLogger(mod string) waLog.Logger { return fileLogger{mod} }

func (l fileLogger) Errorf(msg string, args ...any) {
	log.Printf("[%s] ERROR "+msg, append([]any{l.mod}, args...)...)
}
func (l fileLogger) Warnf(msg string, args ...any) {
	log.Printf("[%s] WARN "+msg, append([]any{l.mod}, args...)...)
}
func (l fileLogger) Infof(string, ...any)        {}
func (l fileLogger) Debugf(string, ...any)       {}
func (l fileLogger) Sub(mod string) waLog.Logger { return fileLogger{l.mod + "/" + mod} }
