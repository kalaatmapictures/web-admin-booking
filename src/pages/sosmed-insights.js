/* =====================================================================
   SOSMED → ANALISA — performa akun & konten Instagram.
   Data dari Edge Function `social-publish` {action:'insights'} (Instagram
   Insights API, di-cache 30 menit di server). Grafik SVG sederhana:
   satu hue (var(--primary)), garis 2px + wash 10%, batang ≤24px ujung
   membulat 4px, tooltip saat hover; tabel posting = tampilan tabel data.
   ===================================================================== */
import { $, $$, esc, toast, callFn } from '../core.js';

const A = { days:30, data:null, loading:false, error:null, sort:'interactions', dir:-1 };
const TYPE = { reel:'Reels', carousel:'Carousel', photo:'Foto', video:'Video' };
const DOW = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
const DOW_FULL = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];

const nf = n => n == null ? '—' : Number(n).toLocaleString('id-ID');
const compact = n => n == null ? '—' : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + 'jt'
  : Math.abs(n) >= 1e4 ? (n / 1e3).toFixed(1).replace('.', ',') + 'rb' : nf(Math.round(n));
const pct = v => v == null ? '—' : (v * 100).toFixed(1).replace('.', ',') + '%';
const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const niceMax = v => { if(v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)), m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };

/* ---------- data ---------- */
async function load(refresh = false){
  A.loading = true; A.error = null; paint();
  try{ A.data = await callFn('social-publish', {action:'insights', days:A.days, refresh}); }
  catch(e){ A.error = e.message; }
  A.loading = false; paint();
}

let host = null, onConnect = null;
export function renderInsights(el, connectFn){
  host = el; onConnect = connectFn;
  if(!A.data && !A.loading && !A.error) load(); else paint();
}

/* ---------- tooltip bersama ---------- */
function tip(){
  let t = $('#vzTip');
  if(!t){ t = document.createElement('div'); t.id = 'vzTip'; t.className = 'vz-tip'; t.setAttribute('role', 'tooltip'); document.body.appendChild(t); }
  return t;
}
function showTip(x, y, rows){
  const t = tip(); t.replaceChildren();
  rows.forEach(([v, l]) => { const d = document.createElement('div'); const b = document.createElement('b'); b.textContent = v; d.append(b, document.createTextNode(' ' + l)); t.appendChild(d); });
  t.style.display = 'block';
  const w = t.offsetWidth, h = t.offsetHeight;
  t.style.left = Math.min(innerWidth - w - 8, Math.max(8, x + 14)) + 'px';
  t.style.top = Math.max(8, y - h - 12) + 'px';
}
const hideTip = () => { const t = $('#vzTip'); if(t) t.style.display = 'none'; };

/* ---------- tampilan ---------- */
function paint(){
  if(!host || !host.isConnected) return;
  const d = A.data;
  const head = `<div class="vz-bar">
      <div class="chips">${[7, 30, 90].map(n => `<button class="chip ${A.days === n ? 'on' : ''}" data-days="${n}">${n} hari</button>`).join('')}</div>
      <span class="tsub vz-upd">${A.loading ? 'Mengambil data dari Instagram…' : d ? `Diperbarui ${new Date(d.fetched_at).toLocaleString('id-ID', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'})}` : ''}</span>
      <button class="btn soft sm" id="vzRefresh" ${A.loading ? 'disabled' : ''}>↻ Perbarui</button>
    </div>`;

  if(A.error){
    const notConn = /belum terhubung/i.test(A.error);
    host.innerHTML = head + `<div class="card vz-empty">
      <b>${notConn ? 'Hubungkan Instagram untuk melihat analisa' : 'Gagal mengambil data Instagram'}</b>
      <span class="tsub">${esc(notConn ? 'Analisa memakai data Instagram Insights dari akun Business/Creator Anda.' : A.error)}</span>
      ${notConn ? '<button class="btn sm" id="vzConnect">Hubungkan Instagram</button>' : ''}</div>`;
    bindHead(); $('#vzConnect') && ($('#vzConnect').onclick = () => onConnect?.());
    return;
  }
  if(!d){ host.innerHTML = head + '<div class="card"><div class="tsub">Memuat analisa…</div></div>'; bindHead(); return; }

  const posts = d.posts || [];
  const T = d.totals || {};
  const folGain = (d.followerSeries || []).reduce((s, p) => s + p.value, 0);
  const erList = posts.map(p => p.er).filter(v => v != null);
  const interTotal = T.total_interactions ?? posts.reduce((s, p) => s + (p.interactions || 0), 0);

  // agregasi per jenis & per hari posting
  const byType = Object.entries(posts.reduce((a, p) => ((a[p.type] ||= []).push(p.interactions || 0), a), {}))
    .map(([k, v]) => ({k, label:TYPE[k] || k, value:avg(v), n:v.length})).sort((a, b) => b.value - a.value);
  const byDow = DOW.map((l, i) => { const v = posts.filter(p => new Date(p.timestamp).getDay() === i).map(p => p.interactions || 0); return {label:l, full:DOW_FULL[i], value:avg(v), n:v.length}; });
  const order = [1, 2, 3, 4, 5, 6, 0].map(i => byDow[i]);
  const byHour = [0, 3, 6, 9, 12, 15, 18, 21].map(h => { const v = posts.filter(p => { const x = new Date(p.timestamp).getHours(); return x >= h && x < h + 3; }).map(p => p.interactions || 0); return {h, value:avg(v), n:v.length}; });
  const bestType = byType[0], bestDay = [...order].filter(x => x.n).sort((a, b) => b.value - a.value)[0], bestHour = byHour.filter(x => x.n).sort((a, b) => b.value - a.value)[0];

  const sorted = [...posts].sort((a, b) => {
    const k = A.sort, va = k === 'timestamp' ? new Date(a[k]).getTime() : (a[k] ?? -1), vb = k === 'timestamp' ? new Date(b[k]).getTime() : (b[k] ?? -1);
    return (va - vb) * A.dir;
  });
  const th = (k, l, r = true) => `<th class="${r ? 'r' : ''}"><button class="vz-sort ${A.sort === k ? 'on' : ''}" data-sort="${k}">${l}${A.sort === k ? (A.dir < 0 ? ' ↓' : ' ↑') : ''}</button></th>`;

  host.innerHTML = head + `
    <div class="card vz-prof">
      ${d.profile.picture ? `<img src="${esc(d.profile.picture)}" alt="">` : '<span class="so-plat instagram lg"></span>'}
      <div><b>@${esc(d.profile.username)}</b><span class="tsub">${nf(d.profile.followers)} followers · ${nf(d.profile.follows)} following · ${nf(d.profile.media)} posting</span></div>
    </div>

    <div class="vz-kpis">
      ${kpi('Followers', compact(d.profile.followers), d.followerSeries?.length ? `${folGain >= 0 ? '+' : ''}${nf(folGain)} dalam ${d.days} hari` : '', folGain)}
      ${kpi('Jangkauan (akun unik)', compact(T.reach), `${d.days} hari terakhir`)}
      ${kpi('Tayangan', compact(T.views), 'views konten')}
      ${kpi('Interaksi', compact(interTotal), 'suka, komentar, simpan, bagikan')}
      ${kpi('Engagement rate', pct(erList.length ? avg(erList) : null), 'rata-rata interaksi ÷ jangkauan per posting')}
      ${kpi('Posting', nf(posts.length), `dalam ${d.days} hari`)}
    </div>

    ${posts.length ? `<div class="card vz-insight">
      <b>Ringkasan</b>
      <ul>
        ${bestType ? `<li>Format paling efektif: <b>${esc(bestType.label)}</b> — rata-rata ${nf(Math.round(bestType.value))} interaksi per posting${byType[1] ? ` (${(bestType.value / Math.max(1, byType[1].value)).toFixed(1).replace('.', ',')}× ${esc(byType[1].label)})` : ''}.</li>` : ''}
        ${bestDay ? `<li>Hari posting terbaik: <b>${bestDay.full}</b> (rata-rata ${nf(Math.round(bestDay.value))} interaksi).</li>` : ''}
        ${bestHour ? `<li>Jam posting terbaik: <b>${String(bestHour.h).padStart(2, '0')}.00–${String(bestHour.h + 3).padStart(2, '0')}.00</b>.</li>` : ''}
      </ul></div>` : ''}

    <div class="sec-h"><h3>Jangkauan harian</h3><span class="tsub">akun unik yang melihat konten Anda per hari</span></div>
    <div class="card"><div class="vz-chart" id="vzLine"></div></div>

    <div class="vz-two">
      <div><div class="sec-h"><h3>Interaksi per jenis konten</h3><span class="tsub">rata-rata per posting</span></div>
        <div class="card"><div class="vz-chart" id="vzType"></div></div></div>
      <div><div class="sec-h"><h3>Interaksi per hari posting</h3><span class="tsub">rata-rata per posting</span></div>
        <div class="card"><div class="vz-chart" id="vzDow"></div></div></div>
    </div>

    <div class="sec-h"><h3>Performa per posting (${posts.length})</h3><span class="tsub">klik judul kolom untuk mengurutkan</span></div>
    <div class="card"><div class="tablewrap"><table class="vz-table">
      <thead><tr><th>Konten</th>${th('timestamp', 'Tanggal')}${th('reach', 'Jangkauan')}${th('views', 'Tayangan')}${th('likes', 'Suka')}${th('comments', 'Komentar')}${th('saves', 'Simpan')}${th('shares', 'Bagikan')}${th('interactions', 'Interaksi')}${th('er', 'ER')}</tr></thead>
      <tbody>${sorted.map(p => `<tr>
        <td><a class="vz-post" href="${esc(p.permalink)}" target="_blank" rel="noopener">
          <span class="so-th">${p.thumb ? `<img src="${esc(p.thumb)}" alt="" loading="lazy">` : ''}</span>
          <span><b>${esc(TYPE[p.type] || p.type)}</b><span class="tsub">${esc((p.caption || '(tanpa caption)').slice(0, 70))}</span></span></a></td>
        <td class="r num">${new Date(p.timestamp).toLocaleDateString('id-ID', {day:'numeric', month:'short'})}</td>
        <td class="r num">${nf(p.reach)}</td><td class="r num">${nf(p.views)}</td><td class="r num">${nf(p.likes)}</td><td class="r num">${nf(p.comments)}</td>
        <td class="r num">${nf(p.saves)}</td><td class="r num">${nf(p.shares)}</td><td class="r num"><b>${nf(p.interactions)}</b></td><td class="r num">${pct(p.er)}</td>
      </tr>`).join('') || '<tr><td colspan="10"><div class="jb-empty">Belum ada posting dalam periode ini.</div></td></tr>'}</tbody>
    </table></div></div>`;

  bindHead();
  $$('[data-sort]').forEach(b => b.onclick = () => { const k = b.dataset.sort; A.dir = A.sort === k ? -A.dir : -1; A.sort = k; paint(); });
  lineChart($('#vzLine'), d.reachSeries || []);
  barChart($('#vzType'), byType, true);
  barChart($('#vzDow'), order, false);
}
function bindHead(){
  $$('[data-days]').forEach(b => b.onclick = () => { const n = Number(b.dataset.days); if(n === A.days) return; A.days = n; A.data = null; load(); });
  $('#vzRefresh') && ($('#vzRefresh').onclick = () => load(true));
}
const kpi = (label, value, sub, delta) => `<div class="card vz-kpi"><span class="lbl">${label}</span><b class="val">${value}</b>
  ${sub ? `<span class="cap ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${delta > 0 ? '▲ ' : delta < 0 ? '▼ ' : ''}${esc(sub)}</span>` : ''}</div>`;

/* ---------- grafik garis (jangkauan harian) ---------- */
function lineChart(el, pts){
  if(!el) return;
  if(pts.length < 2){ el.innerHTML = '<div class="jb-empty">Data harian belum tersedia untuk periode ini.</div>'; return; }
  const W = Math.max(280, el.clientWidth), H = 220, L = 46, R = 16, T = 14, B = 26;
  const max = niceMax(Math.max(...pts.map(p => p.value)));
  const x = i => L + (W - L - R) * i / (pts.length - 1), y = v => T + (H - T - B) * (1 - v / max);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const area = `${line}L${x(pts.length - 1).toFixed(1)},${H - B}L${L},${H - B}Z`;
  const ticks = [0, .25, .5, .75, 1].map(f => f * max);
  const step = Math.ceil(pts.length / Math.max(2, Math.floor((W - L - R) / 70)));
  const lab = d => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', {day:'numeric', month:'short'});
  const last = pts[pts.length - 1];
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Grafik jangkauan harian">
    ${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="vz-grid"/><text x="${L - 8}" y="${y(t) + 4}" class="vz-ax" text-anchor="end">${compact(t)}</text>`).join('')}
    ${pts.map((p, i) => i % step === 0 ? `<text x="${x(i)}" y="${H - 6}" class="vz-ax" text-anchor="middle">${lab(p.date)}</text>` : '').join('')}
    <path d="${area}" class="vz-area"/><path d="${line}" class="vz-line"/>
    <circle cx="${x(pts.length - 1)}" cy="${y(last.value)}" r="4.5" class="vz-dot"/>
    <text x="${Math.min(W - R, x(pts.length - 1))}" y="${y(last.value) - 10}" class="vz-val" text-anchor="end">${compact(last.value)}</text>
    <line class="vz-cross" x1="0" x2="0" y1="${T}" y2="${H - B}" style="display:none"/>
    <circle class="vz-dot vz-hov" r="4.5" style="display:none"/>
    <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" class="vz-hit"/>
  </svg>`;
  const svg = el.querySelector('svg'), cross = svg.querySelector('.vz-cross'), hov = svg.querySelector('.vz-hov');
  const move = e => {
    const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * W / r.width;
    const i = Math.max(0, Math.min(pts.length - 1, Math.round((px - L) / (W - L - R) * (pts.length - 1))));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.style.display = '';
    hov.setAttribute('cx', x(i)); hov.setAttribute('cy', y(pts[i].value)); hov.style.display = '';
    showTip(e.clientX, e.clientY, [[nf(pts[i].value), 'akun dijangkau'], [new Date(pts[i].date + 'T00:00:00').toLocaleDateString('id-ID', {weekday:'long', day:'numeric', month:'long'}), '']]);
  };
  const leave = () => { cross.style.display = 'none'; hov.style.display = 'none'; hideTip(); };
  svg.querySelector('.vz-hit').addEventListener('pointermove', move);
  svg.querySelector('.vz-hit').addEventListener('pointerleave', leave);
}

/* ---------- grafik batang (horizontal = jenis, kolom = hari) ---------- */
function barChart(el, rows, horizontal){
  if(!el) return;
  if(!rows.some(r => r.n)){ el.innerHTML = '<div class="jb-empty">Belum ada posting dalam periode ini.</div>'; return; }
  const W = Math.max(260, el.clientWidth);
  const max = niceMax(Math.max(...rows.map(r => r.value)));
  const r4 = 4, bw = 22;
  let svg;
  if(horizontal){
    const L = 84, R = 56, rowH = 40, H = rows.length * rowH + 8;
    const w = v => (W - L - R) * v / max;
    svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Interaksi per jenis konten">
      ${rows.map((r, i) => { const yy = 4 + i * rowH + (rowH - bw) / 2, ww = Math.max(0, w(r.value));
        return `<text x="${L - 10}" y="${yy + bw / 2 + 4}" class="vz-ax lg" text-anchor="end">${esc(r.label)}</text>
        <path d="${ww > r4 ? `M${L},${yy}h${ww - r4}a${r4},${r4} 0 0 1 ${r4},${r4}v${bw - 2 * r4}a${r4},${r4} 0 0 1 -${r4},${r4}h-${ww - r4}z` : `M${L},${yy}h${ww}v${bw}h-${ww}z`}" class="vz-bar" data-i="${i}"/>
        <text x="${L + ww + 8}" y="${yy + bw / 2 + 4}" class="vz-val">${compact(r.value)}</text>`; }).join('')}
    </svg>`;
  } else {
    const L = 8, R = 8, T = 22, B = 26, H = 200, slot = (W - L - R) / rows.length;
    const h = v => (H - T - B) * v / max;
    const best = Math.max(...rows.map(r => r.value));
    svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Interaksi per hari posting">
      <line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="vz-grid"/>
      ${rows.map((r, i) => { const cx = L + slot * i + slot / 2, hh = Math.max(0, h(r.value)), x0 = cx - bw / 2, y0 = H - B - hh;
        return `${hh > r4 ? `<path d="M${x0},${H - B}v-${hh - r4}a${r4},${r4} 0 0 1 ${r4},-${r4}h${bw - 2 * r4}a${r4},${r4} 0 0 1 ${r4},${r4}v${hh - r4}z" class="vz-bar ${r.value === best && r.n ? '' : 'mute'}" data-i="${i}"/>` : ''}
        ${r.n && r.value === best ? `<text x="${cx}" y="${y0 - 7}" class="vz-val" text-anchor="middle">${compact(r.value)}</text>` : ''}
        <text x="${cx}" y="${H - 8}" class="vz-ax lg" text-anchor="middle">${r.label}</text>
        <rect x="${cx - slot / 2}" y="${T}" width="${slot}" height="${H - T - B}" fill="transparent" data-hit="${i}"/>`; }).join('')}
    </svg>`;
  }
  el.innerHTML = svg;
  el.querySelectorAll('[data-i],[data-hit]').forEach(m => {
    const r = rows[Number(m.dataset.i ?? m.dataset.hit)];
    m.addEventListener('pointermove', e => showTip(e.clientX, e.clientY, [[compact(r.value), 'interaksi rata-rata'], [`${r.label} · ${r.n} posting`, '']]));
    m.addEventListener('pointerleave', hideTip);
  });
}

/* gambar ulang grafik saat lebar layar berubah */
let rz;
addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if(host?.isConnected && A.data) paint(); }, 200); });
