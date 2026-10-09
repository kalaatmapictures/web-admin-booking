/* =====================================================================
   BOOKING → TAMBAH MANUAL & IMPOR DATA LAMA
   • Tambah manual: admin mengisi booking sendiri (source 'admin').
     Paket katalog → harga dihitung ulang server (trigger), paket custom →
     nama & harga bebas. DP yang sudah diterima langsung dicatat (ikut kas).
   • Impor: file Excel (.xlsx/.xls) atau CSV → cocokkan kolom → pratinjau
     → simpan massal (source 'import'). Excel dibaca dengan SheetJS yang
     dimuat dari CDN resminya hanya saat dibutuhkan.
   ===================================================================== */
import { $, $$, S, rp, esc, iso, today, toast, api, logAct, loadAll, rerender, parseNum, money, moneyVal,
  dpPercent, openDrawer, closeDrawer, BOOKING_STATUSES } from '../core.js';
import { bookingDrawer } from './detail.js';

const STATUS_LABEL = {NEW:'New', CONTACTED:'Contacted', WAITING_DP:'Waiting DP', CONFIRMED:'Confirmed', BOOKED:'Booked',
  EVENT_DONE:'Event done', DELIVERED:'Delivered', COMPLETED:'Completed', CANCELLED:'Cancelled'};
const newId = (prefix = 'KLA') => {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let x = ''; for(let i = 0; i < 4; i++) x += c[Math.floor(Math.random() * c.length)];
  return `${prefix}-${new Date().getFullYear()}-${x}`;
};
const igNorm = v => { const x = String(v || '').trim().replace(/^@+/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/.*$/, ''); return x ? '@' + x : null; };
const waNorm = v => { let d = String(v || '').replace(/\D/g, ''); if(d.startsWith('0')) d = '62' + d.slice(1); return d || null; };
const services = () => (S.catalog?.services || []).filter(s => !s.hidden);

/* =====================================================================
   1. TAMBAH BOOKING MANUAL
   ===================================================================== */
export function openAddBooking(){
  const svcs = services();
  const st = {svc: svcs[0]?.id || '_other', pkg:''};
  const svcOpt = () => svcs.map(s => `<option value="${esc(s.id)}" ${st.svc === s.id ? 'selected' : ''}>${esc(s.label)}</option>`).join('')
    + `<option value="_other" ${st.svc === '_other' ? 'selected' : ''}>Lainnya (ketik sendiri)</option>`;
  const pkgOpt = () => {
    const s = svcs.find(x => x.id === st.svc);
    const list = s ? s.groups.flatMap(g => g.packages.filter(p => !p.hidden).map(p => ({id:p.id, label:(s.groups.length > 1 ? g.label + ' — ' : '') + p.name, price:p.price, per:p.perPerson}))) : [];
    return list.map(p => `<option value="${esc(p.id)}" data-price="${p.price}" data-per="${p.per ? 1 : 0}" ${st.pkg === p.id ? 'selected' : ''}>${esc(p.label)} · ${rp(p.price)}${p.per ? '/orang' : ''}</option>`).join('')
      + `<option value="_custom" ${st.pkg === '_custom' || !list.length ? 'selected' : ''}>Paket custom (isi nama & harga)</option>`;
  };

  openDrawer(`
    <div class="dh"><div><h2>Tambah booking</h2><div class="tsub">Input manual oleh admin</div></div><button class="x" data-dclose>✕</button></div>
    <div class="fgrid two">
      <div class="fld"><label>Kategori / layanan</label><select id="abSvc">${svcOpt()}</select></div>
      <div class="fld" id="abSvcOtherF" hidden><label>Nama layanan</label><input id="abSvcOther" placeholder="mis. Corporate Event"></div>
    </div>
    <div class="fld"><label>Paket</label><select id="abPkg"></select></div>
    <div class="fgrid two" id="abCustomF">
      <div class="fld"><label>Nama paket</label><input id="abPkgName" placeholder="mis. Paket Custom Wedding"></div>
      <div class="fld money"><label>Harga paket</label><input id="abPkgPrice" inputmode="numeric" placeholder="Rp0"></div>
    </div>
    <div class="fld" id="abPeopleF" hidden><label>Jumlah orang</label><input id="abPeople" type="number" min="1" value="1"></div>

    <div class="sec-h" style="margin:14px 0 8px"><h3 style="font-size:14px">Client</h3>
      <div class="right chips"><button type="button" class="chip on" data-who="single">Perorangan</button><button type="button" class="chip" data-who="couple">Pasangan</button></div></div>
    <div id="abWho"></div>
    <div class="fld"><label>Nomor WhatsApp</label><input id="abWa" inputmode="tel" placeholder="08xxxxxxxxxx"></div>

    <div class="fgrid two">
      <div class="fld"><label>Tanggal sesi *</label><input id="abDate" type="date"></div>
      <div class="fld"><label>Status</label><select id="abStatus">${BOOKING_STATUSES.map(s => `<option value="${s}" ${s === 'CONFIRMED' ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}</select></div>
      <div class="fld"><label>Jam mulai</label><input id="abTime" type="time"></div>
      <div class="fld"><label>Jam selesai</label><input id="abEnd" type="time"></div>
    </div>
    <div class="fld"><label>Lokasi</label><input id="abLoc" placeholder="mis. Gedung Sate, Bandung"></div>
    <div class="fgrid two">
      <div class="fld money"><label>Diskon</label><input id="abDisc" inputmode="numeric" placeholder="Rp0"></div>
      <div class="fld money"><label>Transport</label><input id="abTrans" inputmode="numeric" placeholder="Rp0"></div>
    </div>
    <div class="fgrid two">
      <div class="fld money"><label>Sudah dibayar (DP/lunas)</label><input id="abPaid" inputmode="numeric" placeholder="Rp0"></div>
      <div class="fld"><label>Tanggal bayar</label><input id="abPaidAt" type="date" value="${today()}"></div>
    </div>
    <div class="fld"><label>Catatan</label><textarea id="abNotes" rows="3" placeholder="Kebutuhan khusus, request, dll."></textarea></div>
    <div class="ab-sum" id="abSum"></div>
    <div class="so-acts" style="margin-top:14px"><button class="btn soft" data-dclose>Batal</button><button class="btn" id="abSave">Simpan booking</button></div>`);

  ['abPkgPrice', 'abDisc', 'abTrans', 'abPaid'].forEach(id => money($('#' + id)));
  let who = 'single';
  const paintWho = () => {
    const keep = Object.fromEntries($$('#abWho input').map(i => [i.id, i.value]));
    $('#abWho').innerHTML = who === 'couple' ? `<div class="fgrid two">
        <div class="fld"><label>Nama pengantin wanita *</label><input id="abBride"></div><div class="fld"><label>Instagram wanita</label><input id="abBrideIg" placeholder="@username"></div>
        <div class="fld"><label>Nama pengantin pria *</label><input id="abGroom"></div><div class="fld"><label>Instagram pria</label><input id="abGroomIg" placeholder="@username"></div></div>`
      : `<div class="fgrid two"><div class="fld"><label>Nama client *</label><input id="abClient"></div><div class="fld"><label>Instagram</label><input id="abClientIg" placeholder="@username"></div></div>`;
    Object.entries(keep).forEach(([k, v]) => { const el = $('#' + k); if(el) el.value = v; });
    $$('[data-who]').forEach(b => b.classList.toggle('on', b.dataset.who === who));
  };
  const curPkg = () => { const o = $('#abPkg').selectedOptions[0]; return o && o.value !== '_custom' ? {id:o.value, price:Number(o.dataset.price), per:o.dataset.per === '1'} : null; };
  const total = () => {
    const p = curPkg(), n = Math.max(1, Number($('#abPeople').value) || 1);
    const base = p ? p.price * (p.per ? n : 1) : moneyVal($('#abPkgPrice'));
    return Math.max(0, base + moneyVal($('#abTrans')) - moneyVal($('#abDisc')));
  };
  const paintSum = () => {
    const t = total(), paid = moneyVal($('#abPaid'));
    $('#abSum').innerHTML = `<span>Total invoice</span><b>${rp(t)}</b><span>Dibayar</span><b>${rp(paid)}</b><span>Sisa</span><b>${rp(Math.max(0, t - paid))}</b>`;
  };
  const syncPkg = () => {
    const p = curPkg();
    $('#abCustomF').hidden = !!p;
    $('#abPeopleF').hidden = !(p && p.per);
    paintSum();
  };
  const syncSvc = () => {
    st.svc = $('#abSvc').value;
    $('#abSvcOtherF').hidden = st.svc !== '_other';
    $('#abPkg').innerHTML = pkgOpt();
    const s = svcs.find(x => x.id === st.svc);
    if(s){ who = s.couple ? 'couple' : 'single'; paintWho(); }
    syncPkg();
  };
  $$('[data-who]').forEach(b => b.onclick = () => { who = b.dataset.who; paintWho(); });
  $('#abSvc').onchange = syncSvc;
  $('#abPkg').onchange = syncPkg;
  ['abPeople', 'abPkgPrice', 'abDisc', 'abTrans', 'abPaid'].forEach(id => $('#' + id).addEventListener('input', paintSum));
  paintWho(); syncSvc();

  $('#abSave').onclick = async () => {
    const v = id => ($('#' + id)?.value || '').trim();
    const s = svcs.find(x => x.id === st.svc), p = curPkg();
    const err = [];
    if(who === 'couple' ? !(v('abBride') && v('abGroom')) : !v('abClient')) err.push('nama client');
    if(!v('abDate')) err.push('tanggal sesi');
    if(!s && !v('abSvcOther')) err.push('nama layanan');
    if(!p && !v('abPkgName')) err.push('nama paket');
    if(v('abTime') && v('abEnd') && v('abEnd') <= v('abTime')) return toast('Jam selesai harus setelah jam mulai');
    if(err.length) return toast('Lengkapi: ' + err.join(', '));

    const t = total(), dpPct = dpPercent();
    const row = {
      booking_id: newId(), source:'admin', status: v('abStatus'),
      service: s ? s.label : v('abSvcOther'), service_id: s?.id || null,
      package_id: p?.id || null, package_name: p ? $('#abPkg').selectedOptions[0].textContent.split(' · ')[0] : v('abPkgName'),
      package_price: p ? p.price * (p.per ? Math.max(1, Number(v('abPeople')) || 1) : 1) : moneyVal($('#abPkgPrice')),
      number_of_people: p?.per ? Math.max(1, Number(v('abPeople')) || 1) : null,
      session_date: v('abDate'), session_time: v('abTime') || null, session_end_time: v('abEnd') || null,
      location: v('abLoc') || null, whatsapp: waNorm(v('abWa')), notes: v('abNotes') || null,
      discount: moneyVal($('#abDisc')), transport_charge: moneyVal($('#abTrans')),
      estimated_total: t, estimated_dp: Math.round(t * dpPct / 100), estimated_remaining: t - Math.round(t * dpPct / 100),
      ...(who === 'couple'
        ? {bride_name:v('abBride'), bride_instagram:igNorm(v('abBrideIg')), groom_name:v('abGroom'), groom_instagram:igNorm(v('abGroomIg'))}
        : {client_name:v('abClient'), client_instagram:igNorm(v('abClientIg'))})
    };
    $('#abSave').disabled = true; $('#abSave').textContent = 'Menyimpan…';
    try{
      const [saved] = await api('bookings', {method:'POST', body:row, prefer:'return=representation'});
      const paid = moneyVal($('#abPaid'));
      if(paid > 0) await api('payments', {method:'POST', prefer:'return=minimal',
        body:{booking_id:saved.id, amount:paid, kind: paid >= t ? 'SETTLEMENT' : 'DP', method:'Manual', paid_at: v('abPaidAt') || today()}});
      const name = row.client_name || `${row.bride_name} & ${row.groom_name}`;
      await logAct('create', 'Booking', name, `Ditambahkan manual · ${row.service} · ${row.package_name}${paid ? ` · dibayar ${rp(paid)}` : ''}`);
      await loadAll();
      closeDrawer(); toast('Booking ditambahkan'); rerender();
      bookingDrawer(saved.id);
    }catch(e){
      $('#abSave').disabled = false; $('#abSave').textContent = 'Simpan booking';
      toast('Gagal menyimpan: ' + (/tidak tersedia/i.test(e.message) ? 'paket/layanan sudah tidak aktif di menu' : e.message));
    }
  };
}

/* =====================================================================
   2. IMPOR DATA LAMA (Excel / CSV)
   ===================================================================== */
const FIELDS = [
  {k:'client_name', l:'Nama client', syn:['nama','nama client','client','klien','nama klien','customer','pelanggan','name']},
  {k:'bride_name', l:'Nama pengantin wanita', syn:['pengantin wanita','bride','wanita','cpw']},
  {k:'groom_name', l:'Nama pengantin pria', syn:['pengantin pria','groom','pria','cpp']},
  {k:'whatsapp', l:'WhatsApp / HP', syn:['wa','whatsapp','no wa','nomor wa','hp','no hp','telepon','phone','kontak']},
  {k:'instagram', l:'Instagram', syn:['instagram','ig','akun ig']},
  {k:'service', l:'Kategori / layanan *', syn:['kategori','layanan','service','jenis','event','acara','tipe']},
  {k:'package_name', l:'Paket', syn:['paket','package','nama paket']},
  {k:'package_price', l:'Harga / total *', syn:['harga','total','price','nominal','harga paket','total harga','biaya']},
  {k:'paid', l:'Sudah dibayar', syn:['dibayar','bayar','terbayar','paid','dp','pembayaran','sudah bayar']},
  {k:'discount', l:'Diskon', syn:['diskon','discount','potongan']},
  {k:'session_date', l:'Tanggal sesi *', syn:['tanggal','tanggal sesi','tgl','date','tanggal acara','hari/tanggal']},
  {k:'session_time', l:'Jam', syn:['jam','waktu','time','jam mulai']},
  {k:'location', l:'Lokasi', syn:['lokasi','tempat','venue','location','alamat']},
  {k:'status', l:'Status', syn:['status']},
  {k:'notes', l:'Catatan', syn:['catatan','notes','keterangan','note']},
  {k:'booking_id', l:'ID booking lama', syn:['id','booking id','kode','no booking','invoice']}
];
const STATUS_MAP = [[/batal|cancel/i, 'CANCELLED'], [/selesai|complete|done|lunas/i, 'COMPLETED'], [/deliver|kirim/i, 'DELIVERED'],
  [/book/i, 'BOOKED'], [/confirm|konfirm|deal/i, 'CONFIRMED'], [/dp|tunggu/i, 'WAITING_DP'], [/contact|hubungi/i, 'CONTACTED'], [/baru|new/i, 'NEW']];
const MONTHS = {jan:1, januari:1, feb:2, februari:2, mar:3, maret:3, apr:4, april:4, mei:5, may:5, jun:6, juni:6, jul:7, juli:7,
  agu:8, ags:8, agustus:8, aug:8, august:8, sep:9, sept:9, september:9, okt:10, oct:10, oktober:10, october:10, nov:11, november:11, des:12, dec:12, desember:12, december:12};

const norm = h => String(h || '').toLowerCase().replace(/[^a-z0-9/ ]+/g, ' ').replace(/\s+/g, ' ').trim();
function guessMap(headers){
  const map = {}, used = new Set();
  for(const f of FIELDS){
    const i = headers.findIndex((h, j) => !used.has(j) && f.syn.includes(norm(h)));
    const k = i >= 0 ? i : headers.findIndex((h, j) => !used.has(j) && f.syn.some(s => s.length > 3 && norm(h).includes(s)));
    if(k >= 0){ map[f.k] = k; used.add(k); }
  }
  return map;
}
/* tanggal: Date (Excel), serial Excel, 2024-05-12, 12/05/2024 (hari/bulan), 12 Mei 2024 */
function parseDate(v){
  if(v == null || v === '') return null;
  if(v instanceof Date && !isNaN(v)) return iso(v);
  if(typeof v === 'number' && v > 20000 && v < 80000) return iso(new Date(Math.round((v - 25569) * 86400000) + new Date().getTimezoneOffset() * 60000));
  const s = String(v).trim().toLowerCase();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if(m) return ok(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if(m) return ok(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  m = s.match(/(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})/);
  if(m && MONTHS[m[2]]) return ok(+m[3], MONTHS[m[2]], +m[1]);
  return null;
  function ok(y, mo, d){ return y > 1990 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null; }
}
function parseTime(v){
  if(v == null || v === '') return null;
  if(v instanceof Date && !isNaN(v)) return `${String(v.getHours()).padStart(2, '0')}:${String(v.getMinutes()).padStart(2, '0')}`;
  if(typeof v === 'number' && v >= 0 && v < 1){ const mins = Math.round(v * 1440); return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`; }
  const m = String(v).match(/(\d{1,2})[.:](\d{2})/);
  return m && +m[1] < 24 ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}
const money0 = v => typeof v === 'number' ? Math.round(v) : parseNum(String(v ?? '').replace(/[.,]00$/, ''));

/* CSV sederhana (koma / titik koma, tanda kutip) */
function parseCSV(text){
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : (first.includes('\t') ? '\t' : ',');
  const rows = []; let row = [], cur = '', q = false;
  for(let i = 0; i < text.length; i++){
    const c = text[i];
    if(q){ if(c === '"'){ if(text[i + 1] === '"'){ cur += '"'; i++; } else q = false; } else cur += c; }
    else if(c === '"') q = true;
    else if(c === sep){ row.push(cur); cur = ''; }
    else if(c === '\n' || c === '\r'){ if(c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if(cur || row.length){ row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim()));
}
async function readFile(file){
  if(/\.(csv|txt|tsv)$/i.test(file.name)) return parseCSV(await file.text());
  let XLSX;
  try{ XLSX = await import(/* @vite-ignore */ 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs'); }
  catch(_){ throw new Error('Pembaca Excel gagal dimuat. Simpan file sebagai CSV (File → Save As / Download → CSV) lalu impor lagi.'); }
  const wb = XLSX.read(await file.arrayBuffer(), {cellDates:true});
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:''}).filter(r => r.some(x => String(x).trim()));
}

const IM = {rows:[], headers:[], map:{}, file:'', recordPay:true, busy:false};

export function openImport(){
  IM.rows = []; IM.headers = []; IM.map = {}; IM.file = '';
  paintImport();
}
function buildRecords(){
  const get = (r, k) => IM.map[k] != null ? r[IM.map[k]] : '';
  const existing = new Set(S.data.bookings.map(b => (b.booking_id || '').toLowerCase()));
  const dupKey = new Set(S.data.bookings.map(b => `${(b.client_display || '').toLowerCase()}|${b.session_date}`));
  return IM.rows.map((r, i) => {
    const client = String(get(r, 'client_name') || '').trim(), bride = String(get(r, 'bride_name') || '').trim(), groom = String(get(r, 'groom_name') || '').trim();
    const date = parseDate(get(r, 'session_date')), price = money0(get(r, 'package_price'));
    const service = String(get(r, 'service') || '').trim();
    const stRaw = String(get(r, 'status') || '');
    const status = (STATUS_MAP.find(([re]) => re.test(stRaw)) || [])[1] || (date && date < today() ? 'COMPLETED' : 'BOOKED');
    const name = client || [bride, groom].filter(Boolean).join(' & ');
    const oldId = String(get(r, 'booking_id') || '').trim();
    const issues = [];
    if(!name) issues.push('nama kosong');
    if(!date) issues.push('tanggal tidak terbaca');
    if(!service) issues.push('kategori kosong');
    const dup = (oldId && existing.has(oldId.toLowerCase())) || (name && date && dupKey.has(`${name.toLowerCase()}|${date}`));
    const ig = igNorm(get(r, 'instagram'));
    return {
      line:i + 2, name, issues, dup, paid: money0(get(r, 'paid')),
      row: {
        booking_id: oldId && !existing.has(oldId.toLowerCase()) ? oldId.slice(0, 40) : newId('IMP'), source:'import', status,
        service: service || 'Lainnya', package_name: String(get(r, 'package_name') || '').trim() || service || 'Paket',
        package_price: price, discount: money0(get(r, 'discount')),
        session_date: date, session_time: parseTime(get(r, 'session_time')),
        location: String(get(r, 'location') || '').trim() || null, whatsapp: waNorm(get(r, 'whatsapp')),
        notes: String(get(r, 'notes') || '').trim() || null,
        estimated_total: price,
        // semua baris harus punya kolom yang sama untuk insert massal
        client_name: client || null, client_instagram: client ? ig : null,
        bride_name: client ? null : bride || null, groom_name: client ? null : groom || null, bride_instagram: client ? null : ig
      }
    };
  });
}
function paintImport(){
  const recs = IM.rows.length ? buildRecords() : [];
  const good = recs.filter(r => !r.issues.length && !r.dup), bad = recs.filter(r => r.issues.length), dups = recs.filter(r => !r.issues.length && r.dup);
  const fieldSel = f => `<select data-map="${f.k}"><option value="">— tidak ada —</option>${IM.headers.map((h, i) => `<option value="${i}" ${IM.map[f.k] === i ? 'selected' : ''}>${esc(String(h) || 'Kolom ' + (i + 1))}</option>`).join('')}</select>`;
  openDrawer(`
    <div class="dh"><div><h2>Impor data booking lama</h2><div class="tsub">Dari Excel (.xlsx) atau CSV — misalnya ekspor dari Google Sheets</div></div><button class="x" data-dclose>✕</button></div>
    ${!IM.rows.length ? `
      <ol class="so-steps">
        <li>Siapkan file dengan <b>baris pertama berisi judul kolom</b> (mis. Nama, Tanggal, Kategori, Paket, Harga, Dibayar, WA, Lokasi, Status).</li>
        <li>Kolom wajib: <b>nama client</b>, <b>tanggal sesi</b>, dan <b>kategori</b>. Kolom lain boleh kosong.</li>
        <li>Belum punya format? <button type="button" class="btn ghost sm" id="imTpl" style="padding:2px 8px">Unduh template CSV</button></li>
      </ol>
      <label class="im-drop"><input type="file" id="imFile" hidden accept=".xlsx,.xls,.csv,.tsv,.txt"><b>Pilih file</b><span class="tsub">.xlsx, .xls, atau .csv</span></label>
      <div class="hint" id="imSt"></div>`
    : `
      <div class="card im-file"><b>${esc(IM.file)}</b><span class="tsub">${IM.rows.length} baris data</span><button class="btn ghost sm" id="imReset">Ganti file</button></div>
      <div class="sec-h" style="margin:14px 0 8px"><h3 style="font-size:14px">Cocokkan kolom</h3><span class="tsub">sudah ditebak otomatis — periksa lagi</span></div>
      <div class="im-map">${FIELDS.map(f => `<label><span>${f.l}</span>${fieldSel(f)}</label>`).join('')}</div>
      <div class="im-stats">
        <span class="badge b-ok">${good.length} siap diimpor</span>
        ${dups.length ? `<span class="badge b-warn">${dups.length} sudah ada (dilewati)</span>` : ''}
        ${bad.length ? `<span class="badge b-err">${bad.length} bermasalah (dilewati)</span>` : ''}
      </div>
      <div class="tablewrap im-prev"><table>
        <thead><tr><th>Baris</th><th>Client</th><th>Tanggal</th><th>Kategori · Paket</th><th class="r">Harga</th><th class="r">Dibayar</th><th>Status</th><th>Cek</th></tr></thead>
        <tbody>${recs.slice(0, 60).map(r => `<tr class="${r.issues.length ? 'im-bad' : r.dup ? 'im-dup' : ''}">
          <td class="num">${r.line}</td><td>${esc(r.name || '—')}</td><td class="num">${r.row.session_date || '—'}${r.row.session_time ? ' ' + r.row.session_time : ''}</td>
          <td>${esc(r.row.service)} · ${esc(r.row.package_name)}</td><td class="r num">${rp(r.row.package_price)}</td><td class="r num">${r.paid ? rp(r.paid) : '—'}</td>
          <td>${STATUS_LABEL[r.row.status]}</td><td>${r.issues.length ? `<span style="color:var(--err)">${esc(r.issues.join(', '))}</span>` : r.dup ? '<span style="color:var(--warn-ink)">sudah ada</span>' : '✓'}</td></tr>`).join('')}</tbody>
      </table></div>
      ${recs.length > 60 ? `<div class="tsub" style="margin-top:6px">Menampilkan 60 dari ${recs.length} baris.</div>` : ''}
      <label class="im-opt"><input type="checkbox" id="imPay" ${IM.recordPay ? 'checked' : ''}> Catat kolom "Sudah dibayar" sebagai pembayaran (ikut masuk Keuangan pada tanggal sesi)</label>
      <div class="tsub" style="margin-top:4px">Status kosong → otomatis <b>Completed</b> untuk tanggal yang sudah lewat, <b>Booked</b> untuk yang akan datang.</div>
      <div class="so-acts" style="margin-top:14px"><button class="btn soft" data-dclose>Batal</button>
        <button class="btn" id="imGo" ${good.length && !IM.busy ? '' : 'disabled'}>${IM.busy ? 'Mengimpor…' : `Impor ${good.length} booking`}</button></div>`}`);

  $('#imTpl') && ($('#imTpl').onclick = () => {
    const csv = 'Nama,Pengantin Wanita,Pengantin Pria,WA,Instagram,Kategori,Paket,Harga,Dibayar,Diskon,Tanggal,Jam,Lokasi,Status,Catatan\n'
      + 'Rina Graduation,,,081234567890,@rina,Graduation,Graduation Silver,650000,650000,0,12/05/2024,09:00,UNPAD Jatinangor,Selesai,\n'
      + ',Nadia,Fikri,081298765432,@nadia,Wedding,Wedding Bronze,3700000,1500000,0,2024-11-23,07:00,Gedung Sate Bandung,Booked,Akad pagi\n';
    const a = Object.assign(document.createElement('a'), {href:URL.createObjectURL(new Blob(['﻿' + csv], {type:'text/csv'})), download:'template-impor-booking.csv'});
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#imFile') && ($('#imFile').onchange = async e => {
    const file = e.target.files[0]; if(!file) return;
    $('#imSt').textContent = 'Membaca file…';
    try{
      const rows = await readFile(file);
      if(rows.length < 2) throw new Error('File kosong atau hanya berisi judul kolom');
      IM.headers = rows[0].map(h => String(h).trim()); IM.rows = rows.slice(1); IM.file = file.name;
      IM.map = guessMap(IM.headers);
      paintImport();
    }catch(err){ $('#imSt').textContent = err.message; $('#imSt').style.color = 'var(--err)'; }
  });
  $('#imReset') && ($('#imReset').onclick = openImport);
  $$('[data-map]').forEach(s => s.onchange = () => { const v = s.value; v === '' ? delete IM.map[s.dataset.map] : (IM.map[s.dataset.map] = Number(v)); paintImport(); });
  $('#imPay') && ($('#imPay').onchange = e => { IM.recordPay = e.target.checked; });
  $('#imGo') && ($('#imGo').onclick = () => runImport(good));
}
async function runImport(list){
  IM.busy = true; paintImport();
  let done = 0, payments = 0;
  try{
    for(let i = 0; i < list.length; i += 100){
      const chunk = list.slice(i, i + 100);
      const saved = await api('bookings', {method:'POST', body:chunk.map(r => r.row), prefer:'return=representation'});
      done += saved.length;
      if(IM.recordPay){
        const pays = saved.map((b, j) => ({b, paid:chunk[j].paid, total:chunk[j].row.package_price - chunk[j].row.discount}))
          .filter(x => x.paid > 0)
          .map(x => ({booking_id:x.b.id, amount:x.paid, kind: x.paid >= x.total ? 'SETTLEMENT' : 'DP', method:'Impor data lama',
            paid_at: x.b.session_date && x.b.session_date < today() ? x.b.session_date : today()}));
        if(pays.length){ await api('payments', {method:'POST', body:pays, prefer:'return=minimal'}); payments += pays.length; }
      }
    }
    await logAct('create', 'Booking', `Impor ${IM.file}`, `${done} booking diimpor${payments ? ` · ${payments} pembayaran dicatat` : ''}`);
    await loadAll();
    IM.busy = false; closeDrawer(); rerender();
    toast(`${done} booking berhasil diimpor`);
  }catch(e){
    IM.busy = false;
    if(done){ await loadAll(); rerender(); }
    paintImport();
    toast(`Berhenti setelah ${done} booking: ${e.message}`);
  }
}
