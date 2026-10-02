/* =========================================================
   KALAATMA ADMIN
   Mengatur menu landing page (layanan, paket, add-on, S&K,
   pengaturan) dan mencatat setiap perubahan ke log aktivitas.
   ========================================================= */
import { defaultCatalog, publicCatalog, isCatalog } from './shared/catalog.js';
import {
  mode, admin, checkSession, signIn, signOut,
  loadCatalog, saveCatalog, loadActivity, logActivity,
  canClearActivity, clearActivity, onExternalChange
} from './data/store.js';
import { LANDING_URL } from './data/config.js';

let catalog = null;   // dokumen menu yang sedang diedit
let activity = [];    // cache log aktivitas, terbaru di depan
const ui = { route:'dashboard', svc:null, logQ:'', logAction:'', logEntity:'' };

/* ---------- helpers ---------- */
const $  = s => document.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rp = n => 'Rp' + Math.round(n || 0).toLocaleString('id-ID');
const slug = t => String(t).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'item';
const newId = t => `${slug(t)}-${Math.random().toString(36).slice(2, 6)}`;
const move = (arr, i, d) => { const j = i + d; if(j < 0 || j >= arr.length) return false; [arr[i], arr[j]] = [arr[j], arr[i]]; return true; };
const findSvc = id => catalog.services.find(s => s.id === id);

const I = {
  plus:'<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  edit:'<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
  trash:'<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  up:'<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>',
  down:'<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
  eye:'<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff:'<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17.3 17.3 0 0 0 2 12s3.6 7 10 7a9.9 9.9 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  ext:'<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  download:'<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>'
};

/* ---------- persist + log ---------- */
let toastTimer;
function toast(msg){
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
async function addLog(entry){
  const saved = await logActivity(entry);
  if(saved) activity.unshift(saved);
}
/* simpan katalog; bila gagal, buang perubahan dengan memuat ulang data terakhir */
async function commit(entry, msg = 'Perubahan tersimpan'){
  const view = $('#view');
  view.inert = true;
  document.body.classList.add('saving');
  try{
    const res = await saveCatalog(catalog);
    if(res.ok){
      if(entry) await addLog(entry);
      toast(msg);
    } else {
      try{ catalog = await loadCatalog(); }catch(_){}
      toast(res.conflict
        ? 'Menu baru saja diubah admin lain — data terbaru dimuat, silakan ulangi perubahan Anda'
        : 'Gagal menyimpan: ' + res.error);
    }
  } finally {
    view.inert = false;
    document.body.classList.remove('saving');
    render();
  }
}

const BOOL = v => v ? 'Ya' : 'Tidak';
const LIST = (a, b) => `${a.length} → ${b.length} poin`;
function diff(before, after, spec){
  const out = [];
  for(const [key, label, fmt] of spec){
    const a = before[key], b = after[key];
    // kosong / null / undefined dianggap sama; begitu pula false vs belum diisi
    const norm = v => fmt === 'bool' ? !!v : (v === '' || v === undefined ? null : v);
    if(JSON.stringify(norm(a)) === JSON.stringify(norm(b))) continue;
    if(fmt === 'list'){ out.push(`${label} diubah (${LIST(a || [], b || [])})`); continue; }
    const f = fmt === 'rp' ? rp : fmt === 'bool' ? BOOL : (v => v === '' || v == null ? '—' : v);
    out.push(`${label}: ${f(a)} → ${f(b)}`);
  }
  return out.join(' · ');
}

/* ---------- form builder (drawer & halaman pengaturan) ---------- */
function fieldHtml(f, v){
  const id = 'fld-' + f.key;
  const req = f.req ? ' <span class="req">*</span>' : '';
  const help = f.help ? `<div class="help">${f.help}</div>` : '';
  const err = `<div class="err">${esc(f.err || 'Wajib diisi.')}</div>`;
  if(f.type === 'check') return `
    <label class="check"><input type="checkbox" data-key="${f.key}" ${v ? 'checked' : ''}>
      <span><b>${esc(f.label)}</b>${f.help ? `<small>${f.help}</small>` : ''}</span></label>`;
  if(f.type === 'select') return `
    <div class="fld" data-fld="${f.key}"><label for="${id}">${esc(f.label)}${req}</label>
      <select id="${id}" data-key="${f.key}">${f.options.map(([val, lab]) =>
        `<option value="${esc(val)}" ${String(v ?? '') === String(val) ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>${help}${err}</div>`;
  if(f.type === 'textarea') return `
    <div class="fld" data-fld="${f.key}"><label for="${id}">${esc(f.label)}${req}</label>
      <textarea id="${id}" data-key="${f.key}" placeholder="${esc(f.placeholder || '')}">${esc(Array.isArray(v) ? v.join('\n') : v)}</textarea>${help}${err}</div>`;
  const input = `<input id="${id}" data-key="${f.key}" type="${f.type === 'number' ? 'number' : f.type === 'tel' ? 'tel' : 'text'}"
      ${f.type === 'number' ? `inputmode="numeric" min="${f.min ?? 0}" ${f.max != null ? `max="${f.max}"` : ''} step="${f.step ?? 1}"` : ''}
      value="${esc(v ?? '')}" placeholder="${esc(f.placeholder || '')}">`;
  return `
    <div class="fld" data-fld="${f.key}"><label for="${id}">${esc(f.label)}${req}</label>
      ${f.prefix ? `<div class="prefix"><span>${f.prefix}</span>${input}</div>` : input}${help}${err}</div>`;
}
function formHtml(fields, values){
  return fields.map(f => f.row
    ? `<div class="form-grid two">${f.row.map(x => fieldHtml(x, values[x.key])).join('')}</div>`
    : f.legend ? `<fieldset class="fset"><legend>${esc(f.legend)}</legend>${formHtml(f.fields, values)}</fieldset>`
    : fieldHtml(f, values[f.key])).join('');
}
const flatFields = fields => fields.flatMap(f => f.row || (f.fields ? flatFields(f.fields) : [f]));
/* baca & validasi; kembalikan null bila ada yang salah */
function collect(root, fields){
  const out = {}; let firstBad = null;
  for(const f of flatFields(fields)){
    const el = root.querySelector(`[data-key="${f.key}"]`); if(!el) continue;
    let v;
    if(f.type === 'check') v = el.checked;
    else if(f.type === 'number') v = el.value === '' ? null : Number(el.value);
    else if(f.type === 'textarea' && f.lines) v = el.value.split('\n').map(s => s.trim()).filter(Boolean);
    else v = el.value.trim();
    let ok = true;
    if(f.req && (v === '' || v == null || (Array.isArray(v) && !v.length))) ok = false;
    if(ok && f.type === 'number' && v != null && (Number.isNaN(v) || v < (f.min ?? 0) || (f.max != null && v > f.max))) ok = false;
    if(ok && f.pattern && v && !f.pattern.test(v)) ok = false;
    if(ok && f.check){ const msg = f.check(v, root); if(msg){ ok = false; root.querySelector(`[data-fld="${f.key}"] .err`).textContent = msg; } }
    const wrap = root.querySelector(`[data-fld="${f.key}"]`);
    wrap?.classList.toggle('bad', !ok);
    if(!ok && !firstBad) firstBad = el;
    out[f.key] = v;
  }
  if(firstBad){ firstBad.focus(); return null; }
  return out;
}

let drawerResolve = null;
function openForm({eyebrow, title, submit = 'Simpan', fields, values = {}}){
  $('#drawerEyebrow').textContent = eyebrow || '';
  $('#drawerTitle').textContent = title;
  $('#drawerSubmit').textContent = submit;
  $('#drawerBody').innerHTML = `<div class="form-grid">${formHtml(fields, values)}</div>`;
  $('#drawer').hidden = false;
  $$('#drawerBody input, #drawerBody textarea').forEach(el =>
    el.addEventListener('input', () => el.closest('.fld')?.classList.remove('bad')));
  setTimeout(() => $('#drawerBody [data-key]')?.focus(), 50);
  return new Promise(res => {
    drawerResolve = res;
    $('#drawerForm').onsubmit = e => {
      e.preventDefault();
      const v = collect($('#drawerBody'), fields);
      if(v) closeDrawer(v);
    };
  });
}
function closeDrawer(result = null){
  $('#drawer').hidden = true;
  drawerResolve?.(result); drawerResolve = null;
}
$$('[data-drawer-close]').forEach(b => b.addEventListener('click', () => closeDrawer()));

let confirmResolve = null;
function confirmBox(title, text, yes = 'Hapus'){
  $('#confirmTitle').textContent = title;
  $('#confirmText').textContent = text;
  $('#confirmYes').textContent = yes;
  $('#confirm').hidden = false;
  setTimeout(() => $('#confirmYes').focus(), 30);
  return new Promise(res => confirmResolve = res);
}
$$('[data-confirm]').forEach(b => b.addEventListener('click', () => {
  $('#confirm').hidden = true;
  confirmResolve?.(b.dataset.confirm === 'yes'); confirmResolve = null;
}));
document.addEventListener('keydown', e => {
  if(e.key !== 'Escape') return;
  if(!$('#confirm').hidden){ $('#confirm').hidden = true; confirmResolve?.(false); confirmResolve = null; }
  else if(!$('#drawer').hidden) closeDrawer();
  else $('.app').classList.remove('nav-open');
});

/* ---------- waktu ---------- */
function ago(iso){
  const s = (Date.now() - new Date(iso)) / 1000;
  if(s < 60) return 'baru saja';
  if(s < 3600) return `${Math.floor(s / 60)} menit lalu`;
  if(s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  if(s < 172800) return 'kemarin';
  return new Date(iso).toLocaleDateString('id-ID', {day:'numeric', month:'short', year:'numeric'});
}
const hm = iso => new Date(iso).toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'});
const dayLabel = iso => {
  const d = new Date(iso), t = new Date();
  const k = x => x.toDateString();
  if(k(d) === k(t)) return 'Hari ini';
  t.setDate(t.getDate() - 1);
  if(k(d) === k(t)) return 'Kemarin';
  return d.toLocaleDateString('id-ID', {weekday:'long', day:'numeric', month:'long', year:'numeric'});
};
const ACT = {create:'Tambah', update:'Ubah', delete:'Hapus', hide:'Sembunyi', show:'Tampil', reorder:'Urutan', system:'Data'};

/* =========================================================
   VIEW · DASHBOARD
   ========================================================= */
function priceRange(s){
  const ps = s.groups.flatMap(g => g.packages);
  if(!ps.length) return '—';
  const lo = Math.min(...ps.map(p => p.price)), hi = Math.max(...ps.map(p => p.price));
  return lo === hi ? rp(lo) : `${rp(lo)} – ${rp(hi)}`;
}
function viewDashboard(){
  const pub = publicCatalog(catalog);
  const pubSvcs = Object.values(pub.services);
  const allPkgs = catalog.services.flatMap(s => s.groups.flatMap(g => g.packages));
  const pubPkgs = pubSvcs.flatMap(s => s.groups.flatMap(g => g.packages));
  const pubAddons = pubSvcs.flatMap(s => s.addons);
  const act = activity;
  const week = act.filter(a => Date.now() - new Date(a.at) < 7 * 864e5);

  return `
  <div class="grid kpi">
    <div class="card"><div class="kpi-l">Layanan tampil</div>
      <div class="kpi-v">${pubSvcs.length}<small> / ${catalog.services.length}</small></div>
      <div class="kpi-n">di halaman booking</div></div>
    <div class="card"><div class="kpi-l">Paket aktif</div>
      <div class="kpi-v">${pubPkgs.length}</div>
      <div class="kpi-n">${allPkgs.length - pubPkgs.length ? `${allPkgs.length - pubPkgs.length} tidak tampil` : 'semua paket tampil'}</div></div>
    <div class="card"><div class="kpi-l">Add-on aktif</div>
      <div class="kpi-v">${pubAddons.length}</div>
      <div class="kpi-n">tambahan opsional</div></div>
    <div class="card dark"><div class="kpi-l">Perubahan 7 hari</div>
      <div class="kpi-v">${week.length}</div>
      <div class="kpi-n">${act[0] ? 'terakhir ' + ago(act[0].at) : 'belum ada aktivitas'}</div></div>
  </div>

  <div class="grid dash">
    <div class="card">
      <div class="card-h"><div><h2>Ringkasan menu</h2><div class="sub">Klik layanan untuk mengatur paketnya.</div></div>
        <a class="link" href="#menu">Kelola menu →</a></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Layanan</th><th class="r">Paket</th><th>Rentang harga</th><th>Status</th></tr></thead>
        <tbody>${catalog.services.map(s => {
          const live = !!pub.services[s.id];
          const n = s.groups.reduce((t, g) => t + g.packages.length, 0);
          return `<tr class="click" data-goto="${s.id}">
            <td><b>${esc(s.label)}</b><div class="muted" style="font-size:12.5px">${esc(s.title)}</div></td>
            <td class="r num">${n}</td>
            <td class="num" style="white-space:nowrap">${priceRange(s)}</td>
            <td>${live ? '<span class="badge live">Tampil</span>' : '<span class="badge off">Tidak tampil</span>'}</td></tr>`;
        }).join('')}</tbody></table></div>
    </div>

    <div class="card">
      <div class="card-h"><div><h2>Aktivitas terbaru</h2><div class="sub">Perubahan menu oleh admin.</div></div>
        <a class="link" href="#activity">Semua log →</a></div>
      ${act.length ? `<ul class="feed">${act.slice(0, 7).map(feedItem).join('')}</ul>`
        : '<div class="empty">Belum ada aktivitas. Perubahan pada menu akan tercatat di sini.</div>'}
    </div>
  </div>`;
}
function feedItem(a){
  return `<li><span class="act ${a.action}">${ACT[a.action] || a.action}</span>
    <span class="what">${esc(a.entity)} · ${esc(a.target)}${a.detail ? `<br><span>${esc(a.detail)}</span>` : ''}</span>
    <span class="meta">${esc(a.actor)} · ${ago(a.at)}</span></li>`;
}
function bindDashboard(){
  $$('[data-goto]').forEach(r => r.onclick = () => { ui.svc = r.dataset.goto; location.hash = '#menu'; });
}

/* =========================================================
   VIEW · MENU LAYANAN
   ========================================================= */
const termsOptions = () => Object.entries(catalog.terms).map(([k, t]) => [k, t.title]);
const SERVICE_FIELDS = () => [
  {key:'label', label:'Nama layanan', req:true, placeholder:'mis. Wedding', help:'Tampil sebagai label kecil di kartu layanan & ringkasan booking.'},
  {key:'title', label:'Judul kartu', req:true, placeholder:'mis. Wedding Photography'},
  {key:'desc', label:'Deskripsi singkat', type:'textarea', placeholder:'Satu kalimat tentang layanan ini.'},
  {key:'terms', label:'Syarat & ketentuan', type:'select', options:termsOptions()},
  {key:'couple', label:'Form identitas pasangan', type:'check', help:'Minta nama & Instagram kedua calon pengantin, bukan satu nama client.'},
  {key:'usesPeople', label:'Tanyakan jumlah orang', type:'check', help:'Tampilkan penghitung jumlah orang di langkah detail.'}
];
const SERVICE_DIFF = [['label','Nama'],['title','Judul'],['desc','Deskripsi'],['terms','S&K'],['couple','Pasangan','bool'],['usesPeople','Jumlah orang','bool']];

const GROUP_FIELDS = [
  {key:'label', label:'Nama grup paket', req:true, placeholder:'mis. Wedding Package', help:'Bila layanan punya lebih dari satu grup, nama ini menjadi tab di halaman paket.'},
  {key:'people', label:'Paket ditentukan jumlah orang', type:'check', help:'Tampilkan penghitung orang dan rekomendasi paket otomatis berdasarkan rentang min–maks tiap paket.'}
];

const PACKAGE_FIELDS = g => [
  {key:'name', label:'Nama paket', req:true, placeholder:'mis. Wedding Gold'},
  {row:[
    {key:'price', label:'Harga', type:'number', req:true, prefix:'Rp', min:0, step:1000, err:'Isi harga yang valid.'},
    {key:'perPerson', label:'Harga per orang', type:'check', help:'Total = harga × jumlah orang.'}
  ]},
  ...(g.people ? [{row:[
    {key:'min', label:'Min. orang', type:'number', min:1, help:'Untuk rekomendasi otomatis.', err:'Minimal 1.'},
    {key:'max', label:'Maks. orang', type:'number', min:1, err:'Harus ≥ min. orang.',
      check:(v, root) => { const mn = root.querySelector('[data-key="min"]').value; return v != null && mn !== '' && v < Number(mn) ? 'Harus ≥ min. orang.' : ''; }}
  ]}] : []),
  {key:'items', label:'Isi paket', type:'textarea', lines:true, req:true, placeholder:'Satu poin per baris\nFoto Unlimited\n8 Jam Kerja', help:'Satu poin per baris — tampil sebagai daftar di kartu paket.', err:'Isi minimal satu poin.'},
  {key:'recommended', label:'Label RECOMMENDED', type:'check', help:g.people ? 'Di grup berbasis jumlah orang, label ini diganti rekomendasi otomatis.' : 'Sorot paket ini dengan label oranye.'},
  {key:'bestSeller', label:'Label BEST SELLER', type:'check'}
];
const PACKAGE_DIFF = [['name','Nama'],['price','Harga','rp'],['perPerson','Per orang','bool'],['min','Min. orang'],['max','Maks. orang'],['items','Isi paket','list'],['recommended','Recommended','bool'],['bestSeller','Best seller','bool']];

const ADDON_FIELDS = s => [
  {key:'name', label:'Nama add-on', req:true, placeholder:'mis. Cinematic Video'},
  {key:'price', label:'Harga', type:'number', req:true, prefix:'Rp', min:0, step:1000, err:'Isi harga yang valid.'},
  {row:[
    {key:'unit', label:'Satuan', placeholder:'mis. 30 menit', help:'Tampil sebagai "per 30 menit".'},
    {key:'group', label:'Berlaku untuk', type:'select', options:[['', 'Semua grup paket'], ...s.groups.map(g => [g.id, g.label])]}
  ]},
  {key:'qty', label:'Bisa dipesan lebih dari satu', type:'check', help:'Client memilih jumlah (mis. 2 × 30 menit).'}
];
const ADDON_DIFF = [['name','Nama'],['price','Harga','rp'],['unit','Satuan'],['group','Grup'],['qty','Jumlah','bool']];

function viewMenu(){
  if(!catalog.services.length) return `
    <div class="empty">Belum ada layanan.<br><br><button class="btn primary" data-act="svc-add">${I.plus}Tambah layanan</button></div>`;
  if(!findSvc(ui.svc)) ui.svc = catalog.services[0].id;
  const s = findSvc(ui.svc);
  const pub = publicCatalog(catalog);
  const live = !!pub.services[s.id];
  const terms = catalog.terms[s.terms];

  const list = catalog.services.map((x, i) => {
    const n = x.groups.reduce((t, g) => t + g.packages.length, 0);
    return `<div class="svc-item ${x.id === s.id ? 'on' : ''} ${pub.services[x.id] ? '' : 'hidden'}">
      <button type="button" class="pick" data-pick="${x.id}">
        <span class="nm">${esc(x.label)}</span>
        <span class="ct">${n} paket${x.hidden ? ' · disembunyikan' : pub.services[x.id] ? '' : ' · tidak tampil'}</span>
      </button>
      <span class="ord">
        <button type="button" class="icon-btn" data-svc-move="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Naikkan ${esc(x.label)}">${I.up}</button>
        <button type="button" class="icon-btn" data-svc-move="${i}" data-d="1" ${i === catalog.services.length - 1 ? 'disabled' : ''} aria-label="Turunkan ${esc(x.label)}">${I.down}</button>
      </span></div>`;
  }).join('');

  const groups = s.groups.map((g, gi) => `
    <section class="group">
      <div class="group-h">
        <h4>${esc(g.label)} ${g.people ? '<span class="chip">Jumlah orang</span>' : ''}</h4>
        <span class="tools">
          <button type="button" class="icon-btn" data-grp-move="${gi}" data-d="-1" ${gi === 0 ? 'disabled' : ''} aria-label="Naikkan grup">${I.up}</button>
          <button type="button" class="icon-btn" data-grp-move="${gi}" data-d="1" ${gi === s.groups.length - 1 ? 'disabled' : ''} aria-label="Turunkan grup">${I.down}</button>
          <button type="button" class="icon-btn" data-grp-edit="${gi}" aria-label="Ubah grup">${I.edit}</button>
          <button type="button" class="icon-btn del" data-grp-del="${gi}" aria-label="Hapus grup">${I.trash}</button>
        </span>
      </div>
      <ul class="rows">
        ${g.packages.length ? g.packages.map((p, pi) => `
        <li class="item ${p.hidden ? 'is-hidden' : ''}">
          <div class="info">
            <div class="t">${esc(p.name)}
              ${p.bestSeller ? '<span class="badge best">Best seller</span>' : ''}
              ${p.recommended ? '<span class="badge rec">Recommended</span>' : ''}
              ${p.hidden ? '<span class="badge off">Disembunyikan</span>' : ''}</div>
            <div class="s">${p.items.length} poin · ${esc(p.items.slice(0, 3).join(', '))}${p.items.length > 3 ? '…' : ''}${g.people && p.min != null ? ` · ${p.min}–${p.max} orang` : ''}</div>
          </div>
          <div class="price">${rp(p.price)}${p.perPerson ? '<small>per orang</small>' : ''}</div>
          <span class="tools">
            <button type="button" class="icon-btn eye ${p.hidden ? 'off' : 'on'}" data-pkg-eye="${gi}:${pi}" aria-label="${p.hidden ? 'Tampilkan' : 'Sembunyikan'} paket" title="${p.hidden ? 'Tampilkan' : 'Sembunyikan'}">${p.hidden ? I.eyeOff : I.eye}</button>
            <button type="button" class="icon-btn" data-pkg-move="${gi}:${pi}" data-d="-1" ${pi === 0 ? 'disabled' : ''} aria-label="Naikkan paket">${I.up}</button>
            <button type="button" class="icon-btn" data-pkg-move="${gi}:${pi}" data-d="1" ${pi === g.packages.length - 1 ? 'disabled' : ''} aria-label="Turunkan paket">${I.down}</button>
            <button type="button" class="icon-btn" data-pkg-edit="${gi}:${pi}" aria-label="Ubah paket">${I.edit}</button>
            <button type="button" class="icon-btn del" data-pkg-del="${gi}:${pi}" aria-label="Hapus paket">${I.trash}</button>
          </span>
        </li>`).join('') : '<li><div class="empty">Belum ada paket di grup ini.</div></li>'}
      </ul>
      <button type="button" class="add-row" data-pkg-add="${gi}">${I.plus}Tambah paket</button>
    </section>`).join('');

  const addons = `
    <section class="group">
      <ul class="rows">
        ${s.addons.length ? s.addons.map((a, ai) => `
        <li class="item ${a.hidden ? 'is-hidden' : ''}">
          <div class="info">
            <div class="t">${esc(a.name)} ${a.hidden ? '<span class="badge off">Disembunyikan</span>' : ''}</div>
            <div class="s">${a.unit ? 'per ' + esc(a.unit) : 'sekali bayar'}${a.qty ? ' · bisa lebih dari satu' : ''} · ${a.group ? 'hanya ' + esc(s.groups.find(g => g.id === a.group)?.label || a.group) : 'semua grup'}</div>
          </div>
          <div class="price">+${rp(a.price)}</div>
          <span class="tools">
            <button type="button" class="icon-btn eye ${a.hidden ? 'off' : 'on'}" data-add-eye="${ai}" aria-label="${a.hidden ? 'Tampilkan' : 'Sembunyikan'} add-on" title="${a.hidden ? 'Tampilkan' : 'Sembunyikan'}">${a.hidden ? I.eyeOff : I.eye}</button>
            <button type="button" class="icon-btn" data-add-move="${ai}" data-d="-1" ${ai === 0 ? 'disabled' : ''} aria-label="Naikkan add-on">${I.up}</button>
            <button type="button" class="icon-btn" data-add-move="${ai}" data-d="1" ${ai === s.addons.length - 1 ? 'disabled' : ''} aria-label="Turunkan add-on">${I.down}</button>
            <button type="button" class="icon-btn" data-add-edit="${ai}" aria-label="Ubah add-on">${I.edit}</button>
            <button type="button" class="icon-btn del" data-add-del="${ai}" aria-label="Hapus add-on">${I.trash}</button>
          </span>
        </li>`).join('') : '<li><div class="empty">Belum ada add-on untuk layanan ini.</div></li>'}
      </ul>
      <button type="button" class="add-row" data-add-add>${I.plus}Tambah add-on</button>
    </section>`;

  return `
  <div class="menu-layout">
    <div class="svc-list" role="list">${list}
      <button type="button" class="svc-add" data-act="svc-add">${I.plus}Tambah layanan</button>
    </div>
    <div>
      <div class="card">
        <div class="svc-head">
          <div>
            <div class="eyebrow">${esc(s.label)}</div>
            <h2>${esc(s.title)}</h2>
            ${s.desc ? `<p>${esc(s.desc)}</p>` : ''}
          </div>
          <div class="acts">
            <button type="button" class="btn ghost sm" data-act="svc-eye">${s.hidden ? I.eye + 'Tampilkan' : I.eyeOff + 'Sembunyikan'}</button>
            <button type="button" class="btn primary sm" data-act="svc-edit">${I.edit}Ubah</button>
            <button type="button" class="icon-btn del" data-act="svc-del" aria-label="Hapus layanan">${I.trash}</button>
          </div>
        </div>
        <div class="chips">
          <span class="chip">${s.couple ? 'Form pasangan' : 'Form client'}</span>
          ${s.usesPeople ? '<span class="chip">Tanya jumlah orang</span>' : ''}
          <span class="chip">S&amp;K: ${esc(terms ? terms.title : '—')}</span>
          ${s.hidden ? '<span class="badge off">Disembunyikan</span>' : live ? '<span class="badge live">Tampil di booking</span>' : ''}
        </div>
        ${!s.hidden && !live ? '<div class="notice">Layanan ini tidak tampil di halaman booking karena belum punya paket yang aktif.</div>' : ''}
      </div>

      <div class="section-h"><div><h3>Paket</h3><div class="sub">Urutan di sini = urutan di halaman booking.</div></div>
        <button type="button" class="btn ghost sm" data-act="grp-add">${I.plus}Grup paket</button></div>
      ${groups || '<div class="empty">Belum ada grup paket. Tambahkan grup lalu isi paketnya.</div>'}

      <div class="section-h"><div><h3>Add-on</h3><div class="sub">Pilihan tambahan setelah client memilih paket.</div></div></div>
      ${addons}
    </div>
  </div>`;
}

const pair = v => v.split(':').map(Number);
function bindMenu(){
  const s = findSvc(ui.svc);
  const on = (sel, fn) => $$(sel).forEach(b => b.onclick = () => fn(b));

  on('[data-pick]', b => { ui.svc = b.dataset.pick; render(); });
  on('[data-act="svc-add"]', addService);
  if(!s) return;
  const svcName = s.label;

  on('[data-svc-move]', b => {
    const i = Number(b.dataset.svcMove);
    if(move(catalog.services, i, Number(b.dataset.d)))
      commit({action:'reorder', entity:'Layanan', target:catalog.services[i + Number(b.dataset.d)].label, detail:`Dipindah ke posisi ${i + Number(b.dataset.d) + 1}`}, 'Urutan disimpan');
  });
  on('[data-act="svc-edit"]', async () => {
    const v = await openForm({eyebrow:'Layanan', title:`Ubah ${s.label}`, fields:SERVICE_FIELDS(), values:s});
    if(!v) return;
    const before = {...s};
    Object.assign(s, v);
    commit({action:'update', entity:'Layanan', target:s.label, detail:diff(before, s, SERVICE_DIFF)});
  });
  on('[data-act="svc-eye"]', () => {
    s.hidden = !s.hidden;
    commit({action:s.hidden ? 'hide' : 'show', entity:'Layanan', target:svcName}, s.hidden ? 'Layanan disembunyikan' : 'Layanan ditampilkan');
  });
  on('[data-act="svc-del"]', async () => {
    const n = s.groups.reduce((t, g) => t + g.packages.length, 0);
    if(!await confirmBox(`Hapus layanan ${s.label}?`, `${n} paket dan ${s.addons.length} add-on di dalamnya ikut terhapus. Pertimbangkan "Sembunyikan" bila hanya ingin menonaktifkan sementara.`)) return;
    catalog.services = catalog.services.filter(x => x !== s);
    ui.svc = null;
    commit({action:'delete', entity:'Layanan', target:svcName, detail:`${n} paket, ${s.addons.length} add-on`}, 'Layanan dihapus');
  });

  /* grup */
  on('[data-act="grp-add"]', async () => {
    const v = await openForm({eyebrow:svcName, title:'Grup paket baru', submit:'Tambah grup', fields:GROUP_FIELDS});
    if(!v) return;
    s.groups.push({id:newId(v.label), ...v, packages:[]});
    commit({action:'create', entity:'Grup paket', target:`${svcName} › ${v.label}`}, 'Grup ditambahkan');
  });
  on('[data-grp-move]', b => {
    const i = Number(b.dataset.grpMove), d = Number(b.dataset.d);
    if(move(s.groups, i, d)) commit({action:'reorder', entity:'Grup paket', target:`${svcName} › ${s.groups[i + d].label}`, detail:`Dipindah ke posisi ${i + d + 1}`}, 'Urutan disimpan');
  });
  on('[data-grp-edit]', async b => {
    const g = s.groups[Number(b.dataset.grpEdit)];
    const v = await openForm({eyebrow:svcName, title:`Ubah ${g.label}`, fields:GROUP_FIELDS, values:g});
    if(!v) return;
    const before = {...g};
    Object.assign(g, v);
    commit({action:'update', entity:'Grup paket', target:`${svcName} › ${g.label}`, detail:diff(before, g, [['label','Nama'],['people','Jumlah orang','bool']])});
  });
  on('[data-grp-del]', async b => {
    const g = s.groups[Number(b.dataset.grpDel)];
    const scoped = s.addons.filter(a => a.group === g.id).length;
    if(!await confirmBox(`Hapus grup ${g.label}?`, `${g.packages.length} paket di dalamnya ikut terhapus.${scoped ? ` ${scoped} add-on khusus grup ini akan berlaku untuk semua grup.` : ''}`)) return;
    s.groups = s.groups.filter(x => x !== g);
    s.addons.forEach(a => { if(a.group === g.id) a.group = null; });
    commit({action:'delete', entity:'Grup paket', target:`${svcName} › ${g.label}`, detail:`${g.packages.length} paket`}, 'Grup dihapus');
  });

  /* paket */
  on('[data-pkg-add]', async b => {
    const g = s.groups[Number(b.dataset.pkgAdd)];
    const v = await openForm({eyebrow:`${svcName} › ${g.label}`, title:'Paket baru', submit:'Tambah paket', fields:PACKAGE_FIELDS(g), values:{items:[]}});
    if(!v) return;
    g.packages.push({id:newId(v.name), hidden:false, ...v});
    commit({action:'create', entity:'Paket', target:`${svcName} › ${v.name}`, detail:rp(v.price) + (v.perPerson ? ' / orang' : '')}, 'Paket ditambahkan');
  });
  on('[data-pkg-edit]', async b => {
    const [gi, pi] = pair(b.dataset.pkgEdit), g = s.groups[gi], p = g.packages[pi];
    const v = await openForm({eyebrow:`${svcName} › ${g.label}`, title:`Ubah ${p.name}`, fields:PACKAGE_FIELDS(g), values:p});
    if(!v) return;
    const before = {...p};
    Object.assign(p, v);
    commit({action:'update', entity:'Paket', target:`${svcName} › ${p.name}`, detail:diff(before, p, PACKAGE_DIFF)});
  });
  on('[data-pkg-eye]', b => {
    const [gi, pi] = pair(b.dataset.pkgEye), p = s.groups[gi].packages[pi];
    p.hidden = !p.hidden;
    commit({action:p.hidden ? 'hide' : 'show', entity:'Paket', target:`${svcName} › ${p.name}`}, p.hidden ? 'Paket disembunyikan' : 'Paket ditampilkan');
  });
  on('[data-pkg-move]', b => {
    const [gi, pi] = pair(b.dataset.pkgMove), d = Number(b.dataset.d), list = s.groups[gi].packages;
    if(move(list, pi, d)) commit({action:'reorder', entity:'Paket', target:`${svcName} › ${list[pi + d].name}`, detail:`Dipindah ke posisi ${pi + d + 1}`}, 'Urutan disimpan');
  });
  on('[data-pkg-del]', async b => {
    const [gi, pi] = pair(b.dataset.pkgDel), g = s.groups[gi], p = g.packages[pi];
    if(!await confirmBox(`Hapus paket ${p.name}?`, 'Paket akan hilang dari halaman booking. Gunakan ikon mata bila hanya ingin menyembunyikan sementara.')) return;
    g.packages.splice(pi, 1);
    commit({action:'delete', entity:'Paket', target:`${svcName} › ${p.name}`, detail:rp(p.price)}, 'Paket dihapus');
  });

  /* add-on */
  on('[data-add-add]', async () => {
    const v = await openForm({eyebrow:svcName, title:'Add-on baru', submit:'Tambah add-on', fields:ADDON_FIELDS(s)});
    if(!v) return;
    s.addons.push({id:newId(v.name), hidden:false, ...v, group:v.group || null, unit:v.unit || null});
    commit({action:'create', entity:'Add-on', target:`${svcName} › ${v.name}`, detail:rp(v.price)}, 'Add-on ditambahkan');
  });
  on('[data-add-edit]', async b => {
    const a = s.addons[Number(b.dataset.addEdit)];
    const v = await openForm({eyebrow:svcName, title:`Ubah ${a.name}`, fields:ADDON_FIELDS(s), values:a});
    if(!v) return;
    const before = {...a};
    Object.assign(a, v, {group:v.group || null, unit:v.unit || null});
    commit({action:'update', entity:'Add-on', target:`${svcName} › ${a.name}`, detail:diff(before, a, ADDON_DIFF)});
  });
  on('[data-add-eye]', b => {
    const a = s.addons[Number(b.dataset.addEye)];
    a.hidden = !a.hidden;
    commit({action:a.hidden ? 'hide' : 'show', entity:'Add-on', target:`${svcName} › ${a.name}`}, a.hidden ? 'Add-on disembunyikan' : 'Add-on ditampilkan');
  });
  on('[data-add-move]', b => {
    const i = Number(b.dataset.addMove), d = Number(b.dataset.d);
    if(move(s.addons, i, d)) commit({action:'reorder', entity:'Add-on', target:`${svcName} › ${s.addons[i + d].name}`, detail:`Dipindah ke posisi ${i + d + 1}`}, 'Urutan disimpan');
  });
  on('[data-add-del]', async b => {
    const i = Number(b.dataset.addDel), a = s.addons[i];
    if(!await confirmBox(`Hapus add-on ${a.name}?`, 'Add-on akan hilang dari halaman booking.')) return;
    s.addons.splice(i, 1);
    commit({action:'delete', entity:'Add-on', target:`${svcName} › ${a.name}`, detail:rp(a.price)}, 'Add-on dihapus');
  });
}
async function addService(){
  const v = await openForm({eyebrow:'Layanan', title:'Layanan baru', submit:'Tambah layanan', fields:SERVICE_FIELDS(),
    values:{terms:Object.keys(catalog.terms)[0]}});
  if(!v) return;
  const s = {id:newId(v.label), hidden:false, ...v, groups:[{id:newId(v.label + '-package'), label:`${v.label} Package`, packages:[]}], addons:[]};
  catalog.services.push(s);
  ui.svc = s.id;
  if(location.hash !== '#menu') location.hash = '#menu';
  commit({action:'create', entity:'Layanan', target:v.label}, 'Layanan ditambahkan — lanjut isi paketnya');
}

/* =========================================================
   VIEW · SYARAT & KETENTUAN
   ========================================================= */
const TERMS_FIELDS = [
  {key:'title', label:'Judul', req:true, placeholder:'mis. Ketentuan Wedding & Couple Session', help:'Judul pop-up S&K di halaman booking.'},
  {key:'label', label:'Keterangan singkat', placeholder:'mis. (Wedding · Prewedding)', help:'Tampil di samping tautan "Syarat & ketentuan booking".'},
  {key:'list', label:'Poin ketentuan', type:'textarea', lines:true, req:true, placeholder:'Satu poin per baris', help:'Satu poin per baris.', err:'Isi minimal satu poin.'}
];
function viewTerms(){
  const used = k => catalog.services.filter(s => s.terms === k);
  return `<div class="terms-grid">${Object.entries(catalog.terms).map(([k, t]) => `
    <div class="card terms-card">
      <div class="card-h" style="margin-bottom:6px">
        <div style="min-width:0"><h3>${esc(t.title)}</h3><div class="sub">${esc(t.label || '')}</div></div>
        <span class="tools">
          <button type="button" class="icon-btn" data-terms-edit="${k}" aria-label="Ubah S&K">${I.edit}</button>
          <button type="button" class="icon-btn del" data-terms-del="${k}" aria-label="Hapus S&K">${I.trash}</button>
        </span>
      </div>
      <div class="chips" style="margin-top:4px">${used(k).length ? used(k).map(s => `<span class="chip">${esc(s.label)}</span>`).join('') : '<span class="badge off">Belum dipakai</span>'}</div>
      <ol>${t.list.slice(0, 5).map(i => `<li>${esc(i)}</li>`).join('')}</ol>
      ${t.list.length > 5 ? `<div class="more">+${t.list.length - 5} poin lainnya</div>` : ''}
    </div>`).join('')}</div>`;
}
function bindTerms(){
  $$('[data-terms-edit]').forEach(b => b.onclick = async () => {
    const t = catalog.terms[b.dataset.termsEdit];
    const v = await openForm({eyebrow:'Syarat & ketentuan', title:`Ubah ${t.title}`, fields:TERMS_FIELDS, values:t});
    if(!v) return;
    const before = {...t};
    Object.assign(t, v);
    commit({action:'update', entity:'S&K', target:t.title, detail:diff(before, t, [['title','Judul'],['label','Keterangan'],['list','Poin','list']])});
  });
  $$('[data-terms-del]').forEach(b => b.onclick = async () => {
    const k = b.dataset.termsDel, t = catalog.terms[k];
    const users = catalog.services.filter(s => s.terms === k);
    if(users.length){ toast(`Masih dipakai oleh ${users.map(s => s.label).join(', ')} — ganti S&K layanan itu dulu`); return; }
    if(!await confirmBox(`Hapus ${t.title}?`, 'Set syarat & ketentuan ini akan dihapus permanen.')) return;
    delete catalog.terms[k];
    commit({action:'delete', entity:'S&K', target:t.title}, 'S&K dihapus');
  });
}
async function addTerms(){
  const v = await openForm({eyebrow:'Syarat & ketentuan', title:'Set S&K baru', submit:'Tambah', fields:TERMS_FIELDS, values:{list:[]}});
  if(!v) return;
  catalog.terms[newId(v.title)] = v;
  commit({action:'create', entity:'S&K', target:v.title, detail:`${v.list.length} poin`}, 'S&K ditambahkan');
}

/* =========================================================
   VIEW · PENGATURAN
   ========================================================= */
const WA_RE = /^62\d{8,13}$/;
const SETTINGS_FIELDS = [
  {legend:'Pembayaran', fields:[
    {row:[
      {key:'dpPercent', label:'DP (%)', type:'number', req:true, min:1, max:100, help:'Persentase dari estimasi total.', err:'Isi 1–100.'},
      {key:'holdMinutes', label:'Tahan jadwal (menit)', type:'number', req:true, min:5, max:1440, help:'Hitung mundur setelah booking.', err:'Isi 5–1440 menit.'}
    ]}
  ]},
  {legend:'Rekening transfer DP', fields:[
    {key:'bankName', label:'Bank', req:true, placeholder:'mis. Bank BRI'},
    {row:[
      {key:'accountNo', label:'Nomor rekening', req:true, pattern:/^[0-9 -]{6,24}$/, err:'Isi nomor rekening (angka).'},
      {key:'accountName', label:'Atas nama', req:true}
    ]}
  ]},
  {legend:'WhatsApp', fields:[
    {key:'waPayment', label:'Konfirmasi pembayaran DP', type:'tel', req:true, pattern:WA_RE, help:'Format internasional tanpa +, mis. 6283245786532.', err:'Gunakan format 62xxxxxxxxxx.'},
    {key:'waGeneral', label:'WhatsApp umum', type:'tel', req:true, pattern:WA_RE, err:'Gunakan format 62xxxxxxxxxx.'}
  ]}
];
const settingsValues = st => ({
  dpPercent:st.dpPercent, holdMinutes:st.holdMinutes,
  bankName:st.bank.name, accountNo:st.bank.accountNo, accountName:st.bank.accountName,
  waPayment:st.whatsapp.paymentConfirm, waGeneral:st.whatsapp.general
});
const SETTINGS_DIFF = [['dpPercent','DP %'],['holdMinutes','Tahan jadwal'],['bankName','Bank'],['accountNo','No. rekening'],['accountName','Atas nama'],['waPayment','WA pembayaran'],['waGeneral','WA umum']];

function viewSettings(){
  return `
  <div class="settings-grid">
    <form class="card" id="settingsForm" novalidate>
      <div class="card-h"><div><h2>Pembayaran &amp; kontak</h2><div class="sub">Tampil di langkah konfirmasi & pembayaran.</div></div></div>
      <div class="form-grid">${formHtml(SETTINGS_FIELDS, settingsValues(catalog.settings))}</div>
      <div class="save-bar"><button type="submit" class="btn primary">Simpan pengaturan</button></div>
    </form>
    <div class="card">
      <div class="card-h"><div><h2>Data menu</h2><div class="sub">Cadangan & pemindahan data.</div></div></div>
      <div class="data-row"><span><b>Ekspor menu</b><small>Unduh seluruh menu sebagai file JSON — berguna sebagai cadangan dan untuk impor ke Supabase nanti.</small></span>
        <button type="button" class="btn ghost sm" data-act="export">${I.download}Ekspor JSON</button></div>
      <div class="data-row"><span><b>Impor menu</b><small>Ganti seluruh menu dengan file JSON hasil ekspor.</small></span>
        <button type="button" class="btn ghost sm" data-act="import">Impor JSON</button></div>
      <div class="data-row"><span><b>Kembalikan ke bawaan</b><small>Pulihkan pricelist Kalaatma 2026 asli. Semua perubahan menu hilang; log aktivitas tetap ada.</small></span>
        <button type="button" class="btn danger sm" data-act="reset">Reset menu</button></div>
    </div>
  </div>`;
}
function bindSettings(){
  const form = $('#settingsForm');
  $$('input', form).forEach(el => el.addEventListener('input', () => el.closest('.fld')?.classList.remove('bad')));
  form.onsubmit = e => {
    e.preventDefault();
    const v = collect(form, SETTINGS_FIELDS); if(!v) return;
    const before = settingsValues(catalog.settings);
    const detail = diff(before, v, SETTINGS_DIFF);
    if(!detail){ toast('Tidak ada perubahan'); return; }
    catalog.settings = {
      ...catalog.settings,
      dpPercent:v.dpPercent, holdMinutes:v.holdMinutes,
      bank:{name:v.bankName, accountNo:v.accountNo, accountName:v.accountName},
      whatsapp:{paymentConfirm:v.waPayment, general:v.waGeneral}
    };
    commit({action:'update', entity:'Pengaturan', target:'Pembayaran & kontak', detail}, 'Pengaturan disimpan');
  };
  $('[data-act="export"]').onclick = () => {
    const blob = new Blob([JSON.stringify(catalog, null, 2)], {type:'application/json'});
    const a = Object.assign(document.createElement('a'), {href:URL.createObjectURL(blob), download:`kalaatma-menu-${new Date().toISOString().slice(0, 10)}.json`});
    a.click(); URL.revokeObjectURL(a.href);
    addLog({action:'system', entity:'Data', target:'Ekspor menu'});
    toast('Menu diekspor');
  };
  $('[data-act="import"]').onclick = () => $('#importFile').click();
  $('[data-act="reset"]').onclick = async () => {
    if(!await confirmBox('Kembalikan menu ke bawaan?', 'Seluruh perubahan layanan, paket, add-on, S&K, dan pengaturan akan diganti dengan pricelist bawaan.', 'Reset menu')) return;
    catalog = defaultCatalog();
    ui.svc = null;
    commit({action:'system', entity:'Data', target:'Reset menu ke bawaan'}, 'Menu dikembalikan ke bawaan');
  };
}
$('#importFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = '';
  if(!file) return;
  let data;
  try{ data = JSON.parse(await file.text()); }catch(_){ toast('File bukan JSON yang valid'); return; }
  if(!isCatalog(data)){ toast('Format file tidak dikenali — gunakan file hasil Ekspor JSON'); return; }
  if(!await confirmBox('Impor menu ini?', `${data.services.length} layanan dari "${file.name}" akan menggantikan menu saat ini.`, 'Impor')) return;
  catalog = data; ui.svc = null;
  commit({action:'system', entity:'Data', target:'Impor menu', detail:file.name}, 'Menu diimpor');
};

/* =========================================================
   VIEW · LOG AKTIVITAS
   ========================================================= */
function filteredLog(){
  const q = ui.logQ.toLowerCase();
  return activity.filter(a =>
    (!ui.logAction || a.action === ui.logAction) &&
    (!ui.logEntity || a.entity === ui.logEntity) &&
    (!q || `${a.entity} ${a.target} ${a.detail || ''} ${a.actor}`.toLowerCase().includes(q)));
}
function viewActivity(){
  const all = activity;
  const entities = [...new Set(all.map(a => a.entity))].sort();
  const list = filteredLog();
  let lastDay = '';
  const rows = list.map(a => {
    const d = dayLabel(a.at);
    const head = d !== lastDay ? `<tr class="day-row"><td colspan="5">${d}</td></tr>` : '';
    lastDay = d;
    return head + `<tr>
      <td class="num" style="white-space:nowrap">${hm(a.at)}</td>
      <td><span class="act ${a.action}">${ACT[a.action] || esc(a.action)}</span></td>
      <td><b>${esc(a.target)}</b><div class="muted" style="font-size:12px">${esc(a.entity)}</div></td>
      <td style="color:var(--ink-2)">${esc(a.detail || '—')}</td>
      <td class="hide-sm">${esc(a.actor)}</td></tr>`;
  }).join('');
  return `
  <div class="filters">
    <input type="search" id="logQ" placeholder="Cari paket, layanan, detail…" value="${esc(ui.logQ)}" aria-label="Cari log">
    <select id="logAction" aria-label="Filter aksi"><option value="">Semua aksi</option>
      ${Object.entries(ACT).map(([k, v]) => `<option value="${k}" ${ui.logAction === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <select id="logEntity" aria-label="Filter objek"><option value="">Semua objek</option>
      ${entities.map(e => `<option ${ui.logEntity === e ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select>
  </div>
  <div class="card">
    <div class="card-h"><div><h2>${list.length} aktivitas</h2><div class="sub">${all.length !== list.length ? `dari ${all.length} total · ` : ''}${mode === 'local' ? 'Maksimal 500 catatan terakhir disimpan.' : 'Menampilkan 500 catatan terakhir.'}</div></div></div>
    ${list.length ? `<div class="table-wrap"><table class="log-table">
      <thead><tr><th>Waktu</th><th>Aksi</th><th>Objek</th><th>Detail</th><th class="hide-sm">Admin</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`
      : `<div class="empty">${all.length ? 'Tidak ada aktivitas yang cocok dengan filter.' : 'Belum ada aktivitas. Setiap perubahan menu akan tercatat di sini.'}</div>`}
  </div>`;
}
function bindActivity(){
  const q = $('#logQ');
  q.oninput = () => { ui.logQ = q.value; rerenderKeepFocus('#logQ'); };
  $('#logAction').onchange = e => { ui.logAction = e.target.value; render(); };
  $('#logEntity').onchange = e => { ui.logEntity = e.target.value; render(); };
}
function rerenderKeepFocus(sel){
  const el = $(sel), pos = el.selectionStart;
  render();
  const n = $(sel); n.focus(); n.setSelectionRange(pos, pos);
}
function exportCsv(){
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Waktu','Admin','Aksi','Objek','Target','Detail'].join(',')]
    .concat(filteredLog().map(a => [new Date(a.at).toLocaleString('id-ID'), a.actor, ACT[a.action] || a.action, a.entity, a.target, a.detail].map(cell).join(',')));
  const blob = new Blob(['\ufeff' + lines.join('\n')], {type:'text/csv'});
  const a = Object.assign(document.createElement('a'), {href:URL.createObjectURL(blob), download:`kalaatma-log-${new Date().toISOString().slice(0, 10)}.csv`});
  a.click(); URL.revokeObjectURL(a.href);
}

/* =========================================================
   ROUTER
   ========================================================= */
const ROUTES = {
  dashboard:{eyebrow:'Ringkasan', title:'Dashboard', view:viewDashboard, bind:bindDashboard,
    actions:() => `<a class="btn ghost" href="${LANDING_URL}" target="_blank" rel="noopener">${I.ext}<span class="t">Lihat landing</span></a>
                   <button type="button" class="btn primary" data-top="svc-add">${I.plus}<span class="t">Layanan</span></button>`},
  menu:{eyebrow:'Landing page', title:'Menu Layanan', view:viewMenu, bind:bindMenu,
    actions:() => `<a class="btn ghost" href="${LANDING_URL}" target="_blank" rel="noopener">${I.ext}<span class="t">Pratinjau</span></a>`},
  terms:{eyebrow:'Landing page', title:'Syarat & Ketentuan', view:viewTerms, bind:bindTerms,
    actions:() => `<button type="button" class="btn primary" data-top="terms-add">${I.plus}<span class="t">Set S&amp;K</span></button>`},
  settings:{eyebrow:'Booking', title:'Pengaturan', view:viewSettings, bind:bindSettings, actions:() => ''},
  activity:{eyebrow:'Admin', title:'Log Aktivitas', view:viewActivity, bind:bindActivity,
    actions:() => `<button type="button" class="btn ghost" data-top="csv">${I.download}<span class="t">Ekspor CSV</span></button>
                   ${canClearActivity ? `<button type="button" class="btn ghost" data-top="clear">${I.trash}<span class="t">Bersihkan</span></button>` : ''}`}
};
const TOP = {
  'svc-add': addService,
  'terms-add': addTerms,
  csv: exportCsv,
  clear: async () => {
    if(!await confirmBox('Bersihkan log aktivitas?', 'Seluruh catatan aktivitas akan dihapus. Menu tidak berubah.', 'Bersihkan')) return;
    clearActivity();
    activity = [];
    await addLog({action:'system', entity:'Data', target:'Log aktivitas dibersihkan'});
    toast('Log dibersihkan'); render();
  }
};

function render(){
  const r = ROUTES[ui.route];
  $('#pageEyebrow').textContent = r.eyebrow;
  $('#pageTitle').textContent = r.title;
  document.title = `${r.title} · Kalaatma Admin`;
  $('#topActions').innerHTML = r.actions();
  $$('[data-top]').forEach(b => b.onclick = TOP[b.dataset.top]);
  $$('#sideNav a').forEach(a => a.classList.toggle('on', a.dataset.route === ui.route));
  $('#view').innerHTML = r.view();
  r.bind();
}
function route(){
  const next = location.hash.slice(1);
  const changed = next !== ui.route;
  ui.route = ROUTES[next] ? next : 'dashboard';
  $('.app').classList.remove('nav-open');
  render();
  if(changed){ window.scrollTo(0, 0); $('#view').style.animation = 'none'; void $('#view').offsetWidth; $('#view').style.animation = ''; }
  // di mode Supabase, log bisa bertambah dari admin lain
  if(mode === 'supabase' && (ui.route === 'dashboard' || ui.route === 'activity'))
    loadActivity().then(list => { activity = list; if(!$('#drawer').hidden || !$('#confirm').hidden) return; render(); }).catch(() => {});
}
$('#menuBtn').onclick = () => $('.app').classList.toggle('nav-open');
$('#scrim').onclick = () => $('.app').classList.remove('nav-open');

/* =========================================================
   BOOT · login (mode Supabase) lalu muat data
   ========================================================= */
function showLogin(message){
  $('#boot').hidden = true;
  $('#login').hidden = false;
  const err = $('#loginErr');
  err.textContent = message && message !== 'login' ? message : '';
  err.hidden = !err.textContent;
  setTimeout(() => $('#loginEmail').focus(), 30);
}
$('#loginForm').onsubmit = async e => {
  e.preventDefault();
  const email = $('#loginEmail').value.trim(), pw = $('#loginPw').value;
  if(!email || !pw){ showLogin('Isi email dan kata sandi.'); return; }
  const btn = $('#loginBtn');
  btn.disabled = true; btn.textContent = 'Masuk…';
  const msg = await signIn(email, pw);
  btn.disabled = false; btn.textContent = 'Masuk';
  if(msg){ showLogin(msg); return; }
  $('#loginPw').value = '';
  start();
};
$('#logoutBtn').onclick = async () => {
  await signOut();
  location.hash = '';
  location.reload();
};

async function start(){
  $('#login').hidden = true;
  $('#boot').hidden = false;
  try{
    [catalog, activity] = await Promise.all([loadCatalog(), loadActivity()]);
  }catch(err){
    $('#bootMsg').textContent = 'Gagal memuat data: ' + err.message;
    return;
  }
  $('#boot').hidden = true;
  $('#whoName').textContent = admin.name;
  $('#whoAvatar').textContent = (admin.name.trim()[0] || 'A').toUpperCase();
  $('#whoMode').textContent = mode === 'supabase' ? 'Terhubung Supabase' : 'Mode lokal';
  $('#logoutBtn').hidden = mode !== 'supabase';
  $('#localNote').hidden = mode !== 'local';
  $('.app').hidden = false;
  window.addEventListener('hashchange', route);
  route();
}

$('#sideLanding').href = LANDING_URL;
/* tab lain (mode lokal) mengubah data → segarkan */
onExternalChange(async () => { catalog = await loadCatalog(); activity = await loadActivity(); render(); });

(async () => {
  const msg = await checkSession().catch(err => 'Tidak bisa terhubung ke Supabase: ' + err.message);
  if(msg) showLogin(msg); else start();
})();
