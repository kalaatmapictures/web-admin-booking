/* =====================================================================
   MENU LANDING PAGE — mengatur apa yang tampil di halaman booking:
   layanan, grup paket, paket, add-on, syarat & ketentuan, dan
   pengaturan pembayaran. Disimpan ke Supabase (app_config) dan
   langsung dibaca landing page.
   ===================================================================== */
import { $, $$, S, RENDER, rp, esc, toast, money, moneyVal, openDrawer, closeDrawer,
         confirmBox, commitCatalog, logAct, buildPackages } from '../core.js';
import { defaultCatalog, isCatalog, publicCatalog } from '../shared/catalog.js';
import { renderContent, contentDirty } from './content.js';

const MN = { tab:'svc', svc:null };
const slug = t => String(t).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'item';
const newId = t => `${slug(t)}-${Math.random().toString(36).slice(2, 6)}`;
const move = (arr, i, d) => { const j = i + d; if(j < 0 || j >= arr.length) return false; [arr[i], arr[j]] = [arr[j], arr[i]]; return true; };
const findSvc = id => S.catalog.services.find(s => s.id === id);
const commit = async (log, msg) => { await commitCatalog(log, msg); RENDER.menu(); };

const I = {
  edit:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
  up:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>',
  down:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  eye:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17.3 17.3 0 0 0 2 12s3.6 7 10 7a9.9 9.9 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>'
};

/* ---------- ringkasan perubahan untuk log ---------- */
const BOOL = v => v ? 'Ya' : 'Tidak';
function diff(before, after, spec){
  const out = [];
  for(const [key, label, fmt] of spec){
    const norm = v => fmt === 'bool' ? !!v : (v === '' || v === undefined ? null : v);
    const a = before[key], b = after[key];
    if(JSON.stringify(norm(a)) === JSON.stringify(norm(b))) continue;
    if(fmt === 'list'){ out.push(`${label} diubah (${(a||[]).length} → ${(b||[]).length} poin)`); continue; }
    const f = fmt === 'rp' ? rp : fmt === 'bool' ? BOOL : (v => v === '' || v == null ? '—' : v);
    out.push(`${label}: ${f(a)} → ${f(b)}`);
  }
  return out.join(' · ');
}

/* =====================================================================
   FORM BUILDER (drawer & kartu pengaturan)
   tipe: text · number · money · textarea (lines) · check · select · row
   ===================================================================== */
function fieldHtml(f, v){
  const id = 'mf-' + f.key;
  const req = f.req ? ' <span style="color:var(--primary)">*</span>' : '';
  const help = f.help ? `<div class="hint">${f.help}</div>` : '';
  const err = `<div class="ferr">${esc(f.err || 'Wajib diisi.')}</div>`;
  if(f.type === 'check') return `
    <label class="mn-check"><input type="checkbox" data-key="${f.key}" ${v ? 'checked' : ''}>
      <span><b>${esc(f.label)}</b>${f.help ? `<small>${f.help}</small>` : ''}</span></label>`;
  if(f.type === 'select') return `
    <div class="fld" data-fld="${f.key}"><label for="${id}">${esc(f.label)}${req}</label>
      <select id="${id}" data-key="${f.key}">${f.options.map(([val, lab]) =>
        `<option value="${esc(val)}" ${String(v ?? '') === String(val) ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>${help}${err}</div>`;
  if(f.type === 'textarea') return `
    <div class="fld" data-fld="${f.key}"><label for="${id}">${esc(f.label)}${req}</label>
      <textarea id="${id}" data-key="${f.key}" rows="${f.rows || 6}" placeholder="${esc(f.placeholder || '')}">${esc(Array.isArray(v) ? v.join('\n') : v)}</textarea>${help}${err}</div>`;
  const type = f.type === 'number' ? 'number' : f.type === 'tel' ? 'tel' : 'text';
  return `
    <div class="fld ${f.type === 'money' ? 'money' : ''}" data-fld="${f.key}"><label for="${id}">${esc(f.label)}${req}</label>
      <input id="${id}" data-key="${f.key}" type="${type}" ${f.type === 'money' ? 'inputmode="numeric" placeholder="Rp0"' : `placeholder="${esc(f.placeholder || '')}"`}
        ${type === 'number' ? `inputmode="numeric" min="${f.min ?? 0}" ${f.max != null ? `max="${f.max}"` : ''}` : ''}
        value="${f.type === 'money' ? '' : esc(v ?? '')}">${help}${err}</div>`;
}
function formHtml(fields, values){
  return fields.map(f => f.row
    ? `<div class="fgrid two">${f.row.map(x => fieldHtml(x, values[x.key])).join('')}</div>`
    : f.legend ? `<div class="mn-legend">${esc(f.legend)}</div>${formHtml(f.fields, values)}`
    : fieldHtml(f, values[f.key])).join('');
}
const flat = fields => fields.flatMap(f => f.row || (f.fields ? flat(f.fields) : [f]));
function mountForm(root, fields, values){
  flat(fields).filter(f => f.type === 'money').forEach(f => money(root.querySelector(`[data-key="${f.key}"]`), values[f.key] || 0));
  root.querySelectorAll('input,textarea,select').forEach(el =>
    el.addEventListener('input', () => el.closest('.fld')?.classList.remove('bad')));
}
/* baca & validasi; null bila ada yang salah */
function collect(root, fields){
  const out = {}; let firstBad = null;
  for(const f of flat(fields)){
    const el = root.querySelector(`[data-key="${f.key}"]`); if(!el) continue;
    let v;
    if(f.type === 'check') v = el.checked;
    else if(f.type === 'money') v = moneyVal(el);
    else if(f.type === 'number') v = el.value === '' ? null : Number(el.value);
    else if(f.type === 'textarea' && f.lines) v = el.value.split('\n').map(s => s.trim()).filter(Boolean);
    else v = el.value.trim();
    let ok = true;
    if(f.req && (v === '' || v == null || (Array.isArray(v) && !v.length) || (f.type === 'money' && v <= 0))) ok = false;
    if(ok && f.type === 'number' && v != null && (Number.isNaN(v) || v < (f.min ?? 0) || (f.max != null && v > f.max))) ok = false;
    if(ok && f.pattern && v && !f.pattern.test(v)) ok = false;
    if(ok && f.check){ const msg = f.check(v, root); if(msg){ ok = false; root.querySelector(`[data-fld="${f.key}"] .ferr`).textContent = msg; } }
    root.querySelector(`[data-fld="${f.key}"]`)?.classList.toggle('bad', !ok);
    if(!ok && !firstBad) firstBad = el;
    out[f.key] = v;
  }
  if(firstBad){ firstBad.focus(); return null; }
  return out;
}
function openForm({eyebrow, title, submit = 'Simpan', fields, values = {}}){
  return new Promise(res => {
    openDrawer(`
      <div class="dh">
        <div><div class="mn-eyebrow">${esc(eyebrow || '')}</div><h2>${esc(title)}</h2></div>
        <button class="x" data-dclose>✕</button>
      </div>
      <form id="mnForm" class="card" novalidate>
        <div class="mn-form">${formHtml(fields, values)}</div>
        <div class="acts" style="margin-top:20px;display:flex;gap:9px">
          <button type="button" class="btn soft" style="flex:1" data-dclose>Batal</button>
          <button type="submit" class="btn" style="flex:1">${esc(submit)}</button>
        </div>
      </form>`);
    const form = $('#mnForm');
    mountForm(form, fields, values);
    setTimeout(() => form.querySelector('[data-key]')?.focus(), 60);
    form.onsubmit = e => {
      e.preventDefault();
      const v = collect(form, fields);
      if(v){ closeDrawer(); res(v); }
    };
  });
}

/* =====================================================================
   DEFINISI FORM
   ===================================================================== */
const termsOptions = () => Object.entries(S.catalog.terms).map(([k, t]) => [k, t.title]);
const SERVICE_FIELDS = () => [
  {key:'label', label:'Nama layanan', req:true, placeholder:'mis. Wedding', help:'Tampil sebagai label kartu layanan, kategori di BMS, dan ringkasan booking.'},
  {key:'title', label:'Judul kartu', req:true, placeholder:'mis. Wedding Photography'},
  {key:'desc', label:'Deskripsi singkat', type:'textarea', rows:3, placeholder:'Satu kalimat tentang layanan ini.'},
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
    {key:'price', label:'Harga', type:'money', req:true, err:'Isi harga paket.'},
    {key:'perPerson', label:'Harga per orang', type:'check', help:'Total = harga × jumlah orang.'}
  ]},
  ...(g.people ? [{row:[
    {key:'min', label:'Min. orang', type:'number', min:1, help:'Untuk rekomendasi otomatis.', err:'Minimal 1.'},
    {key:'max', label:'Maks. orang', type:'number', min:1, err:'Harus ≥ min. orang.',
      check:(v, root) => { const mn = root.querySelector('[data-key="min"]').value; return v != null && mn !== '' && v < Number(mn) ? 'Harus ≥ min. orang.' : ''; }}
  ]}] : []),
  {key:'items', label:'Isi paket', type:'textarea', lines:true, req:true, rows:7, placeholder:'Satu poin per baris\nFoto Unlimited\n8 Jam Kerja', help:'Satu poin per baris — tampil sebagai daftar di kartu paket.', err:'Isi minimal satu poin.'},
  {key:'recommended', label:'Label RECOMMENDED', type:'check', help:g.people ? 'Di grup berbasis jumlah orang, label ini diganti rekomendasi otomatis.' : 'Sorot paket ini dengan label oranye.'},
  {key:'bestSeller', label:'Label BEST SELLER', type:'check'}
];
const PACKAGE_DIFF = [['name','Nama'],['price','Harga','rp'],['perPerson','Per orang','bool'],['min','Min. orang'],['max','Maks. orang'],['items','Isi paket','list'],['recommended','Recommended','bool'],['bestSeller','Best seller','bool']];
const ADDON_FIELDS = s => [
  {key:'name', label:'Nama add-on', req:true, placeholder:'mis. Cinematic Video'},
  {key:'price', label:'Harga', type:'money', req:true, err:'Isi harga add-on.'},
  {row:[
    {key:'unit', label:'Satuan', placeholder:'mis. 30 menit', help:'Tampil sebagai "per 30 menit".'},
    {key:'group', label:'Berlaku untuk', type:'select', options:[['', 'Semua grup paket'], ...s.groups.map(g => [g.id, g.label])]}
  ]},
  {key:'qty', label:'Bisa dipesan lebih dari satu', type:'check', help:'Client memilih jumlah (mis. 2 × 30 menit).'}
];
const ADDON_DIFF = [['name','Nama'],['price','Harga','rp'],['unit','Satuan'],['group','Grup'],['qty','Jumlah','bool']];
const TERMS_FIELDS = [
  {key:'title', label:'Judul', req:true, placeholder:'mis. Ketentuan Wedding & Couple Session', help:'Judul pop-up S&K di halaman booking.'},
  {key:'label', label:'Keterangan singkat', placeholder:'mis. (Wedding · Prewedding)', help:'Tampil di samping tautan "Syarat & ketentuan booking".'},
  {key:'list', label:'Poin ketentuan', type:'textarea', lines:true, req:true, rows:10, placeholder:'Satu poin per baris', help:'Satu poin per baris.', err:'Isi minimal satu poin.'}
];
const WA_RE = /^62\d{8,13}$/;
const SETTINGS_FIELDS = [
  {legend:'Pembayaran', fields:[{row:[
    {key:'dpPercent', label:'DP (%)', type:'number', req:true, min:1, max:100, help:'Dipakai landing page, BMS, dan invoice.', err:'Isi 1–100.'},
    {key:'holdMinutes', label:'Tahan jadwal (menit)', type:'number', req:true, min:5, max:1440, help:'Hitung mundur setelah booking.', err:'Isi 5–1440 menit.'}
  ]}]},
  {legend:'Rekening transfer DP', fields:[
    {key:'bankName', label:'Bank', req:true, placeholder:'mis. Bank BRI'},
    {row:[
      {key:'accountNo', label:'Nomor rekening', req:true, pattern:/^[0-9 -]{6,24}$/, err:'Isi nomor rekening (angka).'},
      {key:'accountName', label:'Atas nama', req:true}
    ]}
  ]},
  {legend:'WhatsApp', fields:[{row:[
    {key:'waPayment', label:'Konfirmasi pembayaran DP', type:'tel', req:true, pattern:WA_RE, help:'Format 62…, tanpa +.', err:'Gunakan format 62xxxxxxxxxx.'},
    {key:'waGeneral', label:'WhatsApp umum', type:'tel', req:true, pattern:WA_RE, err:'Gunakan format 62xxxxxxxxxx.'}
  ]}]}
];
const settingsValues = st => ({
  dpPercent:st.dpPercent, holdMinutes:st.holdMinutes,
  bankName:st.bank.name, accountNo:st.bank.accountNo, accountName:st.bank.accountName,
  waPayment:st.whatsapp.paymentConfirm, waGeneral:st.whatsapp.general
});
const SETTINGS_DIFF = [['dpPercent','DP %'],['holdMinutes','Tahan jadwal'],['bankName','Bank'],['accountNo','No. rekening'],['accountName','Atas nama'],['waPayment','WA pembayaran'],['waGeneral','WA umum']];

/* =====================================================================
   RENDER
   ===================================================================== */
RENDER.menu = () => {
  const pub = publicCatalog(S.catalog);
  const live = Object.keys(pub.services).length;
  $('#pgSub').textContent = `${live} dari ${S.catalog.services.length} layanan tampil di landing page`;
  const tabs = [['svc','Layanan & Paket'],['content','Konten'],['terms','Syarat & Ketentuan'],['settings','Pembayaran & Kontak']];
  $('#page').innerHTML = `
    <div class="jb-bar">
      <div class="chips">${tabs.map(([k, l]) => `<button class="chip ${MN.tab === k ? 'on' : ''}" data-mntab="${k}">${l}</button>`).join('')}</div>
    </div>
    <div id="mnBody"></div>`;
  $$('[data-mntab]').forEach(b => b.onclick = async () => {
    if(MN.tab === 'content' && b.dataset.mntab !== 'content' && contentDirty()
       && !await confirmBox('Konten belum disimpan', 'Perubahan tetap tersimpan sementara selama halaman tidak di-refresh. Pindah tab?', 'Pindah tab', false)) return RENDER.menu();
    MN.tab = b.dataset.mntab; RENDER.menu();
  });
  ({svc:renderServices, content:renderContent, terms:renderTerms, settings:renderSettings})[MN.tab]();
};

/* ---------- layanan & paket ---------- */
function renderServices(){
  const cat = S.catalog;
  if(!cat.services.length){
    $('#mnBody').innerHTML = `<div class="card"><div class="empty"><b>Belum ada layanan</b><span>Tambahkan layanan pertama.</span>
      <div style="margin-top:14px"><button class="btn" data-mn="svc-add">+ Tambah layanan</button></div></div></div>`;
    $('[data-mn="svc-add"]').onclick = addService;
    return;
  }
  if(!findSvc(MN.svc)) MN.svc = cat.services[0].id;
  const s = findSvc(MN.svc);
  const pub = publicCatalog(cat);
  const live = !!pub.services[s.id];
  const terms = cat.terms[s.terms];

  const list = cat.services.map((x, i) => {
    const n = x.groups.reduce((t, g) => t + g.packages.length, 0);
    const on = !!pub.services[x.id];
    return `<div class="mn-svc ${x.id === s.id ? 'on' : ''}">
      <button type="button" class="pick" data-pick="${esc(x.id)}">
        <span class="nm">${esc(x.label)}</span>
        <span class="ct">${n} paket · ${x.hidden ? 'disembunyikan' : on ? 'tampil' : 'tidak tampil'}</span>
      </button>
      <span class="ord">
        <button type="button" class="ibtn sm" data-svc-move="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Naikkan">${I.up}</button>
        <button type="button" class="ibtn sm" data-svc-move="${i}" data-d="1" ${i === cat.services.length - 1 ? 'disabled' : ''} aria-label="Turunkan">${I.down}</button>
      </span></div>`;
  }).join('');

  const tools = (attr, i, len, hidden) => `
    ${hidden !== undefined ? `<button type="button" class="ibtn ${hidden ? 'off' : ''}" data-${attr}-eye="${i}" title="${hidden ? 'Tampilkan' : 'Sembunyikan'}" aria-label="${hidden ? 'Tampilkan' : 'Sembunyikan'}">${hidden ? I.eyeOff : I.eye}</button>` : ''}
    <button type="button" class="ibtn" data-${attr}-move="${i}" data-d="-1" ${String(i).split(':').pop() == 0 ? 'disabled' : ''} aria-label="Naikkan">${I.up}</button>
    <button type="button" class="ibtn" data-${attr}-move="${i}" data-d="1" ${Number(String(i).split(':').pop()) === len - 1 ? 'disabled' : ''} aria-label="Turunkan">${I.down}</button>
    <button type="button" class="ibtn" data-${attr}-edit="${i}" aria-label="Ubah">${I.edit}</button>
    <button type="button" class="ibtn del" data-${attr}-del="${i}" aria-label="Hapus">${I.trash}</button>`;

  const groups = s.groups.map((g, gi) => `
    <div class="card mn-group">
      <div class="mn-group-h">
        <b>${esc(g.label)}</b>${g.people ? '<span class="badge b-neutral">Jumlah orang</span>' : ''}
        <span class="rowacts" style="margin-left:auto">${tools('grp', gi, s.groups.length)}</span>
      </div>
      ${g.packages.length ? g.packages.map((p, pi) => `
        <div class="mn-item ${p.hidden ? 'is-hidden' : ''}">
          <div class="info">
            <div class="t">${esc(p.name)}
              ${p.bestSeller ? '<span class="lb lb-grey" style="background:var(--solid);color:var(--solid-ink)">BEST SELLER</span>' : ''}
              ${p.recommended ? '<span class="lb lb-orange">RECOMMENDED</span>' : ''}
              ${p.hidden ? '<span class="lb lb-grey">Disembunyikan</span>' : ''}</div>
            <div class="tsub">${p.items.length} poin · ${esc(p.items.slice(0, 3).join(', '))}${p.items.length > 3 ? '…' : ''}${g.people && p.min != null ? ` · ${p.min}–${p.max} orang` : ''}</div>
          </div>
          <div class="price num">${rp(p.price)}${p.perPerson ? '<div class="tsub">per orang</div>' : ''}</div>
          <span class="rowacts">${tools('pkg', `${gi}:${pi}`, g.packages.length, !!p.hidden)}</span>
        </div>`).join('') : '<div class="jb-empty" style="margin:4px 0 8px">Belum ada paket di grup ini.</div>'}
      <button type="button" class="mn-add" data-pkg-add="${gi}">+ Tambah paket</button>
    </div>`).join('');

  const addons = `<div class="card mn-group">
      ${s.addons.length ? s.addons.map((a, ai) => `
        <div class="mn-item ${a.hidden ? 'is-hidden' : ''}">
          <div class="info">
            <div class="t">${esc(a.name)} ${a.hidden ? '<span class="lb lb-grey">Disembunyikan</span>' : ''}</div>
            <div class="tsub">${a.unit ? 'per ' + esc(a.unit) : 'sekali bayar'}${a.qty ? ' · bisa lebih dari satu' : ''} · ${a.group ? 'hanya ' + esc(s.groups.find(g => g.id === a.group)?.label || a.group) : 'semua grup'}</div>
          </div>
          <div class="price num">+${rp(a.price)}</div>
          <span class="rowacts">${tools('add', ai, s.addons.length, !!a.hidden)}</span>
        </div>`).join('') : '<div class="jb-empty" style="margin:4px 0 8px">Belum ada add-on untuk layanan ini.</div>'}
      <button type="button" class="mn-add" data-add-add>+ Tambah add-on</button>
    </div>`;

  $('#mnBody').innerHTML = `
    <div class="mn-layout">
      <div class="mn-list">${list}<button type="button" class="mn-svc-add" data-mn="svc-add">+ Tambah layanan</button></div>
      <div>
        <div class="card">
          <div class="mn-head">
            <div style="min-width:0">
              <div class="mn-eyebrow">${esc(s.label)}</div>
              <h2>${esc(s.title)}</h2>
              ${s.desc ? `<p>${esc(s.desc)}</p>` : ''}
            </div>
            <div class="acts">
              <button type="button" class="btn soft sm" data-mn="svc-eye">${s.hidden ? 'Tampilkan' : 'Sembunyikan'}</button>
              <button type="button" class="btn sm" data-mn="svc-edit">Ubah</button>
              <button type="button" class="ibtn del" data-mn="svc-del" aria-label="Hapus layanan">${I.trash}</button>
            </div>
          </div>
          <div class="chips" style="margin-top:12px">
            <span class="badge b-grey">${s.couple ? 'Form pasangan' : 'Form client'}</span>
            ${s.usesPeople ? '<span class="badge b-grey">Tanya jumlah orang</span>' : ''}
            <span class="badge b-grey">S&amp;K: ${esc(terms ? terms.title : '—')}</span>
            ${s.hidden ? '<span class="badge b-grey">Disembunyikan</span>' : live ? '<span class="badge b-ok"><span class="d"></span>Tampil di landing page</span>' : ''}
          </div>
          ${!s.hidden && !live ? '<div class="banner" style="margin:14px 0 0">Layanan ini tidak tampil karena belum punya paket yang aktif.</div>' : ''}
        </div>

        <div class="sec-h"><h3>Paket</h3><span class="tsub">urutan di sini = urutan di landing page</span>
          <div class="right"><button class="btn soft sm" data-mn="grp-add">+ Grup paket</button></div></div>
        ${groups || '<div class="card"><div class="jb-empty">Belum ada grup paket.</div></div>'}

        <div class="sec-h"><h3>Add-on</h3><span class="tsub">pilihan tambahan setelah client memilih paket</span></div>
        ${addons}
      </div>
    </div>`;
  bindServices(s);
}

const pair = v => String(v).split(':').map(Number);
function bindServices(s){
  const on = (sel, fn) => $$(sel).forEach(b => b.onclick = () => fn(b));
  const svcName = s.label;
  on('[data-pick]', b => { MN.svc = b.dataset.pick; RENDER.menu(); });
  on('[data-mn="svc-add"]', addService);

  on('[data-svc-move]', b => {
    const i = Number(b.dataset.svcMove), d = Number(b.dataset.d);
    if(move(S.catalog.services, i, d)) commit({action:'reorder', entity:'Layanan', target:S.catalog.services[i + d].label, detail:`Dipindah ke posisi ${i + d + 1}`}, 'Urutan disimpan');
  });
  on('[data-mn="svc-edit"]', async () => {
    const v = await openForm({eyebrow:'Layanan', title:`Ubah ${s.label}`, fields:SERVICE_FIELDS(), values:s});
    if(!v) return;
    const before = {...s}; Object.assign(s, v);
    commit({action:'update', entity:'Layanan', target:s.label, detail:diff(before, s, SERVICE_DIFF)});
  });
  on('[data-mn="svc-eye"]', () => {
    s.hidden = !s.hidden;
    commit({action:s.hidden ? 'hide' : 'show', entity:'Layanan', target:svcName}, s.hidden ? 'Layanan disembunyikan' : 'Layanan ditampilkan');
  });
  on('[data-mn="svc-del"]', async () => {
    const n = s.groups.reduce((t, g) => t + g.packages.length, 0);
    if(!await confirmBox(`Hapus layanan ${s.label}?`, `${n} paket dan ${s.addons.length} add-on ikut terhapus. Booking lama tetap tersimpan. Pertimbangkan "Sembunyikan" bila hanya ingin menonaktifkan sementara.`)) return;
    S.catalog.services = S.catalog.services.filter(x => x !== s);
    MN.svc = null;
    commit({action:'delete', entity:'Layanan', target:svcName, detail:`${n} paket, ${s.addons.length} add-on`}, 'Layanan dihapus');
  });

  /* grup */
  on('[data-mn="grp-add"]', async () => {
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
    const before = {...g}; Object.assign(g, v);
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
    const before = {...p}; Object.assign(p, v);
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
    if(!await confirmBox(`Hapus paket ${p.name}?`, 'Paket hilang dari landing page. Booking lama tetap tersimpan. Gunakan ikon mata bila hanya ingin menyembunyikan sementara.')) return;
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
    const before = {...a}; Object.assign(a, v, {group:v.group || null, unit:v.unit || null});
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
    if(!await confirmBox(`Hapus add-on ${a.name}?`, 'Add-on hilang dari landing page.')) return;
    s.addons.splice(i, 1);
    commit({action:'delete', entity:'Add-on', target:`${svcName} › ${a.name}`, detail:rp(a.price)}, 'Add-on dihapus');
  });
}
async function addService(){
  const v = await openForm({eyebrow:'Layanan', title:'Layanan baru', submit:'Tambah layanan', fields:SERVICE_FIELDS(),
    values:{terms:Object.keys(S.catalog.terms)[0]}});
  if(!v) return;
  const s = {id:newId(v.label), hidden:false, ...v, groups:[{id:newId(v.label + '-package'), label:`${v.label} Package`, packages:[]}], addons:[]};
  S.catalog.services.push(s);
  MN.svc = s.id; MN.tab = 'svc';
  commit({action:'create', entity:'Layanan', target:v.label}, 'Layanan ditambahkan — lanjut isi paketnya');
}

/* ---------- syarat & ketentuan ---------- */
function renderTerms(){
  const used = k => S.catalog.services.filter(s => s.terms === k);
  $('#mnBody').innerHTML = `
    <div class="sec-h" style="margin-top:0"><h3>Set syarat & ketentuan</h3>
      <div class="right"><button class="btn sm" id="termsAdd">+ Set S&amp;K</button></div></div>
    <div class="grid g2">${Object.entries(S.catalog.terms).map(([k, t]) => `
      <div class="card">
        <div style="display:flex;gap:10px;align-items:flex-start">
          <div style="min-width:0"><b style="font-size:15px">${esc(t.title)}</b><div class="tsub">${esc(t.label || '')}</div></div>
          <span class="rowacts" style="margin-left:auto">
            <button class="ibtn" data-terms-edit="${esc(k)}" aria-label="Ubah">${I.edit}</button>
            <button class="ibtn del" data-terms-del="${esc(k)}" aria-label="Hapus">${I.trash}</button>
          </span>
        </div>
        <div class="chips" style="margin-top:10px">${used(k).length ? used(k).map(s => `<span class="badge b-neutral">${esc(s.label)}</span>`).join('') : '<span class="badge b-grey">Belum dipakai</span>'}</div>
        <ol class="mn-terms">${t.list.slice(0, 5).map(i => `<li>${esc(i)}</li>`).join('')}</ol>
        ${t.list.length > 5 ? `<div class="tsub">+${t.list.length - 5} poin lainnya</div>` : ''}
      </div>`).join('')}</div>`;

  $('#termsAdd').onclick = async () => {
    const v = await openForm({eyebrow:'Syarat & ketentuan', title:'Set S&K baru', submit:'Tambah', fields:TERMS_FIELDS, values:{list:[]}});
    if(!v) return;
    S.catalog.terms[newId(v.title)] = v;
    commit({action:'create', entity:'S&K', target:v.title, detail:`${v.list.length} poin`}, 'S&K ditambahkan');
  };
  $$('[data-terms-edit]').forEach(b => b.onclick = async () => {
    const t = S.catalog.terms[b.dataset.termsEdit];
    const v = await openForm({eyebrow:'Syarat & ketentuan', title:`Ubah ${t.title}`, fields:TERMS_FIELDS, values:t});
    if(!v) return;
    const before = {...t}; Object.assign(t, v);
    commit({action:'update', entity:'S&K', target:t.title, detail:diff(before, t, [['title','Judul'],['label','Keterangan'],['list','Poin','list']])});
  });
  $$('[data-terms-del]').forEach(b => b.onclick = async () => {
    const k = b.dataset.termsDel, t = S.catalog.terms[k];
    const users = used(k);
    if(users.length){ toast(`Masih dipakai oleh ${users.map(s => s.label).join(', ')} — ganti S&K layanan itu dulu`); return; }
    if(!await confirmBox(`Hapus ${t.title}?`, 'Set syarat & ketentuan ini akan dihapus permanen.')) return;
    delete S.catalog.terms[k];
    commit({action:'delete', entity:'S&K', target:t.title}, 'S&K dihapus');
  });
}

/* ---------- pembayaran & kontak + data ---------- */
function renderSettings(){
  const st = S.catalog.settings;
  $('#mnBody').innerHTML = `
    <div class="grid g2" style="align-items:start">
      <form class="card" id="mnSettings" novalidate>
        <b style="font-size:15px">Pembayaran & kontak</b>
        <div class="tsub">Tampil di langkah konfirmasi & pembayaran landing page, juga dipakai invoice.</div>
        <div class="mn-form" style="margin-top:14px">${formHtml(SETTINGS_FIELDS, settingsValues(st))}</div>
        <button type="submit" class="btn block" style="margin-top:18px">Simpan pengaturan</button>
      </form>
      <div class="card">
        <b style="font-size:15px">Data menu</b>
        <div class="tsub">Cadangan & pemindahan data.</div>
        <div class="mn-data"><div><b>Ekspor menu</b><span>Unduh seluruh menu sebagai file JSON untuk cadangan.</span></div>
          <button class="btn soft sm" id="mnExport">Ekspor JSON</button></div>
        <div class="mn-data"><div><b>Impor menu</b><span>Ganti seluruh menu dengan file JSON hasil ekspor.</span></div>
          <button class="btn soft sm" id="mnImport">Impor JSON</button></div>
        <div class="mn-data"><div><b>Kembalikan ke bawaan</b><span>Pulihkan pricelist Kalaatma 2026 asli. Booking lama tidak terpengaruh.</span></div>
          <button class="btn danger sm" id="mnReset">Reset menu</button></div>
        <input type="file" id="mnFile" accept="application/json,.json" hidden>
      </div>
    </div>`;
  const form = $('#mnSettings');
  mountForm(form, SETTINGS_FIELDS, {});
  form.onsubmit = e => {
    e.preventDefault();
    const v = collect(form, SETTINGS_FIELDS); if(!v) return;
    const detail = diff(settingsValues(S.catalog.settings), v, SETTINGS_DIFF);
    if(!detail){ toast('Tidak ada perubahan'); return; }
    S.catalog.settings = {
      ...S.catalog.settings,
      dpPercent:v.dpPercent, holdMinutes:v.holdMinutes,
      bank:{name:v.bankName, accountNo:v.accountNo, accountName:v.accountName},
      whatsapp:{paymentConfirm:v.waPayment, general:v.waGeneral}
    };
    commit({action:'update', entity:'Pengaturan', target:'Pembayaran & kontak', detail}, 'Pengaturan disimpan');
  };
  $('#mnExport').onclick = () => {
    const blob = new Blob([JSON.stringify(S.catalog, null, 2)], {type:'application/json'});
    const a = Object.assign(document.createElement('a'), {href:URL.createObjectURL(blob), download:`kalaatma-menu-${new Date().toISOString().slice(0, 10)}.json`});
    a.click(); URL.revokeObjectURL(a.href);
    logAct('system', 'Menu', 'Ekspor menu');
    toast('Menu diekspor');
  };
  $('#mnImport').onclick = () => $('#mnFile').click();
  $('#mnFile').onchange = async e => {
    const file = e.target.files[0]; e.target.value = '';
    if(!file) return;
    let data;
    try{ data = JSON.parse(await file.text()); }catch(_){ toast('File bukan JSON yang valid'); return; }
    if(!isCatalog(data)){ toast('Format file tidak dikenali — gunakan file hasil Ekspor JSON'); return; }
    if(!await confirmBox('Impor menu ini?', `${data.services.length} layanan dari "${file.name}" akan menggantikan menu saat ini.`, 'Impor', false)) return;
    S.catalog = data; MN.svc = null; buildPackages();
    commit({action:'system', entity:'Menu', target:'Impor menu', detail:file.name}, 'Menu diimpor');
  };
  $('#mnReset').onclick = async () => {
    if(!await confirmBox('Kembalikan menu ke bawaan?', 'Seluruh layanan, paket, add-on, S&K, dan pengaturan pembayaran diganti pricelist bawaan.', 'Reset menu')) return;
    S.catalog = defaultCatalog();
    MN.svc = null;
    commit({action:'system', entity:'Menu', target:'Reset menu ke bawaan'}, 'Menu dikembalikan ke bawaan');
  };
}
