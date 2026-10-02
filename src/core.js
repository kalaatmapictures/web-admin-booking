/* =====================================================================
   KALAATMA BMS — inti: helper, state, data layer, auth, router.
   Data layer berjalan di dua mode dengan bentuk data identik:
   • live : Supabase (login admin) — terhubung dengan landing page
   • demo : data contoh di memori, tidak tersimpan
   ===================================================================== */
import { sb, SUPABASE_URL, SUPABASE_ANON_KEY, supabaseReady } from './data/supabase.js';
import { CATALOG_KEY, defaultCatalog, isCatalog } from './shared/catalog.js';
import { makeDemo } from './demo.js';
import { showNotifications } from './pages/detail.js';

export const CONFIGURED = supabaseReady();

/* ---------- helpers ---------- */
export const $  = s => document.querySelector(s);
export const $$ = s => Array.from(document.querySelectorAll(s));
export const rp = n => 'Rp' + Math.round(Number(n)||0).toLocaleString('id-ID');
export const esc = s => String(s??'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/* tanggal lokal (bukan UTC) — toISOString() menggeser tanggal di zona WIB */
export const iso = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; };
export const today = () => iso(new Date());
export const parseNum = v => Number(String(v??'').replace(/[^\d-]/g,'')) || 0;
export const timeRange = b => b.session_end_time ? `${b.session_time} – ${b.session_end_time}` : (b.session_time||'—');
export const initials = n => (n||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase();
export function fmtDate(d,long){
  if(!d) return '—';
  const o = long ? {day:'numeric',month:'long',year:'numeric'} : {day:'2-digit',month:'short',year:'numeric'};
  return new Date(d+'T00:00:00').toLocaleDateString('id-ID',o);
}
export function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('on'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('on'),2600); }

/* Currency input: tampil Rp1.500.000, nilai asli tetap numeric di dataset.num */
export function money(el, initial){
  const set = n => { el.dataset.num = n; el.value = n ? rp(n) : ''; };
  set(Number(initial)||0);
  el.addEventListener('input', () => {
    const caretEnd = el.selectionStart >= el.value.length;
    const n = parseNum(el.value);
    set(n);
    if(caretEnd) el.setSelectionRange(el.value.length, el.value.length);
    el.dispatchEvent(new CustomEvent('money', {bubbles:true}));
  });
  el.addEventListener('focus', () => el.select());
  return el;
}
export const moneyVal = el => Number(el?.dataset.num || 0);

/* ---------- date ranges ---------- */
export function range(key, custom){
  const d = new Date(); d.setHours(0,0,0,0);
  const mk = (a,b) => ({from: iso(a), to: iso(b)});
  const add = n => { const x=new Date(d); x.setDate(x.getDate()+n); return x; };
  const monday = () => { const x=new Date(d); const w=(x.getDay()+6)%7; x.setDate(x.getDate()-w); return x; };
  const shift = (base, n) => { const x = new Date(base); x.setDate(x.getDate()+n); return x; };
  switch(key){
    case 'today':      return mk(d,d);
    case 'tomorrow':   return mk(add(1),add(1));
    case 'week':       return mk(monday(), shift(monday(), 6));
    case 'nextweek':   return mk(shift(monday(), 7), shift(monday(), 13));
    case 'last7':      return mk(add(-6), d);
    case 'last30':     return mk(add(-29), d);
    case 'month':      return mk(new Date(d.getFullYear(),d.getMonth(),1), new Date(d.getFullYear(),d.getMonth()+1,0));
    case 'nextmonth':  return mk(new Date(d.getFullYear(),d.getMonth()+1,1), new Date(d.getFullYear(),d.getMonth()+2,0));
    case 'lastmonth':  return mk(new Date(d.getFullYear(),d.getMonth()-1,1), new Date(d.getFullYear(),d.getMonth(),0));
    case 'year':       return mk(new Date(d.getFullYear(),0,1), new Date(d.getFullYear(),11,31));
    case 'custom':     return {from: custom?.from || null, to: custom?.to || null};
    default:           return {from:null, to:null};
  }
}
export const inRange = (date, r) => !date || ((!r.from || date >= r.from) && (!r.to || date <= r.to));

/* =====================================================================
   STATE
   ===================================================================== */
export const S = {
  mode:'demo', page:'dashboard', data:{},
  catalog:null, catalogVersion:null,   // menu landing page (satu sumber harga paket)
  admin:{ name:'Demo Admin', email:null }
};
window.S = S;
export const RENDER = {};
let DEMO = null;

/* kategori = nama layanan di menu landing page */
export const categories = () => {
  const fromMenu = (S.catalog?.services || []).map(s => s.label);
  const fromBookings = (S.data.bookings || []).map(b => b.service).filter(Boolean);
  return [...new Set([...fromMenu, ...fromBookings])];
};
export const dpPercent = () => Number(S.catalog?.settings?.dpPercent) || 40;

/* =====================================================================
   DATA LAYER
   ===================================================================== */
async function token(){
  const { data:{ session } } = await sb.auth.getSession();   // diperbarui otomatis oleh supabase-js
  return session?.access_token || SUPABASE_ANON_KEY;
}
export async function api(path, {method='GET', body, prefer}={}){
  const h = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + await token(),
    'Content-Type': 'application/json'
  };
  if(prefer) h.Prefer = prefer;
  const res = await fetch(SUPABASE_URL.replace(/\/+$/,'') + '/rest/v1/' + path, {method, headers:h, body: body!==undefined?JSON.stringify(body):undefined});
  if(!res.ok) throw new Error(res.status + ' — ' + await res.text());
  if(res.status === 204) return null;
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

/* Kolom turunan — persis sama dengan view v_bookings_board di SQL,
   supaya mode demo dan mode Supabase menampilkan angka yang sama. */
export function derive(b, ctx){
  const ph = ctx.freelancers.find(f=>f.id===b.photographer_id);
  const vg = ctx.freelancers.find(f=>f.id===b.videographer_id);
  const eff = b.custom_package_price ?? b.package_price ?? 0;
  const subtotal = eff + (b.add_on_price||0) + (b.additional_charge||0) + (b.extra_time_charge||0) + (b.transport_charge||0) + (b.other_charge||0);
  const total = subtotal - (b.discount||0);
  const dp = dpPercent() / 100;
  const paid = ctx.payments.filter(p=>p.booking_id===b.id)
                 .reduce((n,p)=> n + (p.kind==='REFUND' ? -p.amount : p.amount), 0);
  const crewCost = ctx.crewFees.filter(f=>f.booking_id===b.id).reduce((n,f)=>n+f.fee,0);
  const crew = (!b.needs_photographer || b.photographer_id) && (!b.needs_videographer || b.videographer_id) ? 'COMPLETE'
             : (b.photographer_id || b.videographer_id) ? 'PARTIAL' : 'NOT_ASSIGNED';
  const overdue = !!b.payment_due_date && b.payment_due_date < today() && paid < total;
  const delivMissing = !b.photo_drive_link && !b.video_drive_link && !b.final_file_link;
  return {
    ...b,
    client_display: b.client_name || [b.bride_name,b.groom_name].filter(Boolean).join(' & ') || b.booking_id,
    effective_package_price: eff, master_reference_price: b.package_price,
    subtotal, total_invoice: total,
    dp_amount: Math.round(total*dp), paid_amount: paid, remaining_payment: total - paid,
    payment_status: paid<=0 ? 'UNPAID' : paid>=total ? 'FULLY_PAID' : paid>=total*dp ? 'DP_PAID' : 'PARTIALLY_PAID',
    payment_overdue: overdue,
    crew_cost: crewCost, profit: total - (b.hpp_snapshot||0) - crewCost,
    crew_status: crew,
    photographer_name: ph?.name||null, photographer_wa: ph?.whatsapp||null, photographer_email: ph?.email||null,
    videographer_name: vg?.name||null, videographer_wa: vg?.whatsapp||null, videographer_email: vg?.email||null,
    delivery_missing: delivMissing,
    gcal_synced: !!b.gcal_event_id,
    needs_attention: crew!=='COMPLETE' || overdue || (['EVENT_DONE','DELIVERED'].includes(b.status) && delivMissing)
  };
}
export function deriveLead(l){
  const st = ['WON','LOST'].includes(l.status) ? 'CLOSED'
    : !l.follow_up_date ? 'NONE'
    : l.follow_up_date < today() ? 'OVERDUE'
    : l.follow_up_date === today() ? 'TODAY' : 'SAFE';
  return {...l, follow_up_state: st};
}
/* kolom time Postgres datang sebagai "09:00:00" — tampilkan "09:00" */
const hhmm = t => t ? String(t).slice(0,5) : t;
const normBooking = b => ({...b, session_time:hhmm(b.session_time), session_end_time:hhmm(b.session_end_time), labels:b.labels||[]});

/* Daftar paket untuk halaman Paket & Harga: harga dari menu landing page,
   HPP dari tabel package_costs. */
export function buildPackages(){
  const costs = S.data.packageCosts || {};
  S.data.packages = (S.catalog?.services || []).flatMap(s => s.groups.flatMap(g => g.packages.map(p => {
    const hpp = costs[p.id] ?? 0;
    return {
      id:p.id, service_id:s.id, group_id:g.id, category:s.label,
      name: (s.groups.length > 1 ? g.label + ' — ' : '') + p.name,
      price:p.price, perPerson:!!p.perPerson, hidden:!!(p.hidden || s.hidden),
      hpp_estimate:hpp, margin:p.price - hpp, margin_pct: p.price ? Math.round((p.price-hpp)/p.price*1000)/10 : 0
    };
  })));
}

export async function loadAll(){
  if(S.mode === 'live'){
    const [cfg, bookings, freelancers, payments, costs, leads, clients, transactions, activity] = await Promise.all([
      api(`app_config?key=eq.${CATALOG_KEY}&select=value,updated_at`),
      api('v_bookings_board?select=*'), api('freelancers?select=*&order=name'),
      api('payments?select=*&order=paid_at.desc'), api('package_costs?select=*'),
      api('v_leads_board?select=*&order=created_at.desc'), api('clients?select=*&order=name'),
      api('transactions?select=*&order=occurred_on.desc'),
      api('admin_activity?select=*&order=at.desc&limit=500')
    ]);
    S.catalog = cfg[0] && isCatalog(cfg[0].value) ? cfg[0].value : defaultCatalog();
    S.catalogVersion = cfg[0]?.updated_at ?? null;
    S.data = {bookings: bookings.map(normBooking), freelancers, payments, leads, clients, transactions, crewFees:[], activity,
              packageCosts: Object.fromEntries(costs.map(c => [c.package_id, c.hpp_estimate]))};
  } else {
    if(!DEMO){ DEMO = makeDemo(); S.catalog = defaultCatalog(); S.catalogVersion = null; }
    const d = DEMO;
    S.data = {
      bookings: d.bookings.map(b => derive(b, d)),
      freelancers: d.freelancers, payments: d.payments, packageCosts: d.packageCosts,
      leads: d.leads.map(deriveLead), clients: d.clients, transactions: d.transactions, crewFees: d.crewFees,
      activity: d.activity
    };
  }
  buildPackages();
  refreshBell();
}

/* ---------- log aktivitas admin ---------- */
const FIELD = {
  status:'Status', photographer_id:'Photographer', videographer_id:'Videographer',
  needs_photographer:'Butuh photographer', needs_videographer:'Butuh videographer',
  custom_package_price:'Harga package', additional_charge:'Additional', extra_time_charge:'Extra time',
  transport_charge:'Transport', other_charge:'Other charge', discount:'Discount',
  photo_drive_link:'Link foto', video_drive_link:'Link video', raw_file_link:'Link raw', final_file_link:'Link final',
  delivery_date:'Tanggal delivery', labels:'Label', payment_due_date:'Jatuh tempo',
  rate:'Rate', rate_type:'Tipe rate', gear:'Gear', is_active:'Aktif',
  kind:'Jenis', amount:'Jumlah', category:'Kategori', description:'Deskripsi', occurred_on:'Tanggal', booking_id:'Project',
  hpp_estimate:'HPP'
};
const MONEY_F = new Set(['custom_package_price','additional_charge','extra_time_charge','transport_charge','other_charge','discount','rate','amount','hpp_estimate']);
const LINK_F = new Set(['photo_drive_link','video_drive_link','raw_file_link','final_file_link']);
function fmtField(k, v){
  if(v === null || v === undefined || v === '') return '—';
  if(MONEY_F.has(k)) return rp(v);
  if(LINK_F.has(k)) return 'terisi';
  if(k === 'photographer_id' || k === 'videographer_id') return S.data.freelancers.find(f => f.id === v)?.name || '—';
  if(k === 'booking_id') return S.data.bookings.find(b => b.id === v)?.client_display || '—';
  if(typeof v === 'boolean') return v ? 'Ya' : 'Tidak';
  if(Array.isArray(v)) return v.length ? v.join(', ') : '—';
  return String(v);
}
export function describe(before, patch){
  const out = [];
  for(const [k, v] of Object.entries(patch)){
    if(!(k in FIELD)) continue;
    let a = before?.[k];
    if(k === 'custom_package_price') a = before?.effective_package_price;
    if(JSON.stringify(a ?? null) === JSON.stringify(v ?? null)) continue;
    if(LINK_F.has(k)){ out.push(`${FIELD[k]} ${v ? (a ? 'diubah' : 'diisi') : 'dikosongkan'}`); continue; }
    out.push(`${FIELD[k]}: ${fmtField(k, a)} → ${fmtField(k, v)}`);
  }
  return out.join(' · ');
}
export async function logAct(action, entity, target, detail){
  const row = { actor:S.admin.name, action, entity, target:String(target||'—'), detail:detail || null };
  try{
    if(S.mode === 'live'){
      const [saved] = await api('admin_activity', {method:'POST', body:row, prefer:'return=representation'});
      S.data.activity.unshift(saved);
    } else {
      S.data.activity.unshift({ id:'act-'+Date.now(), at:new Date().toISOString(), ...row });
    }
  }catch(e){ console.warn('[Kalaatma] log aktivitas gagal:', e.message); }
}

/* ---------- tulis data (semua perubahan tercatat di log) ---------- */
export async function saveBooking(id, patch){
  const before = S.data.bookings.find(b=>b.id===id);
  if(S.mode === 'live'){
    await api('bookings?id=eq.' + id, {method:'PATCH', body:patch, prefer:'return=minimal'});
    const fresh = await api('v_bookings_board?select=*&id=eq.' + id);
    const i = S.data.bookings.findIndex(b=>b.id===id);
    if(i>-1 && fresh[0]) S.data.bookings[i] = normBooking(fresh[0]);
  } else {
    const raw = DEMO.bookings.find(b=>b.id===id);
    Object.assign(raw, patch);
    if(!raw.invoice_number && ['CONFIRMED','BOOKED','EVENT_DONE','DELIVERED','COMPLETED'].includes(raw.status)){
      DEMO.invSeq++; raw.invoice_number = 'INV-KAL-' + today().slice(0,7).replace('-','') + '-' + String(DEMO.invSeq).padStart(3,'0');
    }
    const i = S.data.bookings.findIndex(b=>b.id===id);
    S.data.bookings[i] = derive(raw, DEMO);
  }
  const detail = describe(before, patch);
  if(detail) await logAct(patch.status && patch.status !== before?.status ? 'status' : 'update', 'Booking', before?.client_display, detail);
  refreshBell();
}
const PAY_TX = {DP:['IN','DP Booking'], INSTALLMENT:['IN','Cicilan'], SETTLEMENT:['IN','Pelunasan'], REFUND:['OUT','Refund']};
export async function addPayment(bookingId, row){
  const b = S.data.bookings.find(x => x.id === bookingId);
  if(S.mode === 'live'){
    // trigger di database mencatat transaksi kas secara otomatis
    await api('payments', {method:'POST', body:{booking_id:bookingId, ...row}, prefer:'return=minimal'});
    await loadAll();
  } else {
    const p = {id:'pay-'+Math.random().toString(36).slice(2,9), booking_id:bookingId, ...row};
    DEMO.payments.push(p);
    const [kind, category] = PAY_TX[row.kind] || ['IN','Pembayaran'];
    DEMO.transactions.unshift({id:'tx-'+Math.random().toString(36).slice(2,9), kind, amount:row.amount, category,
      description:`${category} — ${b?.client_display||''}`, booking_id:bookingId, payment_id:p.id, occurred_on:row.paid_at});
    const raw = DEMO.bookings.find(x => x.id === bookingId);
    S.data.bookings[S.data.bookings.findIndex(x => x.id === bookingId)] = derive(raw, DEMO);
  }
  await logAct('create', 'Pembayaran', b?.client_display, `${row.kind} ${rp(row.amount)}${row.method ? ' · ' + row.method : ''}`);
  refreshBell();
}
const ENTITY = {freelancers:'Freelancer', transactions:'Transaksi', leads:'Lead', clients:'Client'};
const rowName = (store, r) => r ? (r.name || r.description || r.client_display || r.id) : '—';
export async function saveRow(table, id, patch, store){
  const arr = S.data[store]; const i = arr.findIndex(r=>r.id===id);
  const before = i > -1 ? {...arr[i]} : null;
  if(S.mode === 'live') await api(table + '?id=eq.' + id, {method:'PATCH', body:patch, prefer:'return=minimal'});
  if(i>-1) Object.assign(arr[i], patch);
  const detail = describe(before, patch);
  if(detail) await logAct('update', ENTITY[store] || table, rowName(store, before), detail);
}
export async function deleteRow(table, id, store){
  const before = S.data[store].find(r => r.id === id);
  if(S.mode === 'live') await api(`${table}?id=eq.${id}`, {method:'DELETE', prefer:'return=minimal'});
  const i = S.data[store].findIndex(r => r.id === id); if(i > -1) S.data[store].splice(i, 1);
  await logAct('delete', ENTITY[store] || table, rowName(store, before),
    before?.amount ? `${before.kind === 'OUT' ? 'Pengeluaran' : 'Pemasukan'} ${rp(before.amount)}` : null);
}
export async function insertRow(table, row, store){
  if(S.mode === 'live'){ await api(table, {method:'POST', body:row, prefer:'return=minimal'}); await loadAll(); }
  else {
    const local = {id: table.slice(0,3)+'-'+Math.random().toString(36).slice(2,9), created_at:new Date().toISOString(), ...row};
    S.data[store].unshift(store === 'leads' ? deriveLead(local) : local);
  }
  await logAct('create', ENTITY[store] || table, rowName(store, row),
    row.amount ? `${row.kind === 'OUT' ? 'Pengeluaran' : 'Pemasukan'} ${rp(row.amount)}` : null);
}

/* ---------- menu landing page (katalog) ---------- */
/* { ok:true } | { ok:false, conflict:true } | { ok:false, error } */
export async function saveCatalog(){
  if(!isCatalog(S.catalog)) return {ok:false, error:'Format menu tidak valid'};
  if(S.mode !== 'live') return {ok:true};
  try{
    if(S.catalogVersion === null){
      const [row] = await api('app_config', {method:'POST', body:{key:CATALOG_KEY, value:S.catalog}, prefer:'return=representation'});
      S.catalogVersion = row.updated_at;
      return {ok:true};
    }
    // hanya berhasil bila belum diubah admin lain sejak dimuat
    const rows = await api(`app_config?key=eq.${CATALOG_KEY}&updated_at=eq.${encodeURIComponent(S.catalogVersion)}`,
      {method:'PATCH', body:{value:S.catalog}, prefer:'return=representation'});
    if(!rows.length) return {ok:false, conflict:true};
    S.catalogVersion = rows[0].updated_at;
    return {ok:true};
  }catch(e){
    return /23505|duplicate/.test(e.message) ? {ok:false, conflict:true} : {ok:false, error:e.message};
  }
}
export async function reloadCatalog(){
  if(S.mode !== 'live') return;
  const cfg = await api(`app_config?key=eq.${CATALOG_KEY}&select=value,updated_at`);
  S.catalog = cfg[0] && isCatalog(cfg[0].value) ? cfg[0].value : defaultCatalog();
  S.catalogVersion = cfg[0]?.updated_at ?? null;
}
/* simpan menu; bila gagal, perubahan dibuang dengan memuat ulang data terakhir */
export async function commitCatalog(log, msg = 'Menu tersimpan'){
  document.body.classList.add('saving');
  try{
    const res = await saveCatalog();
    if(res.ok){
      if(log) await logAct(log.action, log.entity, log.target, log.detail);
      toast(msg);
    } else {
      try{ await reloadCatalog(); }catch(_){}
      toast(res.conflict ? 'Menu baru saja diubah admin lain — data terbaru dimuat, silakan ulangi' : 'Gagal menyimpan: ' + res.error);
    }
    return res.ok;
  } finally {
    document.body.classList.remove('saving');
    buildPackages();
  }
}
export function resetDemoCatalog(){ S.catalog = defaultCatalog(); }
export async function saveCost(packageId, hpp){
  if(S.mode === 'live') await api('package_costs', {method:'POST', body:{package_id:packageId, hpp_estimate:hpp}, prefer:'resolution=merge-duplicates,return=minimal'});
  S.data.packageCosts[packageId] = hpp;
  buildPackages();
}

/* =====================================================================
   AUTH
   ===================================================================== */
async function resolveAdmin(){
  const { data:{ user } } = await sb.auth.getUser();
  if(!user) return 'login';
  const rows = await api(`admins?user_id=eq.${user.id}&select=name`);
  if(!rows.length){ await sb.auth.signOut(); return 'Akun ini belum terdaftar sebagai admin.'; }
  S.admin = { name: rows[0].name || user.email, email: user.email };
  return null;
}
function showLoginError(msg){
  const err = $('#loginErr');
  err.textContent = msg; err.style.display = msg ? 'block' : 'none';
}

export function initAuth(){
  $('#cfgNote').textContent = CONFIGURED
    ? 'Masuk dengan akun admin yang terdaftar di Supabase.'
    : 'Supabase belum dikonfigurasi — isi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY. Sementara bisa melihat mode demo.';
  $('#loginBtn').disabled = !CONFIGURED;
  $('#demoBtn').hidden = CONFIGURED;

  const login = async () => {
    showLoginError('');
    const btn = $('#loginBtn'); btn.disabled = true; btn.textContent = 'Memeriksa…';
    try{
      const { error } = await sb.auth.signInWithPassword({ email:$('#liEmail').value.trim(), password:$('#liPass').value });
      if(error) throw new Error(error.message === 'Invalid login credentials' ? 'Email atau password salah.' : error.message);
      const msg = await resolveAdmin();
      if(msg) throw new Error(msg);
      S.mode = 'live';
      $('#liPass').value = '';
      await start();
    }catch(e){ showLoginError(e.message); }
    btn.disabled = false; btn.textContent = 'Masuk';
  };
  $('#loginBtn').onclick = login;
  $('#liPass').addEventListener('keydown', e => { if(e.key === 'Enter') login(); });
  $('#demoBtn').onclick = () => { S.mode='demo'; S.admin = {name:'Demo Admin', email:null}; start(); };
  $('#logoutBtn').onclick = async () => {
    if(S.mode === 'live') await sb.auth.signOut();
    S.mode = 'demo';
    $('#app').classList.remove('on'); $('#login').style.display='grid';
  };

  // sesi tersimpan → langsung masuk
  (async () => {
    if(!CONFIGURED) return;
    const { data:{ session } } = await sb.auth.getSession();
    if(!session) return;
    try{
      const msg = await resolveAdmin();
      if(msg){ showLoginError(msg === 'login' ? '' : msg); return; }
      S.mode = 'live';
      await start();
    }catch(e){ showLoginError('Gagal memeriksa sesi: ' + e.message); }
  })();
}

async function start(){
  try{ await loadAll(); }
  catch(e){ showLoginError('Gagal memuat data: ' + e.message); return; }
  $('#login').style.display = 'none';
  $('#app').classList.add('on');
  $('#whoName').textContent = S.admin.name;
  $('#whoMode').textContent = S.mode === 'live' ? 'Terhubung Supabase' : 'Mode demo';
  $('#modeBanner').innerHTML = S.mode === 'demo'
    ? `<div class="banner"><b>Mode demo.</b>&nbsp;Data contoh, tidak tersimpan dan tidak terhubung ke landing page. Isi kredensial Supabase untuk memakai data asli.</div>` : '';
  buildNav();
  go(S.page);
}

/* =====================================================================
   NAV & ROUTER
   ===================================================================== */
const ICONS = {
  dashboard:'<path d="M3 12h7V3H3zM14 8h7V3h-7zM14 21h7v-9h-7zM3 21h7v-5H3z"/>',
  booking:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 11h18"/>',
  joblist:'<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="9.5" y="4" width="5" height="11" rx="1.5"/><rect x="16" y="4" width="5" height="14" rx="1.5"/>',
  lead:'<path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/>',
  client:'<path d="M20 21v-2a4 4 0 0 0-3-3.9M4 21v-2a4 4 0 0 1 3-3.9"/><circle cx="12" cy="8" r="4"/>',
  freelancer:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/>',
  paket:'<path d="M21 8v8a2 2 0 0 1-1 1.7l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.7l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z"/><path d="M3.3 7L12 12l8.7-5M12 22V12"/>',
  menu:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 8h10M7 12h10M7 16h6"/>',
  kas:'<rect x="2" y="6" width="20" height="13" rx="3"/><path d="M2 11h20"/><circle cx="17" cy="15" r="1.4"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 11h18"/><circle cx="8.5" cy="15.5" r="1.2"/><circle cx="12" cy="15.5" r="1.2"/>',
  activity:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
};
export const PAGES = [
  {id:'dashboard',  label:'Dashboard', title:'Dashboard'},
  {id:'booking',    label:'Booking',   title:'Booking'},
  {id:'joblist',    label:'Joblist',   title:'Joblist'},
  {id:'lead',       label:'Lead',      title:'Lead'},
  {id:'client',     label:'Client',    title:'Completed Client'},
  {id:'freelancer', label:'Freelancer',title:'Freelancer'},
  {id:'paket',      label:'Paket',     title:'Paket & Harga'},
  {id:'menu',       label:'Menu',      title:'Menu Landing Page'},
  {id:'kas',        label:'Keuangan',  title:'Keuangan / Kas'},
  {id:'calendar',   label:'Kalender',  title:'Kalender'},
  {id:'activity',   label:'Aktivitas', title:'Log Aktivitas'}
];
export const svg = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;

function buildNav(){
  $('#nav').innerHTML = PAGES.map(p =>
    `<button class="navlink" data-go="${p.id}">${svg(p.id)}${p.label}<span class="cnt hide" data-badge="${p.id}"></span></button>`).join('');
  $('#mobnav').innerHTML = PAGES.map(p =>
    `<button data-go="${p.id}">${svg(p.id)}<span>${p.label}</span></button>`).join('');
  $$('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
  refreshBell();
}
export function go(id){
  S.page = id;
  const p = PAGES.find(x=>x.id===id);
  $('#pgTitle').textContent = p.title;
  $('#pgSub').textContent = '';
  $$('[data-go]').forEach(b => b.classList.toggle('on', b.dataset.go === id));
  RENDER[id]();
  window.scrollTo({top:0,behavior:'smooth'});
}
/* render ulang halaman aktif */
export const rerender = () => RENDER[S.page]();

export function refreshBell(){
  const n = (S.data.bookings||[]).filter(b => b.crew_status !== 'COMPLETE' && !['CANCELLED','COMPLETED'].includes(b.status)).length;
  const el = $('#bellCount');
  el.textContent = n; el.classList.toggle('hide', n === 0);
  const badge = $('[data-badge="booking"]');
  if(badge){ badge.textContent = n; badge.classList.toggle('hide', n === 0); }
}

/* drawer & modal plumbing */
export function openDrawer(html){ $('#drawerBody').innerHTML = html; $('#drawer').classList.add('open'); }
export function closeDrawer(){ $('#drawer').classList.remove('open'); }
export function openModal(html){ $('#modalBody').innerHTML = html; $('#modal').classList.add('open'); }
export function closeModal(){ $('#modal').classList.remove('open'); }
export function initShell(){
  $('#bellBtn').onclick = () => showNotifications();
  document.addEventListener('click', e => {
    if(e.target.hasAttribute?.('data-dclose')) closeDrawer();
    if(e.target.hasAttribute?.('data-mclose')) closeModal();
    if(e.target.hasAttribute?.('data-iclose')) $('#invoiceModal').classList.remove('open');
  });
  document.addEventListener('keydown', e => { if(e.key==='Escape'){ closeDrawer(); closeModal(); $('#invoiceModal').classList.remove('open'); }});
}

/* konfirmasi berbasis modal → Promise<boolean> */
export function confirmBox(title, text, yes = 'Ya, hapus', danger = true){
  return new Promise(res => {
    openModal(`<div class="warnicon" style="${danger ? 'background:var(--err-bg);color:var(--err)' : ''}">${danger ? '🗑' : '⚠'}</div>
      <h3>${esc(title)}</h3><p>${esc(text)}</p>
      <div class="acts"><button class="btn soft" id="cfNo">Batal</button><button class="btn ${danger ? 'danger' : ''}" id="cfYes">${esc(yes)}</button></div>`);
    $('#cfNo').onclick = () => { closeModal(); res(false); };
    $('#cfYes').onclick = () => { closeModal(); res(true); };
  });
}

/* =====================================================================
   UI HELPERS BERSAMA
   ===================================================================== */
/* Handler didaftarkan lewat registry + event delegation, bukan setTimeout,
   supaya klik yang terjadi tepat setelah render tetap tertangkap. */
const HANDLERS = {};
document.addEventListener('click', e => {
  const btn = e.target.closest?.('[data-v]');
  if(!btn) return;
  const bar = btn.closest('[data-bar]');
  if(bar && HANDLERS[bar.dataset.bar]) HANDLERS[bar.dataset.bar](btn.dataset.v);
});
document.addEventListener('change', e => {
  const bar = e.target.closest?.('[data-range]');
  if(!bar || !HANDLERS[bar.dataset.range]) return;
  const [a,b] = bar.querySelectorAll('input[type=date]');
  HANDLERS[bar.dataset.range]({from:a.value||null, to:b.value||null});
});
let barSeq = 0;
export function chipbar(opts, active, onPick, alt){
  const id = 'cb' + (++barSeq);
  HANDLERS[id] = onPick;
  return `<div class="chips" data-bar="${id}">${opts.map(o =>
    `<button class="chip ${alt?'alt':''} ${o.v===active?'on':''}" data-v="${esc(o.v)}">${esc(o.l)}</button>`).join('')}</div>`;
}
export function customRange(f, onChange){
  const id = 'cr' + (++barSeq);
  HANDLERS[id] = onChange;
  const st = 'background:#fff;border:0;border-radius:99px;padding:8px 13px;font-size:12px;box-shadow:var(--shadow)';
  return `<div class="chips" data-range="${id}" style="align-items:center">
    <input type="date" value="${f.from||''}" style="${st}">
    <span style="color:var(--muted);font-size:12px">s/d</span>
    <input type="date" value="${f.to||''}" style="${st}">
  </div>`;
}
export const crewBadge = s => s==='COMPLETE' ? '<span class="badge b-ok"><span class="d"></span>Complete</span>'
  : s==='PARTIAL' ? '<span class="badge b-warn"><span class="d"></span>Partial</span>'
  : '<span class="badge b-err"><span class="d"></span>Not Assigned</span>';
export const payBadge = s => ({
  FULLY_PAID:'<span class="badge b-ok">Lunas</span>',
  DP_PAID:'<span class="badge b-neutral">DP Paid</span>',
  PARTIALLY_PAID:'<span class="badge b-warn">Partially Paid</span>',
  UNPAID:'<span class="badge b-grey">Belum bayar</span>'
}[s] || '');
export const statusBadge = s => `<span class="badge ${
  ['COMPLETED','DELIVERED'].includes(s) ? 'b-ok' :
  s==='CANCELLED' ? 'b-err' :
  ['CONFIRMED','BOOKED'].includes(s) ? 'b-neutral' : 'b-grey'}">${String(s).replace(/_/g,' ')}</span>`;
export const empty = (t,s) => `<div class="empty"><div class="ic">${svg('booking')}</div><b>${t}</b><span>${s}</span></div>`;
export const BOOKING_STATUSES = ['NEW','CONTACTED','WAITING_DP','CONFIRMED','BOOKED','EVENT_DONE','DELIVERED','COMPLETED','CANCELLED'];

/* filter state per halaman */
export const F = {
  dash:    {product:'All', date:'month', custom:{}},
  booking: {date:'all', custom:{}, sort:'nearest', crew:'all', requireCrew:false},
  lead:    {date:'all', custom:{}, sort:'newest'},
  client:  {cat:'ALL', from:null, to:null, monthLabel:null, sort:'newest'},
  kas:     {from:null, to:null, monthLabel:null, cat:'ALL', init:false},
  activity:{q:'', action:'', entity:''}
};
window.F = F;
