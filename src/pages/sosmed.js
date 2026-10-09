/* =====================================================================
   SOSMED — jadwal & posting konten Instagram + TikTok.
   • Data: tabel social_posts (RLS admin). Media di Storage bucket 'social'.
   • Instagram: diposting otomatis oleh Edge Function `social-publish`
     (dipicu pg_cron tiap 2 menit) lewat Instagram Graph API.
   • TikTok (tahap 1): saat jadwal tiba status jadi "manual" — admin unduh
     media + salin caption, posting di aplikasi TikTok, lalu tandai selesai.
   • Token Instagram disimpan lewat RPC save_social_credentials dan tidak
     pernah bisa dibaca lagi dari browser.
   ===================================================================== */
import { $, $$, S, RENDER, esc, iso, today, toast, api, logAct, confirmBox, storageUpload, callFn,
  openDrawer, closeDrawer, openModal, closeModal, chipbar } from '../core.js';

const BUCKET = 'social';
const P = { list:[], loaded:false, view:'calendar', filter:'all', month:new Date(), ig:null, igLoading:false, draft:null, busy:false };

const KIND = { photo:'Foto', carousel:'Carousel', reel:'Reels / Video' };
const STATUS = {
  draft:     ['Draft', 'b-grey'],
  scheduled: ['Terjadwal', 'b-neutral'],
  publishing:['Sedang diposting', 'b-warn'],
  manual:    ['TikTok perlu diposting', 'b-warn'],
  published: ['Terbit', 'b-ok'],
  failed:    ['Gagal', 'b-err']
};
const PLAT_ICON = {
  instagram:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>',
  tiktok:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.6 3c.4 2.2 1.8 3.7 4 3.9v3.2a7.6 7.6 0 0 1-4-1.2v6.3a6 6 0 1 1-6-6c.3 0 .7 0 1 .1v3.3a2.8 2.8 0 1 0 1.8 2.6V3h3.2z"/></svg>'
};
const badge = s => { const [l, c] = STATUS[s] || [s, 'b-grey']; return `<span class="badge ${c}"><span class="d"></span>${l}</span>`; };
const plats = p => (p.platforms || []).map(k => `<span class="so-plat ${k}" title="${k}">${PLAT_ICON[k] || ''}</span>`).join('');
const fmtDT = t => t ? new Date(t).toLocaleString('id-ID', {weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'}) : 'Belum dijadwalkan';
const localInput = t => { if(!t) return ''; const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const thumb = m => !m ? '<span class="so-th empty"></span>'
  : m.type === 'video' ? `<span class="so-th vid"><video src="${esc(m.url)}#t=0.5" muted preload="metadata"></video><i>▶</i></span>`
  : `<span class="so-th"><img src="${esc(m.url)}" alt="" loading="lazy"></span>`;
const hashtags = c => (String(c).match(/#[\p{L}\p{N}_]+/gu) || []).length;

/* ---------- data ---------- */
async function load(){
  P.list = await api('social_posts?select=*&order=scheduled_at.asc.nullsfirst,created_at.desc');
  P.loaded = true;
}
async function loadIg(){
  P.igLoading = true;
  try{ P.ig = (await callFn('social-publish', {action:'status'})).instagram; }
  catch(e){ P.ig = {connected:false, error:e.message}; }
  P.igLoading = false;
  if(S.page === 'sosmed') paintConn();
}

/* ---------- tampilan utama ---------- */
RENDER.sosmed = () => {
  if(!P.loaded){
    $('#page').innerHTML = '<div class="card"><div class="tsub">Memuat konten sosmed…</div></div>';
    load().then(() => S.page === 'sosmed' && RENDER.sosmed())
      .catch(e => { $('#page').innerHTML = `<div class="banner">Gagal memuat: ${esc(e.message)}</div>`; });
    if(!P.ig && !P.igLoading) loadIg();
    return;
  }
  const counts = P.list.reduce((a, p) => (a[p.status] = (a[p.status] || 0) + 1, a), {});
  const upcoming = P.list.filter(p => p.status === 'scheduled').length;
  $('#pgSub').textContent = `${upcoming} terjadwal · ${counts.manual || 0} TikTok menunggu · ${counts.failed || 0} gagal`;

  $('#page').innerHTML = `
    <div class="so-conn" id="soConn"></div>
    <div class="jb-bar" style="margin-top:16px">
      ${chipbar([{v:'calendar', l:'Kalender'}, {v:'list', l:'Daftar'}], P.view, v => { P.view = v; RENDER.sosmed(); })}
      <div class="chips" style="margin-left:auto"><button class="btn sm" id="soNew">+ Buat posting</button></div>
    </div>
    ${P.view === 'list' ? `<div style="margin:12px 0">${chipbar([
      {v:'all', l:`Semua (${P.list.length})`}, ...Object.keys(STATUS).filter(k => counts[k]).map(k => ({v:k, l:`${STATUS[k][0]} (${counts[k]})`}))
    ], P.filter, v => { P.filter = v; RENDER.sosmed(); }, true)}</div>` : ''}
    <div id="soBody"></div>`;
  paintConn();
  P.view === 'calendar' ? paintCalendar() : paintList();
  $('#soNew').onclick = () => openEditor();
};

function paintConn(){
  const el = $('#soConn'); if(!el) return;
  const g = P.ig;
  el.innerHTML = `
    <div class="card so-acc">
      <span class="so-plat instagram lg">${PLAT_ICON.instagram}</span>
      <div class="so-acc-b">
        <b>Instagram</b>
        <span class="tsub">${P.igLoading && !g ? 'Mengecek koneksi…'
          : g?.connected ? `Terhubung sebagai <b>@${esc(g.username)}</b>${g.quota?.total ? ` · kuota ${g.quota.used ?? 0}/${g.quota.total} posting per 24 jam` : ''}`
          : g?.error ? `<span style="color:var(--err)">Belum terhubung — ${esc(g.error)}</span>` : 'Belum terhubung. Posting otomatis butuh koneksi Instagram.'}</span>
      </div>
      <button class="btn ${g?.connected ? 'soft' : ''} sm" id="soIgConnect">${g?.connected ? 'Ganti token' : 'Hubungkan'}</button>
    </div>
    <div class="card so-acc">
      <span class="so-plat tiktok lg">${PLAT_ICON.tiktok}</span>
      <div class="so-acc-b">
        <b>TikTok</b>
        <span class="tsub">Mode manual: saat jadwal tiba, posting muncul di daftar "TikTok perlu diposting" — unduh video & salin caption, lalu posting di aplikasi TikTok.</span>
      </div>
    </div>`;
  $('#soIgConnect').onclick = connectModal;
}

/* ---------- kalender ---------- */
function paintCalendar(){
  const y = P.month.getFullYear(), m = P.month.getMonth();
  const first = new Date(y, m, 1), last = new Date(y, m + 1, 0), pad = (first.getDay() + 6) % 7;
  const cells = [...Array(pad).fill(null), ...Array.from({length:last.getDate()}, (_, i) => iso(new Date(y, m, i + 1)))];
  const byDay = {};
  P.list.forEach(p => { if(p.scheduled_at) (byDay[iso(new Date(p.scheduled_at))] ||= []).push(p); });
  const title = P.month.toLocaleDateString('id-ID', {month:'long', year:'numeric'});
  const unscheduled = P.list.filter(p => !p.scheduled_at);
  $('#soBody').innerHTML = `
    <div class="mcal-nav" style="margin-top:14px">
      <button class="btn soft sm" id="soPrev">‹<span class="hide-m"> Sebelumnya</span></button>
      <h3>${title}</h3>
      <button class="btn soft sm" id="soNext"><span class="hide-m">Berikutnya </span>›</button>
    </div>
    <div class="card">
      <div class="mcal-dow">${['Sen','Sel','Rab','Kam','Jum','Sab','Min'].map(d => `<div>${d}</div>`).join('')}</div>
      <div class="mcal">${cells.map(c => {
        if(!c) return '<div></div>';
        const list = (byDay[c] || []).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
        return `<div class="mcal-d so-day ${c === today() ? 'now' : ''}" data-day="${c}">
          <div class="n">${Number(c.slice(-2))}</div>
          ${list.slice(0, 3).map(p => `<button class="mcal-ev so-ev st-${p.status}" data-post="${p.id}">${new Date(p.scheduled_at).toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'})} ${esc(KIND[p.kind])}</button>`).join('')}
          ${list.length > 3 ? `<div class="more">+${list.length - 3} lagi</div>` : ''}
        </div>`;
      }).join('')}</div>
      <div class="tsub" style="margin-top:12px">Klik tanggal kosong untuk membuat posting di hari itu.</div>
    </div>
    ${unscheduled.length ? `<div class="sec-h"><h3>Draft tanpa jadwal (${unscheduled.length})</h3></div>${listHtml(unscheduled)}` : ''}`;
  $('#soPrev').onclick = () => { P.month = new Date(y, m - 1, 1); paintCalendar(); };
  $('#soNext').onclick = () => { P.month = new Date(y, m + 1, 1); paintCalendar(); };
  $$('[data-day]').forEach(d => d.onclick = e => { if(!e.target.closest('[data-post]')) openEditor(null, d.dataset.day); });
  bindPosts();
}

/* ---------- daftar ---------- */
function listHtml(list){
  if(!list.length) return '<div class="card"><div class="jb-empty">Belum ada posting.</div></div>';
  return `<div class="so-list">${list.map(p => `
    <button class="card so-item" data-post="${p.id}">
      ${thumb(p.media?.[0])}
      <span class="so-item-b">
        <span class="so-item-h">${plats(p)}<b>${esc(KIND[p.kind])}${p.media?.length > 1 ? ` · ${p.media.length} media` : ''}</b>${badge(p.status)}</span>
        <span class="so-cap">${esc(p.caption || '(tanpa caption)')}</span>
        <span class="tsub">${fmtDT(p.scheduled_at)}${p.ig?.error ? ` · <span style="color:var(--err)">${esc(p.ig.error)}</span>` : ''}</span>
      </span>
    </button>`).join('')}</div>`;
}
function paintList(){
  const list = P.list.filter(p => P.filter === 'all' || p.status === P.filter)
    .sort((a, b) => (b.scheduled_at || b.created_at).localeCompare(a.scheduled_at || a.created_at));
  $('#soBody').innerHTML = listHtml(list);
  bindPosts();
}
const bindPosts = () => $$('[data-post]').forEach(b => b.onclick = e => { e.stopPropagation(); openPost(b.dataset.post); });

/* ---------- detail posting ---------- */
function openPost(id){
  const p = P.list.find(x => x.id === id); if(!p) return;
  const editable = !['published', 'publishing', 'manual'].includes(p.status);
  const ttWait = p.platforms.includes('tiktok') && p.tiktok?.state !== 'posted';
  openDrawer(`
    <div class="dh"><div><h2>${esc(KIND[p.kind])}</h2><div class="tsub">${fmtDT(p.scheduled_at)}</div></div><button class="x" data-dclose>✕</button></div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px">${plats(p)}${badge(p.status)}</div>
    <div class="so-media">${(p.media || []).map(thumb).join('')}</div>
    <div class="card" style="margin-top:12px;white-space:pre-wrap;font-size:13px">${esc(p.caption || '(tanpa caption)')}</div>
    ${p.platforms.includes('instagram') ? `<div class="card so-pl" style="margin-top:12px">
      <span class="so-plat instagram">${PLAT_ICON.instagram}</span>
      <div><b>Instagram</b><div class="tsub">${p.ig?.state === 'published' ? `Terbit ${fmtDT(p.ig.published_at)}${p.ig.permalink ? ` · <a href="${esc(p.ig.permalink)}" target="_blank" rel="noopener">Lihat posting ↗</a>` : ''}`
        : p.ig?.state === 'failed' ? `<span style="color:var(--err)">Gagal: ${esc(p.ig.error || '')}</span>`
        : p.ig?.state === 'processing' ? 'Instagram sedang memproses media…' : 'Menunggu jadwal'}</div></div></div>` : ''}
    ${p.platforms.includes('tiktok') ? `<div class="card so-pl" style="margin-top:10px">
      <span class="so-plat tiktok">${PLAT_ICON.tiktok}</span>
      <div style="flex:1"><b>TikTok</b><div class="tsub">${p.tiktok?.state === 'posted' ? 'Sudah diposting manual'
        : p.tiktok?.state === 'ready' ? 'Waktunya posting — unduh media & salin caption, lalu posting di aplikasi TikTok.' : 'Menunggu jadwal (manual)'}</div>
        ${ttWait ? `<div class="so-acts">
          ${(p.media || []).map((m, i) => `<a class="btn soft sm" href="${esc(m.url)}" download target="_blank" rel="noopener">Unduh ${m.type === 'video' ? 'video' : 'foto'}${p.media.length > 1 ? ' ' + (i + 1) : ''}</a>`).join('')}
          <button class="btn soft sm" id="soCopy">Salin caption</button>
          <button class="btn sm" id="soTtDone">Tandai sudah diposting</button></div>` : ''}
      </div></div>` : ''}
    <div class="so-acts" style="margin-top:18px">
      ${editable ? '<button class="btn soft" id="soEdit">Edit</button>' : ''}
      ${['draft', 'scheduled', 'failed'].includes(p.status) && p.platforms.includes('instagram') ? `<button class="btn" id="soNow">${p.status === 'failed' ? 'Coba posting lagi' : 'Posting sekarang'}</button>` : ''}
      ${p.status === 'scheduled' ? '<button class="btn ghost" id="soUnsch">Batalkan jadwal</button>' : ''}
      <button class="btn ghost" id="soDel" style="color:var(--err);margin-left:auto">Hapus</button>
    </div>
    ${p.status === 'published' && p.platforms.includes('instagram') ? '<div class="tsub" style="margin-top:8px">Menghapus di sini tidak menghapus posting di Instagram.</div>' : ''}`);
  $('#soEdit') && ($('#soEdit').onclick = () => openEditor(p));
  $('#soNow') && ($('#soNow').onclick = () => publishNow(p));
  $('#soUnsch') && ($('#soUnsch').onclick = async () => { await savePatch(p, {status:'draft'}); toast('Jadwal dibatalkan — kembali jadi draft'); openPost(p.id); });
  $('#soDel').onclick = async () => {
    if(!await confirmBox('Hapus posting ini?', 'Jadwal & data posting di web admin akan dihapus.')) return openPost(p.id);
    await api(`social_posts?id=eq.${p.id}`, {method:'DELETE'});
    P.list = P.list.filter(x => x.id !== p.id);
    await logAct('delete', 'Posting sosmed', KIND[p.kind], (p.caption || '').slice(0, 60));
    closeDrawer(); toast('Posting dihapus'); RENDER.sosmed();
  };
  $('#soCopy') && ($('#soCopy').onclick = async () => { try{ await navigator.clipboard.writeText(p.caption || ''); toast('Caption disalin'); }catch(_){ toast('Tidak bisa menyalin otomatis'); } });
  $('#soTtDone') && ($('#soTtDone').onclick = async () => {
    const igDone = !p.platforms.includes('instagram') || p.ig?.state === 'published';
    await savePatch(p, {tiktok:{...p.tiktok, state:'posted', posted_at:new Date().toISOString()}, ...(igDone ? {status:'published'} : {})});
    await logAct('update', 'Posting sosmed', 'TikTok', 'Ditandai sudah diposting');
    toast('TikTok ditandai sudah diposting'); openPost(p.id); RENDER.sosmed();
  });
}
async function savePatch(p, patch){
  const [row] = await api(`social_posts?id=eq.${p.id}`, {method:'PATCH', body:patch, prefer:'return=representation'});
  Object.assign(p, row);
}
async function publishNow(p){
  if(!P.ig?.connected){ toast('Hubungkan Instagram dulu'); return connectModal(); }
  const btn = $('#soNow'); if(btn){ btn.disabled = true; btn.textContent = 'Memposting…'; }
  try{
    const r = await callFn('social-publish', {action:'publish_now', id:p.id});
    await load();
    const st = r.result?.status;
    toast(st === 'failed' ? 'Gagal: ' + (r.result.ig?.error || 'cek detail') : st === 'publishing' ? 'Instagram sedang memproses media — otomatis terbit beberapa menit lagi' : 'Berhasil diposting');
    await logAct('update', 'Posting sosmed', KIND[p.kind], 'Posting sekarang ke Instagram');
  }catch(e){ toast('Gagal: ' + e.message); }
  RENDER.sosmed(); openPost(p.id);
}

/* ---------- editor ---------- */
function openEditor(post, day){
  const d = post ? JSON.parse(JSON.stringify(post)) : {kind:'photo', platforms:['instagram'], caption:'', media:[],
    scheduled_at: day ? new Date(`${day}T19:00:00`).toISOString() : null};
  P.draft = d;
  paintEditor();
}
function rules(d){
  const imgs = d.media.filter(m => m.type === 'image').length, vids = d.media.filter(m => m.type === 'video').length;
  const err = [];
  if(!d.platforms.length) err.push('Pilih minimal satu platform.');
  if(d.kind === 'photo' && !(imgs === 1 && vids === 0)) err.push('Foto: unggah tepat 1 foto.');
  if(d.kind === 'carousel' && !(d.media.length >= 2 && d.media.length <= 10)) err.push('Carousel: 2–10 foto/video.');
  if(d.kind === 'reel' && !(vids === 1 && imgs === 0)) err.push('Reels: unggah tepat 1 video.');
  if(d.caption.length > 2200) err.push('Caption maksimal 2.200 karakter.');
  if(hashtags(d.caption) > 30) err.push('Instagram maksimal 30 hashtag.');
  return err;
}
function paintEditor(){
  const d = P.draft, isNew = !d.id;
  const err = rules(d);
  const accept = d.kind === 'photo' ? 'image/*' : d.kind === 'reel' ? 'video/mp4,video/quicktime' : 'image/*,video/mp4,video/quicktime';
  const warn = d.media.filter(m => m.type === 'image' && m.w && m.h && (m.w / m.h < 0.8 || m.w / m.h > 1.91)).length;
  openDrawer(`
    <div class="dh"><div><h2>${isNew ? 'Buat posting' : 'Edit posting'}</h2><div class="tsub">Instagram otomatis · TikTok manual</div></div><button class="x" data-dclose>✕</button></div>
    <div class="fld"><label>Platform</label><div class="chips">
      ${['instagram', 'tiktok'].map(k => `<button type="button" class="chip ${d.platforms.includes(k) ? 'on' : ''}" data-plat="${k}">${k === 'instagram' ? 'Instagram' : 'TikTok'}</button>`).join('')}
    </div></div>
    <div class="fld"><label>Jenis konten</label><div class="chips">
      ${Object.entries(KIND).map(([k, l]) => `<button type="button" class="chip alt ${d.kind === k ? 'on' : ''}" data-kind="${k}">${l}</button>`).join('')}
    </div></div>
    <div class="fld"><label>Media ${d.kind === 'carousel' ? `(${d.media.length}/10)` : ''}</label>
      <div class="so-media edit">${d.media.map((m, i) => `<div class="so-mi">${thumb(m)}
        <div class="so-mi-a">${d.media.length > 1 ? `<button class="ibtn sm" data-mv="${i}:-1" ${i === 0 ? 'disabled' : ''}>‹</button><button class="ibtn sm" data-mv="${i}:1" ${i === d.media.length - 1 ? 'disabled' : ''}>›</button>` : ''}<button class="ibtn sm del" data-rm="${i}">✕</button></div></div>`).join('')}
        ${(d.kind === 'carousel' ? d.media.length < 10 : d.media.length < 1) ? `<label class="so-add"><input type="file" hidden id="soFile" accept="${accept}" ${d.kind === 'carousel' ? 'multiple' : ''}><span>+</span><small>${d.kind === 'reel' ? 'Video MP4/MOV' : d.kind === 'photo' ? 'Foto' : 'Foto / video'}</small></label>` : ''}
      </div>
      <div class="hint" id="soUpSt">${d.kind === 'reel' ? 'Video MP4/MOV maks 50 MB, vertikal 9:16 disarankan (durasi 3 detik – 15 menit).' : 'Foto otomatis dikonversi ke JPG. Rasio feed Instagram 4:5 sampai 1.91:1.'}</div>
      ${warn ? `<div class="hint" style="color:var(--warn-ink)">⚠ ${warn} foto di luar rasio 4:5–1.91:1 — Instagram bisa menolaknya. Crop dulu sebelum diunggah.</div>` : ''}
    </div>
    <div class="fld"><label>Caption</label>
      <textarea id="soCap" rows="7" placeholder="Tulis caption… #wedding #kalaatma">${esc(d.caption)}</textarea>
      <div class="hint" id="soCapInfo"></div></div>
    <div class="fld"><label>Jadwal posting</label>
      <input type="datetime-local" id="soAt" value="${localInput(d.scheduled_at)}" min="${localInput(new Date().toISOString())}">
      <div class="hint">Waktu sesuai jam perangkat Anda (WIB). Posting diproses paling lambat ±2 menit setelah jadwal.</div></div>
    ${err.length ? `<div class="banner" style="margin-top:6px">${err.map(esc).join('<br>')}</div>` : ''}
    <div class="so-acts" style="margin-top:16px">
      <button class="btn soft" id="soSaveDraft">Simpan draft</button>
      <button class="btn" id="soSchedule" ${err.length ? 'disabled' : ''}>Jadwalkan</button>
      ${d.platforms.includes('instagram') ? `<button class="btn line" id="soPostNow" ${err.length ? 'disabled' : ''}>Posting sekarang</button>` : ''}
    </div>`);
  const capInfo = () => { $('#soCapInfo').textContent = `${$('#soCap').value.length}/2200 karakter · ${hashtags($('#soCap').value)}/30 hashtag`; };
  capInfo();
  $('#soCap').oninput = () => { d.caption = $('#soCap').value; capInfo(); };
  $('#soCap').onchange = () => paintEditor();
  $('#soAt').onchange = () => { d.scheduled_at = $('#soAt').value ? new Date($('#soAt').value).toISOString() : null; };
  $$('[data-plat]').forEach(b => b.onclick = () => {
    const k = b.dataset.plat;
    d.platforms = d.platforms.includes(k) ? d.platforms.filter(x => x !== k) : [...d.platforms, k];
    paintEditor();
  });
  $$('[data-kind]').forEach(b => b.onclick = () => {
    d.kind = b.dataset.kind;
    if(d.kind === 'photo') d.media = d.media.filter(m => m.type === 'image').slice(0, 1);
    if(d.kind === 'reel') d.media = d.media.filter(m => m.type === 'video').slice(0, 1);
    paintEditor();
  });
  $$('[data-rm]').forEach(b => b.onclick = () => { d.media.splice(Number(b.dataset.rm), 1); paintEditor(); });
  $$('[data-mv]').forEach(b => b.onclick = () => {
    const [i, dir] = b.dataset.mv.split(':').map(Number);
    [d.media[i], d.media[i + dir]] = [d.media[i + dir], d.media[i]]; paintEditor();
  });
  $('#soFile') && ($('#soFile').onchange = e => upload([...e.target.files]));
  $('#soSaveDraft').onclick = () => save('draft');
  $('#soSchedule').onclick = () => save('scheduled');
  $('#soPostNow') && ($('#soPostNow').onclick = () => save('now'));
}

async function upload(files){
  const d = P.draft, st = $('#soUpSt');
  const room = d.kind === 'carousel' ? 10 - d.media.length : 1 - d.media.length;
  for(const file of files.slice(0, Math.max(0, room))){
    const isVid = file.type.startsWith('video/');
    try{
      let blob = file, type = file.type, ext = isVid ? (file.type === 'video/quicktime' ? 'mov' : 'mp4') : 'jpg', dims = {};
      if(isVid){
        if(!['video/mp4', 'video/quicktime'].includes(file.type)) throw new Error('Video harus MP4 atau MOV');
        if(file.size > 50 * 1024 * 1024) throw new Error('Video maksimal 50 MB');
      } else {
        st.textContent = `Memproses ${file.name}…`;
        ({blob, w:dims.w, h:dims.h} = await toJpeg(file)); type = 'image/jpeg';
      }
      st.textContent = `Mengunggah ${file.name} (${(blob.size / 1048576).toFixed(1)} MB)…`;
      const path = `${iso(new Date())}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
      const url = await storageUpload(BUCKET, path, blob, type);
      d.media.push({url, type: isVid ? 'video' : 'image', path, ...dims});
    }catch(e){ toast(`${file.name}: ${e.message}`); }
  }
  paintEditor();
}
/* foto → JPG (Instagram hanya menerima JPEG), sisi terpanjang 1440px */
function toJpeg(file, max = 1440){
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      cv.toBlob(b => b ? resolve({blob:b, w:cv.width, h:cv.height}) : reject(new Error('Foto tidak bisa diproses')), 'image/jpeg', 0.9);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('File bukan gambar yang didukung')); };
    img.src = url;
  });
}

async function save(mode){
  const d = P.draft;
  d.caption = $('#soCap').value;
  if(mode !== 'draft' && rules(d).length) return paintEditor();
  if(mode === 'scheduled'){
    if(!d.scheduled_at) return toast('Pilih tanggal & jam posting');
    if(new Date(d.scheduled_at) < new Date(Date.now() - 60000)) return toast('Jadwal sudah lewat — pilih waktu yang akan datang');
    if(d.platforms.includes('instagram') && !P.ig?.connected) toast('Catatan: Instagram belum terhubung, hubungkan sebelum jadwal tiba');
  }
  const body = {kind:d.kind, platforms:d.platforms, caption:d.caption, media:d.media,
    scheduled_at: mode === 'now' ? new Date().toISOString() : d.scheduled_at,
    status: mode === 'draft' ? 'draft' : 'scheduled', ig:{}, tiktok:{}};
  try{
    let row;
    if(d.id) [row] = await api(`social_posts?id=eq.${d.id}`, {method:'PATCH', body, prefer:'return=representation'});
    else [row] = await api('social_posts', {method:'POST', body, prefer:'return=representation'});
    const i = P.list.findIndex(x => x.id === row.id);
    i >= 0 ? (P.list[i] = row) : P.list.push(row);
    await logAct(d.id ? 'update' : 'create', 'Posting sosmed', KIND[row.kind],
      mode === 'draft' ? 'Disimpan sebagai draft' : `Dijadwalkan ${fmtDT(row.scheduled_at)}`);
    if(mode === 'now'){ RENDER.sosmed(); openPost(row.id); return publishNow(row); }
    closeDrawer();
    toast(mode === 'draft' ? 'Draft tersimpan' : `Terjadwal ${fmtDT(row.scheduled_at)}`);
    if(row.scheduled_at) P.month = new Date(row.scheduled_at);
    RENDER.sosmed();
  }catch(e){ toast('Gagal menyimpan: ' + e.message); }
}

/* ---------- koneksi Instagram ---------- */
function connectModal(){
  openModal(`<h3>Hubungkan Instagram</h3>
    <p style="text-align:left">Posting otomatis memakai Instagram Graph API resmi. Siapkan sekali saja:</p>
    <ol class="so-steps">
      <li>Buka <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">developers.facebook.com/apps</a> → <b>Create app</b> → pilih use case <b>"Manage messaging & content on Instagram"</b> / Instagram API.</li>
      <li>Di menu Instagram API, pilih login dengan <b>Facebook Login</b> (akun IG Business yang terhubung ke Facebook Page Kalaatma).</li>
      <li>Buka <b>Graph API Explorer</b>, pilih app tadi, beri izin <code>instagram_basic</code>, <code>instagram_content_publish</code>, <code>pages_show_list</code>, <code>pages_read_engagement</code>, lalu <b>Generate Access Token</b>.</li>
      <li>Tukar jadi <b>token jangka panjang (60 hari)</b> lewat Access Token Debugger → "Extend Access Token". Token Page dari <code>/me/accounts</code> bisa tidak kedaluwarsa.</li>
      <li>Cari <b>Instagram Business Account ID</b>: di Explorer jalankan <code>me/accounts?fields=instagram_business_account</code>.</li>
    </ol>
    <div class="fld"><label>Instagram Business Account ID</label><input id="igAcc" placeholder="contoh: 17841400000000000" inputmode="numeric"></div>
    <div class="fld"><label>Access token</label><textarea id="igTok" rows="3" placeholder="EAAG…"></textarea>
      <div class="hint">Token disimpan aman di server & tidak bisa dilihat lagi dari browser.</div></div>
    <div class="acts"><button class="btn soft" data-mclose>Batal</button><button class="btn" id="igSave">Simpan & cek</button></div>`);
  $('#igSave').onclick = async () => {
    const acc = $('#igAcc').value.trim(), tok = $('#igTok').value.trim();
    if(!/^\d{5,}$/.test(acc)) return toast('Account ID berupa angka');
    if(tok.length < 20) return toast('Token tidak valid');
    $('#igSave').disabled = true; $('#igSave').textContent = 'Mengecek…';
    try{
      await api('rpc/save_social_credentials', {method:'POST', body:{p_platform:'instagram', p_account_id:acc, p_token:tok}});
      await loadIg();
      await logAct('update', 'Koneksi sosmed', 'Instagram', P.ig?.connected ? `Terhubung @${P.ig.username}` : 'Token disimpan');
      closeModal();
      toast(P.ig?.connected ? `Terhubung sebagai @${P.ig.username}` : 'Token tersimpan, tapi Instagram menolak: ' + (P.ig?.error || 'cek token & ID'));
    }catch(e){ toast('Gagal: ' + e.message); $('#igSave').disabled = false; $('#igSave').textContent = 'Simpan & cek'; }
  };
}
