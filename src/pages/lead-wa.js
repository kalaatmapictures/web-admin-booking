/* =====================================================================
   LEAD → WHATSAPP OTOMATIS
   Program "Kalaatma WA" (whatsmeow) di laptop admin menyambung ke WhatsApp
   sebagai perangkat tertaut. Statusnya dikirim ke tabel wa_bridge lewat
   Edge Function wa-bridge; halaman ini hanya membaca baris itu dan mengirim
   perintah (Tampilkan QR / Putuskan) lewat kolom command.
   • Chat dari nomor baru → lead baru (sumber WhatsApp, status Cold).
   • Laptop mati → chat tertunda masuk saat laptop menyala lagi.
   ===================================================================== */
import { $, S, esc, api, toast, openDrawer, confirmBox, logAct } from '../core.js';
import { ago } from './activity.js';

const W = {row:null, loaded:false, at:0, timer:null, drTimer:null, lastMsg:undefined, onNewLeads:null};
const ONLINE_MS = 90_000;      // program mengirim heartbeat tiap 30 detik (5 detik saat menunggu scan)
const QR_FRESH_MS = 25_000;    // QR WhatsApp berganti ±20 detik sekali

const WA_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2c0 1.3.9 2.5 1 2.7.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.2-.3-.2-.6-.4z"/></svg>';

/* ---------- status ---------- */
export function waState(r = W.row){
  if(!r) return {key:'none'};
  const online = r.last_seen && Date.now() - Date.parse(r.last_seen) < ONLINE_MS;
  const linked = !!r.phone && ['connected', 'disconnected'].includes(r.status);
  if(!online) return {key: linked ? 'sleep' : 'none'};
  if(r.status === 'connected') return {key:'connected'};
  if(r.status === 'qr' && r.qr && r.qr_at && Date.now() - Date.parse(r.qr_at) < QR_FRESH_MS) return {key:'qr'};
  if(['qr', 'qr_expired', 'logged_out'].includes(r.status)) return {key:'needqr'};
  return {key:'connecting'};
}
const phoneFmt = p => p ? '+' + String(p).replace(/^(\d{2})(\d{3})(\d{4})(\d+)$/, '$1 $2-$3-$4') : '';

async function fetchRow(){
  try{ W.row = (await api('wa_bridge?id=eq.1&select=*'))?.[0] || null; }
  catch(_){ W.row = null; }
  W.loaded = true; W.at = Date.now();
  return W.row;
}

/* ---------- strip status di atas halaman Lead ---------- */
export function waBar(){ return `<div id="waBar" class="card wa-bar">${barInner()}</div>`; }

function barInner(){
  if(!W.loaded) return `<span class="wa-ic">${WA_ICON}</span><div class="wa-txt"><b>WhatsApp</b><span class="tsub">memeriksa koneksi…</span></div>`;
  const r = W.row || {}, st = waState().key;
  const info = {
    connected: ['ok', 'WhatsApp terhubung', [phoneFmt(r.phone) + (r.push_name ? ` (${esc(r.push_name)})` : ''), r.device ? 'di ' + esc(r.device) : '',
      r.last_message_at ? 'chat terakhir ' + ago(r.last_message_at) : 'belum ada chat masuk', r.leads_created ? `${r.leads_created} lead otomatis` : ''].filter(Boolean).join(' · ')],
    sleep: ['warn', 'Laptop sedang mati / program berhenti', `Chat yang masuk tetap tercatat begitu laptop ${r.device ? esc(r.device) + ' ' : ''}menyala lagi${r.last_seen ? ' · aktif terakhir ' + ago(r.last_seen) : ''}`],
    qr: ['info', 'Menunggu scan QR', 'Buka WhatsApp di HP → Perangkat tertaut → Tautkan perangkat'],
    needqr: ['info', 'WhatsApp belum ditautkan', 'Program sudah aktif di laptop — tampilkan QR lalu scan dari HP'],
    connecting: ['info', 'Menyambungkan WhatsApp…', r.device ? 'di ' + esc(r.device) : ''],
    none: ['off', 'Lead otomatis dari WhatsApp', 'Chat dari nomor baru langsung masuk ke daftar lead — hubungkan sekali, lalu biarkan berjalan']
  }[st];
  const btn = st === 'connected' || st === 'sleep' ? 'Kelola' : st === 'qr' ? 'Scan QR' : 'Hubungkan WhatsApp';
  return `<span class="wa-ic wa-${info[0]}">${WA_ICON}</span>
    <div class="wa-txt"><b><span class="wa-dot wa-${info[0]}"></span>${info[1]}</b><span class="tsub">${info[2]}</span></div>
    <button class="btn ${st === 'connected' || st === 'sleep' ? 'soft' : ''} sm" id="waOpen">${btn}</button>`;
}

function paintBar(){
  const el = $('#waBar');
  if(!el) return;
  el.innerHTML = barInner();
  const b = $('#waOpen');
  if(b) b.onclick = openWa;
}

/* Dipanggil setiap RENDER.lead: pasang strip + polling ringan selama halaman Lead terbuka.
   Kalau ada chat baru (last_message_at berubah) daftar lead dimuat ulang otomatis. */
export function bindWaBar(onNewLeads){
  W.onNewLeads = onNewLeads;
  paintBar();
  const tick = async () => {
    if(S.page !== 'lead'){ clearInterval(W.timer); W.timer = null; return; }
    if(document.hidden) return;
    const prev = W.lastMsg;
    await fetchRow();
    W.lastMsg = W.row?.last_message_at || null;
    if(prev !== undefined && W.lastMsg !== prev && W.onNewLeads) await W.onNewLeads();
    else paintBar();
  };
  if(!W.timer){ tick(); W.timer = setInterval(tick, 20_000); }
  else if(Date.now() - W.at > 10_000) tick();  // kembali ke halaman Lead → status terbaru
}

/* ---------- drawer: hubungkan / kelola ---------- */
function openWa(){
  openDrawer(`<div class="dh"><div><h2>WhatsApp → Lead otomatis</h2><div class="tsub">Program Kalaatma WA di laptop + WhatsApp admin</div></div><button class="x" data-dclose>✕</button></div>
    <div id="waDr">${drawerInner()}</div>`);
  bindDrawer();
  clearInterval(W.drTimer);
  W.drTimer = setInterval(async () => {
    if(!$('#drawer').classList.contains('open') || !$('#waDr')){ clearInterval(W.drTimer); return; }
    const before = JSON.stringify([waState().key, W.row?.qr_at, W.row?.last_message_at, W.row?.status]);
    await fetchRow();
    if(JSON.stringify([waState().key, W.row?.qr_at, W.row?.last_message_at, W.row?.status]) !== before){
      $('#waDr').innerHTML = drawerInner(); bindDrawer(); paintBar();
    }
  }, 2500);
  fetchRow().then(() => { if($('#waDr')){ $('#waDr').innerHTML = drawerInner(); bindDrawer(); paintBar(); } });
}

function drawerInner(){
  const r = W.row || {}, st = waState().key;
  const steps = `<ol class="so-steps">
      <li><b>Jalankan <code>kalaatma-wa.exe</code> di laptop</b> (sekali saja). Program terpasang otomatis, berjalan di latar belakang, dan menyala sendiri setiap laptop dinyalakan.</li>
      <li>QR muncul di sini. Di HP buka <b>WhatsApp → ⋮ / Setelan → Perangkat tertaut → Tautkan perangkat</b>, lalu scan.</li>
      <li>Selesai — chat dari nomor baru langsung jadi lead (sumber WhatsApp, status Cold).</li>
    </ol>`;
  if(st === 'qr') return `
    <div class="wa-qrbox"><img src="${r.qr}" alt="QR WhatsApp" width="260" height="260"><span class="tsub">QR berganti otomatis tiap ±20 detik</span></div>
    ${steps}`;
  if(st === 'connected' || st === 'sleep') return `
    <div class="card wa-acc">
      <div class="wa-acc-h"><span class="wa-ic wa-${st === 'connected' ? 'ok' : 'warn'}">${WA_ICON}</span>
        <div><b>${phoneFmt(r.phone)}</b>${r.push_name ? `<div class="tsub">${esc(r.push_name)}</div>` : ''}</div>
        <span class="badge ${st === 'connected' ? 'b-ok' : 'b-warn'}" style="margin-left:auto"><span class="d"></span>${st === 'connected' ? 'Terhubung' : 'Laptop mati'}</span></div>
      <div class="wa-kv"><span>Laptop</span><b>${esc(r.device || '—')}</b></div>
      <div class="wa-kv"><span>Aktif terakhir</span><b>${r.last_seen ? ago(r.last_seen) : '—'}</b></div>
      <div class="wa-kv"><span>Chat terakhir</span><b>${r.last_message_at ? ago(r.last_message_at) : 'belum ada'}</b></div>
      <div class="wa-kv"><span>Lead otomatis</span><b>${r.leads_created || 0}</b></div>
    </div>
    <div class="hint" style="margin:12px 0">${st === 'sleep'
      ? 'Program di laptop sedang tidak aktif. Tidak apa-apa — WhatsApp menyimpan chat yang masuk dan program memprosesnya begitu laptop menyala lagi. Kalau laptop tidak menyala lebih dari ±14 hari, tautan bisa terputus dan perlu scan ulang.'
      : 'Yang dicatat hanya nama, nomor, waktu, dan cuplikan chat pertama dari nomor yang belum ada di lead/client. Isi percakapan tidak disimpan.'}</div>
    ${st === 'connected' ? '<button class="btn soft" id="waLogout" style="color:var(--err)">Putuskan WhatsApp</button>' : ''}`;
  if(st === 'needqr') return `
    <div class="wa-qrbox wa-empty"><b>QR belum ditampilkan</b><span class="tsub">Program sudah aktif di ${esc(r.device || 'laptop')}.</span>
      <button class="btn" id="waPair">Tampilkan QR</button></div>
    ${steps}`;
  if(st === 'connecting') return `
    <div class="wa-qrbox wa-empty"><span class="wa-spin"></span><b>Menyambungkan…</b><span class="tsub">Program di ${esc(r.device || 'laptop')} sedang menghubungi WhatsApp. Pastikan laptop tersambung internet.</span></div>
    ${steps}`;
  return `
    <div class="wa-qrbox wa-empty"><span class="wa-spin"></span><b>Menunggu program di laptop…</b><span class="tsub">Jalankan <code>kalaatma-wa.exe</code> — QR akan muncul di sini dalam beberapa detik.</span></div>
    ${steps}
    <div class="hint">Windows mungkin menampilkan "Windows protected your PC" karena program belum bertanda tangan digital — klik <b>More info → Run anyway</b>.</div>`;
}

async function command(cmd){
  await api('wa_bridge?id=eq.1', {method:'PATCH', body:{command:cmd, command_at:new Date().toISOString()}, prefer:'return=minimal'});
}

function bindDrawer(){
  const pair = $('#waPair');
  if(pair) pair.onclick = async () => {
    pair.disabled = true; pair.textContent = 'Meminta QR…';
    try{ await command('pair'); toast('QR akan muncul dalam beberapa detik'); }
    catch(e){ pair.disabled = false; pair.textContent = 'Tampilkan QR'; toast('Gagal: ' + e.message); }
  };
  const out = $('#waLogout');
  if(out) out.onclick = async () => {
    if(!await confirmBox('Putuskan WhatsApp?', 'Lead dari WhatsApp berhenti masuk sampai QR discan lagi. Lead yang sudah ada tidak terhapus.', 'Ya, putuskan')) return;
    try{
      await command('logout');
      await logAct('update', 'Lead', 'WhatsApp', 'Koneksi WhatsApp diputus');
      toast('Memutuskan… (±30 detik)');
    }catch(e){ toast('Gagal: ' + e.message); }
  };
}
