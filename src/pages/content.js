/* =====================================================================
   MENU → KONTEN — teks & foto landing page (hero, tentang, layanan,
   portfolio, testimoni, FAQ, dll.). Disimpan di app_config key
   'content' (format: src/shared/content.js, identik dengan landing page).
   Foto di-upload ke Supabase Storage bucket 'landing' (dikecilkan dulu)
   atau memakai link gambar.
   ===================================================================== */
import { $, $$, S, RENDER, esc, toast, api, logAct, confirmBox, storageUpload } from '../core.js';
import { CONTENT_KEY, STORAGE_BUCKET, mergeContent } from '../shared/content.js';

const C = { loaded:false, saved:null, draft:null, version:null, sec:'hero', busy:false };
const clone = v => JSON.parse(JSON.stringify(v));
const getPath = (o, p) => p.split('.').reduce((a, k) => a == null ? a : a[k], o);
function setPath(o, p, v){
  const ks = p.split('.'); let cur = o;
  ks.slice(0, -1).forEach(k => { if(cur[k] == null) cur[k] = /^\d+$/.test(k) ? [] : {}; cur = cur[k]; });
  cur[ks.at(-1)] = v;
}
const dirty = () => JSON.stringify(C.draft) !== JSON.stringify(C.saved);

/* ---------- definisi bagian & kolom ----------
   f: [path, label, type, opts]   type: text · area · photo · tags · rating */
const SECTIONS = [
  {id:'brand', label:'Identitas', hint:'Nama & tagline di header/footer', f:[
    ['brand.name','Nama brand','text'], ['brand.tagline','Tagline','text']]},
  {id:'hero', label:'Hero (paling atas)', hint:'Judul besar, foto utama lengkung, galeri singkat', f:[
    ['hero.eyebrow','Teks kecil di atas judul','text'], ['hero.title','Judul','area'], ['hero.subtitle','Deskripsi','area'],
    ['hero.cta','Teks tombol booking','text'], ['hero.photo','Foto utama (bingkai lengkung, portrait)','photo'],
    ['hero.galleryTitle','Judul galeri singkat','text'], ['hero.gallery.0','Galeri 1','photo'], ['hero.gallery.1','Galeri 2','photo'],
    ['hero.rating','Rating (mis. 4.9/5)','text'], ['hero.ratingNote','Keterangan rating','text'],
    ['hero.tags','Tag (pisahkan dengan koma)','tags']]},
  {id:'highlight', label:'Highlight', hint:'Kotak di bawah hero', f:[
    ['highlight.title','Judul','text'], ['highlight.text','Teks','area'],
    ['highlight.number','Angka besar','text'], ['highlight.numberLabel','Keterangan angka','text']]},
  {id:'about', label:'Tentang', hint:'Cerita singkat + 2 foto', f:[
    ['about.eyebrow','Label kecil','text'], ['about.title','Judul','text'], ['about.text','Teks','area'],
    ['about.photos.0','Foto 1 (portrait)','photo'], ['about.photos.1','Foto 2 (landscape)','photo']]},
  {id:'services', label:'Layanan', hint:'Teks pembuka + foto tiap layanan (dari tab Layanan & Paket)', f:[
    ['services.eyebrow','Label kecil','text'], ['services.title','Judul','text'], ['services.text','Teks','area']], extra:'servicePhotos'},
  {id:'stats', label:'Angka pencapaian', hint:'Pita hijau berisi angka', list:{path:'stats', item:'Angka', blank:{value:'', label:''},
    f:[['value','Angka (mis. 300+)','text'], ['label','Keterangan','text']]}},
  {id:'why', label:'Kenapa Kalaatma', hint:'Kartu teks + foto oval + foto samping', f:[
    ['why.eyebrow','Label kecil','text'], ['why.title','Judul','text'], ['why.text','Teks','area'],
    ['why.photo','Foto oval (portrait)','photo'], ['why.sideText','Teks samping','area'], ['why.sidePhoto','Foto samping','photo']]},
  {id:'portfolio', label:'Portfolio', hint:'Daftar cerita client, masing-masing 3 foto', f:[
    ['portfolio.eyebrow','Label kecil','text'], ['portfolio.title','Judul','text']],
    list:{path:'portfolio.items', item:'Cerita', blank:{title:'', subtitle:'', photos:['', '', '']},
      f:[['title','Nama client (mis. Alicia & Martin)','text'], ['subtitle','Keterangan (mis. Wedding · Bandung)','text'],
         ['photos.0','Foto 1','photo'], ['photos.1','Foto 2','photo'], ['photos.2','Foto 3','photo']]}},
  {id:'testimonials', label:'Testimoni', hint:'Ulasan client', f:[
    ['testimonials.eyebrow','Label kecil','text'], ['testimonials.title','Judul','text']],
    list:{path:'testimonials.items', item:'Testimoni', blank:{name:'', event:'', text:'', rating:5, photo:''},
      f:[['name','Nama','text'], ['event','Acara (mis. Wedding)','text'], ['text','Isi testimoni','area'],
         ['rating','Bintang','rating'], ['photo','Foto (opsional)','photo']]}},
  {id:'faq', label:'FAQ', hint:'Pertanyaan yang sering ditanyakan', f:[
    ['faq.eyebrow','Label kecil','text'], ['faq.title','Judul','text'], ['faq.photo','Foto samping (portrait)','photo']],
    list:{path:'faq.items', item:'Pertanyaan', blank:{q:'', a:''}, f:[['q','Pertanyaan','text'], ['a','Jawaban','area']]}},
  {id:'cta', label:'Ajakan booking', hint:'Bagian dengan foto latar sebelum footer', f:[
    ['cta.title','Judul','text'], ['cta.text','Teks','area'], ['cta.button','Teks tombol','text'], ['cta.photo','Foto latar (landscape)','photo']]},
  {id:'footer', label:'Footer & kontak', hint:'Alamat, email, Instagram', f:[
    ['footer.text','Deskripsi singkat','area'], ['footer.address','Alamat','text'], ['footer.phone','Telepon / WA','text'],
    ['footer.email','Email','text'], ['footer.instagram','Instagram (tanpa @)','text']]}
];
const secOf = id => SECTIONS.find(s => s.id === id) || SECTIONS[0];
const ICON = {
  up:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 15l6-6 6 6"/></svg>',
  down:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>',
  del:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
  img:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>'
};

/* ---------- muat & simpan ---------- */
async function load(){
  const rows = await api(`app_config?key=eq.${CONTENT_KEY}&select=value,updated_at`);
  C.saved = mergeContent(rows[0]?.value);
  C.draft = clone(C.saved);
  C.version = rows[0]?.updated_at ?? null;
  C.loaded = true;
}
async function save(){
  if(C.busy) return;
  C.busy = true; paintBar();
  const changed = SECTIONS.filter(s => JSON.stringify(sectionData(C.draft, s)) !== JSON.stringify(sectionData(C.saved, s))).map(s => s.label);
  try{
    if(C.version === null){
      const [row] = await api('app_config', {method:'POST', body:{key:CONTENT_KEY, value:C.draft}, prefer:'return=representation'});
      C.version = row.updated_at;
    } else {
      const rows = await api(`app_config?key=eq.${CONTENT_KEY}&updated_at=eq.${encodeURIComponent(C.version)}`,
        {method:'PATCH', body:{value:C.draft}, prefer:'return=representation'});
      if(!rows.length){
        C.busy = false;
        const reloadIt = await confirmBox('Konten baru saja diubah admin lain',
          'Muat versi terbaru? Perubahan Anda yang belum tersimpan akan hilang.', 'Muat terbaru', false);
        if(reloadIt){ await load(); toast('Konten terbaru dimuat'); }
        return RENDER.menu();
      }
      C.version = rows[0].updated_at;
    }
    C.saved = clone(C.draft);
    await logAct('update', 'Konten landing', changed.join(', ') || 'Konten', 'Teks/foto landing page diperbarui');
    toast('Konten tersimpan — landing page langsung memakai versi baru');
  }catch(e){
    toast('Gagal menyimpan: ' + e.message);
  }
  C.busy = false;
  RENDER.menu();
}
const sectionData = (c, s) => [...(s.f || []).map(([p]) => getPath(c, p)), s.list ? getPath(c, s.list.path) : null,
  s.extra === 'servicePhotos' ? c.services.photos : null];

/* ---------- komponen kolom ---------- */
const val = p => getPath(C.draft, p);
function photoField(path, label){
  const u = val(path) || '';
  return `<div class="ct-photo" data-photo="${esc(path)}">
    <div class="ct-thumb">${u ? `<img src="${esc(u)}" alt="" loading="lazy">` : ICON.img}</div>
    <div class="ct-photo-b">
      <label>${esc(label)}</label>
      <div class="ct-photo-acts">
        <label class="btn soft sm ct-up">Upload foto<input type="file" accept="image/jpeg,image/png,image/webp" hidden data-up="${esc(path)}"></label>
        <button type="button" class="btn ghost sm" data-link="${esc(path)}">Pakai link</button>
        ${u ? `<button type="button" class="btn ghost sm" data-clear="${esc(path)}" style="color:var(--err)">Hapus</button>` : ''}
      </div>
      <div class="tsub ct-st" data-st="${esc(path)}">${u ? 'Foto terpasang' : 'Belum ada foto — tampil bingkai polos'}</div>
    </div>
  </div>`;
}
function field([path, label, type], base = ''){
  const p = base ? `${base}.${path}` : path;
  const v = val(p);
  if(type === 'photo') return photoField(p, label);
  if(type === 'area') return `<div class="fld"><label>${esc(label)}</label><textarea rows="3" data-p="${esc(p)}">${esc(v || '')}</textarea></div>`;
  if(type === 'tags') return `<div class="fld"><label>${esc(label)}</label><input data-p="${esc(p)}" data-tags value="${esc((v || []).join(', '))}"></div>`;
  if(type === 'rating') return `<div class="fld"><label>${esc(label)}</label><select data-p="${esc(p)}" data-num>${[5,4,3].map(n => `<option ${Number(v) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>`;
  return `<div class="fld"><label>${esc(label)}</label><input data-p="${esc(p)}" value="${esc(v ?? '')}"></div>`;
}

/* ---------- tampilan ---------- */
export function renderContent(){
  const body = $('#mnBody');
  if(!C.loaded){
    body.innerHTML = '<div class="card"><div class="tsub">Memuat konten…</div></div>';
    load().then(() => S.page === 'menu' && RENDER.menu()).catch(e => {
      body.innerHTML = `<div class="banner">Gagal memuat konten: ${esc(e.message)}</div>`;
    });
    return;
  }
  const s = secOf(C.sec);
  const services = S.catalog?.services || [];
  const list = s.list ? (val(s.list.path) || []) : null;

  body.innerHTML = `
    <div class="ct-bar ${dirty() ? 'dirty' : ''}" id="ctBar"></div>
    <div class="mn-layout">
      <div class="mn-list">${SECTIONS.map(x => `
        <button class="mn-svc ct-sec ${x.id === s.id ? 'on' : ''}" data-sec="${x.id}">
          <span class="pick"><span class="nm">${esc(x.label)}</span><span class="ct">${esc(x.hint)}</span></span>
        </button>`).join('')}</div>
      <div>
        <div class="card">
          <div class="mn-eyebrow">Konten landing page</div>
          <h2 style="font-size:20px;margin:4px 0 2px">${esc(s.label)}</h2>
          <div class="tsub" style="margin-bottom:14px">${esc(s.hint)}</div>
          <div class="ct-fields">${(s.f || []).map(f => field(f)).join('')}</div>
          ${s.extra === 'servicePhotos' ? `
            <div class="mlabel" style="margin:18px 0 8px">Foto tiap layanan</div>
            ${services.length ? services.map(x => photoField(`services.photos.${x.id}`, `${x.label}${x.hidden ? ' (disembunyikan)' : ''}`)).join('')
              : '<div class="tsub">Belum ada layanan.</div>'}` : ''}
        </div>
        ${list ? `<div class="sec-h"><h3>${esc(s.list.item)} (${list.length})</h3>
          <div class="right"><button class="btn soft sm" data-add>+ Tambah ${esc(s.list.item.toLowerCase())}</button></div></div>
          ${list.map((_, i) => `<div class="card ct-item">
            <div class="ct-item-h"><b>${esc(s.list.item)} ${i + 1}</b>
              <button class="ibtn" data-mv="${i}:-1" ${i === 0 ? 'disabled' : ''} aria-label="Naik">${ICON.up}</button>
              <button class="ibtn" data-mv="${i}:1" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Turun">${ICON.down}</button>
              <button class="ibtn del" data-rm="${i}" aria-label="Hapus">${ICON.del}</button></div>
            <div class="ct-fields">${s.list.f.map(f => field(f, `${s.list.path}.${i}`)).join('')}</div>
          </div>`).join('') || '<div class="card"><div class="jb-empty">Belum ada. Bagian ini disembunyikan di landing page selama kosong.</div></div>'}` : ''}
      </div>
    </div>`;
  paintBar();
  bind(s);
}

/* Bar simpan diperbarui di tempat (tidak dibuat ulang), supaya klik "Simpan"
   tidak hilang saat kolom yang sedang diketik memicu 'change' ketika kehilangan fokus. */
function paintBar(){
  const bar = $('#ctBar'); if(!bar) return;
  if(!bar.firstChild){
    bar.innerHTML = `<span id="ctMsg"></span>
      <button class="btn soft sm" id="ctReset">Batalkan perubahan</button>
      <button class="btn sm" id="ctSave">Simpan konten</button>`;
    $('#ctSave').onclick = save;
    $('#ctReset').onclick = () => { C.draft = clone(C.saved); RENDER.menu(); };
  }
  const d = dirty();
  bar.classList.toggle('dirty', d);
  $('#ctMsg').textContent = C.busy ? 'Menyimpan…' : d ? '● Ada perubahan yang belum disimpan' : '✓ Semua perubahan tersimpan';
  $('#ctSave').disabled = $('#ctReset').disabled = !d || C.busy;
}

function bind(s){
  $$('[data-sec]').forEach(b => b.onclick = () => { C.sec = b.dataset.sec; RENDER.menu(); });
  $$('[data-p]').forEach(el => el.oninput = el.onchange = () => {
    const v = el.hasAttribute('data-tags') ? el.value.split(',').map(t => t.trim()).filter(Boolean)
      : el.hasAttribute('data-num') ? Number(el.value) : el.value;
    setPath(C.draft, el.dataset.p, v);
    paintBar();
  });
  if(s.list){
    const arr = () => val(s.list.path);
    $('[data-add]').onclick = () => { if(!val(s.list.path)) setPath(C.draft, s.list.path, []); arr().push(clone(s.list.blank)); RENDER.menu(); };
    $$('[data-rm]').forEach(b => b.onclick = async () => {
      if(!await confirmBox(`Hapus ${s.list.item.toLowerCase()} ini?`, 'Baru benar-benar hilang dari landing page setelah Simpan konten.', 'Hapus')) return RENDER.menu();
      arr().splice(Number(b.dataset.rm), 1); RENDER.menu();
    });
    $$('[data-mv]').forEach(b => b.onclick = () => {
      const [i, d] = b.dataset.mv.split(':').map(Number), a = arr(), j = i + d;
      if(j < 0 || j >= a.length) return;
      [a[i], a[j]] = [a[j], a[i]]; RENDER.menu();
    });
  }
  $$('[data-clear]').forEach(b => b.onclick = () => { setPath(C.draft, b.dataset.clear, ''); RENDER.menu(); });
  $$('[data-link]').forEach(b => b.onclick = () => {
    const path = b.dataset.link;
    const box = b.closest('.ct-photo-b');
    if(box.querySelector('.ct-linkrow')) return;
    box.insertAdjacentHTML('beforeend', `<div class="ct-linkrow"><input placeholder="https://…/foto.jpg" value="${esc(val(path) || '')}"><button class="btn sm" type="button">Pakai</button></div>`);
    const row = box.querySelector('.ct-linkrow'), inp = row.querySelector('input');
    inp.focus();
    row.querySelector('button').onclick = () => {
      const u = inp.value.trim();
      if(u && !/^https?:\/\//i.test(u)) return toast('Link harus diawali https://');
      setPath(C.draft, path, u); RENDER.menu();
    };
  });
  $$('[data-up]').forEach(inp => inp.onchange = async () => {
    const file = inp.files[0], path = inp.dataset.up;
    if(!file) return;
    const st = $(`[data-st="${CSS.escape(path)}"]`);
    try{
      st.textContent = 'Memperkecil foto…';
      const blob = await shrink(file);
      st.textContent = `Mengunggah ${(blob.size / 1024).toFixed(0)} KB…`;
      const folder = path.split('.')[0];
      const url = await storageUpload(STORAGE_BUCKET, `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`, blob, 'image/jpeg');
      setPath(C.draft, path, url);
      toast('Foto terunggah — klik Simpan konten agar tampil');
      RENDER.menu();
    }catch(e){ st.textContent = 'Gagal: ' + e.message; toast('Upload gagal: ' + e.message); }
  });
}

/* foto diperkecil (sisi terpanjang 1800px, JPEG 82%) supaya landing page ringan */
function shrink(file, max = 1800, q = 0.82){
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      cv.toBlob(b => b ? resolve(b) : reject(new Error('Foto tidak bisa diproses')), 'image/jpeg', q);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('File bukan gambar yang didukung')); };
    img.src = url;
  });
}

/* peringatan bila pindah halaman dengan perubahan belum tersimpan */
window.addEventListener('beforeunload', e => { if(C.loaded && dirty()){ e.preventDefault(); e.returnValue = ''; } });
export const contentDirty = () => C.loaded && dirty();
