/* =====================================================================
   KEUANGAN → LAPORAN — dashboard laporan keuangan bisnis.
   Dihitung langsung dari transaksi kas di aplikasi (selalu terbaru):
   • Laba rugi: pendapatan project − biaya langsung = laba kotor;
     + pemasukan lain − biaya operasional umum = laba operasional;
     − bagi hasil owner − non-operasional = arus kas bersih.
   • Pendapatan & laba per jenis layanan, arus kas bulanan, rekap per
     project, biaya operasional umum per kategori.
   Pengelompokan: transaksi bertaut booking → project = nama client,
   jenis = layanan booking; selain itu memakai kolom project / jenis
   yang diisi di form transaksi; tanpa project = "Operasional Umum".
   Warna: 2 seri (pemasukan = indigo, pengeluaran = oranye), divalidasi
   CVD & kontras di mode terang/gelap.
   ===================================================================== */
import { $, $$, S, rp as rp0, esc, inRange } from '../core.js';
const rp = n => n < 0 ? '−' + rp0(-n) : rp0(n);
import { calLabel, dateButton, bindDateButton, MON_FULL, dISO } from '../datepicker.js';

export const UMUM = 'Operasional Umum';
export const JENIS_LIST = ['Wedding', 'Prewedding', 'Engagement', 'Graduation', 'Family', 'Maternity', 'Bundling', 'Lainnya', UMUM];
export const KATEGORI_KELUAR = ['Fee Crew', 'Editing', 'Produksi', 'Transport & Konsumsi', 'Sewa Alat', 'Iklan & Marketing',
  'Langganan Software & Cloud', 'Peralatan & Aset', 'Properti', 'Operasional Kendaraan', 'Anjangsana & Konsumsi Crew',
  'Admin Bank', 'Ongkir & Lain-lain', 'Fee Owner', 'Gaji Owner', 'Non-Operasional'];
const OWNER = /owner|prive/i, NONOP = /non[- ]?operasional/i;

const R = {from:null, to:null, monthLabel:null, preset:'year', init:false, projSort:'laba', projQ:''};
const MON = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
const pct = (a, b) => b ? (a / b * 100).toFixed(1).replace('.', ',') + '%' : '—';
const compact = n => { const a = Math.abs(n); return (n < 0 ? '−' : '') + (a >= 1e9 ? (a / 1e9).toFixed(1).replace('.', ',') + 'M' : a >= 1e6 ? (a / 1e6).toFixed(1).replace('.', ',') + 'jt' : a >= 1e3 ? Math.round(a / 1e3) + 'rb' : String(a)); };
const niceMax = v => { if(v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)), m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };

/* label tiap transaksi: project, jenis, kategori */
export function classify(t){
  const b = t.booking_id ? S.data.bookings.find(x => x.id === t.booking_id) : null;
  const project = b ? b.client_display : (t.project || '').trim() || UMUM;
  const jenis = b ? b.service : (t.service || (project === UMUM ? UMUM : 'Lainnya'));
  const cat = (t.category || '').trim() || (t.kind === 'IN' ? 'Pemasukan' : 'Lain-lain');
  return {...t, project: jenis === UMUM ? UMUM : project, jenis, cat};
}

function setPreset(p){
  const d = new Date(), y = d.getFullYear(), m = d.getMonth();
  R.preset = p; R.monthLabel = null;
  if(p === 'month'){ R.from = dISO(new Date(y, m, 1)); R.to = dISO(new Date(y, m + 1, 0)); R.monthLabel = MON_FULL[m] + ' ' + y; }
  else if(p === 'last'){ R.from = dISO(new Date(y, m - 1, 1)); R.to = dISO(new Date(y, m, 0)); R.monthLabel = MON_FULL[(m + 11) % 12] + ' ' + (m ? y : y - 1); }
  else if(p === 'year'){ R.from = `${y}-01-01`; R.to = `${y}-12-31`; R.monthLabel = 'Tahun ' + y; }
  else if(p === '12m'){ R.from = dISO(new Date(y, m - 11, 1)); R.to = dISO(new Date(y, m + 1, 0)); R.monthLabel = '12 bulan terakhir'; }
  else { R.from = R.to = null; }
}

export function renderReport(host, rerender){
  if(!R.init){ R.init = true; setPreset('year'); }
  const all = S.data.transactions.map(classify);
  const rows = all.filter(t => inRange(t.occurred_on, {from:R.from, to:R.to}));
  const label = R.from || R.to ? calLabel(R.from, R.to, R.monthLabel) : 'Semua waktu';

  /* ---------- laba rugi ---------- */
  const sum = (f, k) => rows.filter(f).reduce((n, t) => n + (t.kind === k ? t.amount : 0), 0);
  const isProj = t => t.project !== UMUM;
  const pend = sum(isProj, 'IN');
  const lainIn = sum(t => !isProj(t), 'IN');
  const byCat = f => Object.entries(rows.filter(t => t.kind === 'OUT' && f(t)).reduce((a, t) => (a[t.cat] = (a[t.cat] || 0) + t.amount, a), {})).sort((a, b) => b[1] - a[1]);
  const langsung = byCat(t => isProj(t) && !OWNER.test(t.cat) && !NONOP.test(t.cat));
  const umum = byCat(t => !isProj(t) && !OWNER.test(t.cat) && !NONOP.test(t.cat));
  const owner = byCat(t => OWNER.test(t.cat));
  const nonop = byCat(t => NONOP.test(t.cat));
  const tot = a => a.reduce((n, x) => n + x[1], 0);
  const bL = tot(langsung), bU = tot(umum), bO = tot(owner), bN = tot(nonop);
  const labaKotor = pend - bL, labaOps = labaKotor + lainIn - bU, net = labaOps - bO - bN;
  const masuk = pend + lainIn, keluar = bL + bU + bO + bN;

  /* ---------- per jenis ---------- */
  const jenisMap = {};
  rows.filter(isProj).forEach(t => { const j = jenisMap[t.jenis] ||= {jenis:t.jenis, in:0, out:0, projects:new Set()}; t.kind === 'IN' ? j.in += t.amount : j.out += t.amount; j.projects.add(t.project); });
  const perJenis = Object.values(jenisMap).map(j => ({...j, laba:j.in - j.out, n:j.projects.size})).sort((a, b) => b.in - a.in);

  /* ---------- bulanan ---------- */
  const mon = {};
  rows.forEach(t => { const k = t.occurred_on.slice(0, 7); const m = mon[k] ||= {k, in:0, out:0}; t.kind === 'IN' ? m.in += t.amount : m.out += t.amount; });
  const bulanan = Object.values(mon).sort((a, b) => a.k.localeCompare(b.k));
  let run = 0; bulanan.forEach(m => { m.net = m.in - m.out; run += m.net; m.saldo = run; });

  /* ---------- per project ---------- */
  const pj = {};
  rows.filter(isProj).forEach(t => { const p = pj[t.project] ||= {project:t.project, jenis:t.jenis, in:0, out:0, first:t.occurred_on}; t.kind === 'IN' ? p.in += t.amount : p.out += t.amount; if(t.occurred_on < p.first) p.first = t.occurred_on; });
  let projects = Object.values(pj).map(p => ({...p, laba:p.in - p.out, margin:p.in ? (p.in - p.out) / p.in : null}));
  if(R.projQ) projects = projects.filter(p => (p.project + ' ' + p.jenis).toLowerCase().includes(R.projQ.toLowerCase()));
  const sorts = {laba:(a, b) => b.laba - a.laba, in:(a, b) => b.in - a.in, margin:(a, b) => (b.margin ?? -9) - (a.margin ?? -9), tgl:(a, b) => b.first.localeCompare(a.first)};
  projects.sort(sorts[R.projSort]);
  const rugi = projects.filter(p => p.laba < 0 && p.in > 0).length;

  const line = (l, v, cls = '', sub = '') => `<div class="lr-row ${cls}"><span>${l}${sub ? `<small>${sub}</small>` : ''}</span><b class="num">${v < 0 ? '(' + rp(-v) + ')' : rp(v)}</b></div>`;
  host.innerHTML = `
    <div class="jb-bar">
      <div class="chips">${[['month', 'Bulan ini'], ['last', 'Bulan lalu'], ['12m', '12 bulan'], ['year', 'Tahun ini'], ['all', 'Semua']].map(([k, l]) =>
        `<button class="chip ${R.preset === k ? 'on' : ''}" data-rp="${k}">${l}</button>`).join('')}</div>
      <div class="chips" style="margin-left:auto">${dateButton('repDate', R)}</div>
    </div>

    <div class="grid g4 rp-kpis">
      <div class="card kpi accent"><div class="lbl">Arus kas bersih</div><div class="val">${rp(net)}</div><div class="cap">${esc(label)} · masuk − keluar</div></div>
      <div class="card kpi"><div class="lbl">Pendapatan project</div><div class="val">${rp(pend)}</div><div class="cap">${projects.length} project${lainIn ? ` · lain-lain ${rp(lainIn)}` : ''}</div></div>
      <div class="card kpi"><div class="lbl">Laba kotor</div><div class="val">${rp(labaKotor)}</div><div class="cap">margin ${pct(labaKotor, pend)} setelah biaya langsung</div></div>
      <div class="card kpi"><div class="lbl">Laba operasional</div><div class="val">${rp(labaOps)}</div><div class="cap">margin ${pct(labaOps, masuk)} setelah biaya umum</div></div>
    </div>

    <div class="rp-two">
      <div>
        <div class="sec-h"><h3>Laporan laba rugi</h3><span class="tsub">${esc(label)}</span></div>
        <div class="card lr">
          ${line('Pendapatan project', pend, 'h')}
          <div class="lr-g">Biaya langsung project</div>
          ${langsung.map(([k, v]) => line(k, -v, 'i')).join('') || '<div class="lr-row i"><span class="tsub">Tidak ada</span><b></b></div>'}
          ${line('Laba kotor', labaKotor, 't', pct(labaKotor, pend) + ' dari pendapatan')}
          ${lainIn ? line('Pemasukan lain', lainIn, '') : ''}
          <div class="lr-g">Biaya operasional umum</div>
          ${umum.map(([k, v]) => line(k, -v, 'i')).join('') || '<div class="lr-row i"><span class="tsub">Tidak ada</span><b></b></div>'}
          ${line('Laba operasional', labaOps, 't')}
          ${owner.map(([k, v]) => line(k, -v, 'i')).join('')}
          ${nonop.map(([k, v]) => line(k, -v, 'i')).join('')}
          ${line('Arus kas bersih', net, 'g')}
        </div>
      </div>
      <div>
        <div class="sec-h"><h3>Pendapatan & laba per jenis layanan</h3></div>
        <div class="card"><div class="rp-legend"><span><i class="s1"></i>Pendapatan</span><span><i class="s3"></i>Laba</span></div><div class="rp-chart" id="rpJenis"></div></div>
        <div class="sec-h"><h3>Biaya operasional umum</h3><span class="tsub">${rp(bU)}</span></div>
        <div class="card"><div class="rp-chart" id="rpUmum"></div></div>
      </div>
    </div>

    <div class="sec-h"><h3>Arus kas bulanan</h3><span class="tsub">saldo akhir periode ${rp(run)}</span></div>
    <div class="card"><div class="rp-legend"><span><i class="s1"></i>Pemasukan</span><span><i class="s2"></i>Pengeluaran</span></div><div class="rp-chart" id="rpMonth"></div></div>

    <div class="sec-h"><h3>Rekap per project</h3><span class="tsub">${projects.length} project${rugi ? ` · <span style="color:var(--err)">${rugi} rugi</span>` : ''}</span>
      <div class="right rp-ptools">
        <label class="searchbox"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="rpQ" type="search" placeholder="Cari project…" value="${esc(R.projQ)}"></label>
        <label class="selchip"><span>Urutkan</span><select id="rpSort">${[['laba', 'Laba terbesar'], ['in', 'Pendapatan'], ['margin', 'Margin'], ['tgl', 'Terbaru']].map(([k, l]) => `<option value="${k}" ${R.projSort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div></div>
    <div class="card"><div class="tablewrap"><table>
      <thead><tr><th>Project</th><th>Jenis</th><th class="r">Pemasukan</th><th class="r">Biaya</th><th class="r">Laba</th><th class="r">Margin</th></tr></thead>
      <tbody>${projects.map(p => `<tr><td class="tname">${esc(p.project)}</td><td>${esc(p.jenis)}</td>
        <td class="r num">${rp(p.in)}</td><td class="r num">${rp(p.out)}</td>
        <td class="r num" style="font-weight:600;color:${p.laba < 0 ? 'var(--err)' : 'var(--ink)'}">${rp(p.laba)}</td>
        <td class="r num">${p.margin == null ? '—' : pct(p.laba, p.in)}</td></tr>`).join('') || '<tr><td colspan="6"><div class="jb-empty">Belum ada transaksi project di periode ini.</div></td></tr>'}</tbody>
    </table></div></div>
    <div class="tsub" style="margin-top:10px">Transaksi dikelompokkan otomatis: yang ditautkan ke booking memakai nama client & layanan booking; transaksi lain memakai kolom <b>Project</b> dan <b>Jenis</b> di form transaksi. Kategori yang mengandung "Owner" dihitung sebagai bagi hasil owner, "Non-Operasional" di bawah laba operasional.</div>`;

  /* ---------- interaksi ---------- */
  $$('[data-rp]').forEach(b => b.onclick = () => { setPreset(b.dataset.rp); rerender(); });
  bindDateButton('repDate', R, () => { R.preset = R.from || R.to ? 'custom' : 'all'; rerender(); });
  $('#rpSort').onchange = e => { R.projSort = e.target.value; rerender(); };
  let tq; $('#rpQ').oninput = e => { clearTimeout(tq); tq = setTimeout(() => { R.projQ = e.target.value; rerender(); const i = $('#rpQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };

  barsH($('#rpJenis'), perJenis.map(j => ({label:j.jenis, a:j.in, b:j.laba, sub:`${j.n} project`})), ['Pendapatan', 'Laba'], ['s1', 's3']);
  barsH($('#rpUmum'), umum.map(([k, v]) => ({label:k, a:v})), ['Biaya'], ['s2']);
  monthChart($('#rpMonth'), bulanan);
}

/* ---------- tooltip ---------- */
function tip(x, y, lines){
  let t = $('#vzTip');
  if(!t){ t = document.createElement('div'); t.id = 'vzTip'; t.className = 'vz-tip'; document.body.appendChild(t); }
  t.replaceChildren(...lines.map(([v, l]) => { const d = document.createElement('div'); const b = document.createElement('b'); b.textContent = v; d.append(b, document.createTextNode(l ? ' ' + l : '')); return d; }));
  t.style.display = 'block';
  t.style.left = Math.min(innerWidth - t.offsetWidth - 8, x + 14) + 'px';
  t.style.top = Math.max(8, y - t.offsetHeight - 12) + 'px';
}
const untip = () => { const t = $('#vzTip'); if(t) t.style.display = 'none'; };
const roundR = (x, y, w, h, r) => w <= r ? `M${x},${y}h${Math.max(0, w)}v${h}h-${Math.max(0, w)}z`
  : `M${x},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 -${r},${r}h-${w - r}z`;

/* batang horizontal; 1 atau 2 seri per baris (seri kedua boleh negatif → digambar ke kiri dari 0) */
function barsH(el, rows, names, cls){
  if(!el) return;
  if(!rows.length){ el.innerHTML = '<div class="jb-empty">Belum ada data di periode ini.</div>'; return; }
  const W = Math.max(260, el.clientWidth), L = Math.min(170, W * .36), R = 64, bh = 12, gap = 2;
  const maxCh = Math.floor((L - 14) / 6.6);
  const per = names.length === 2 ? bh * 2 + gap : 16, rowH = per + 16, H = rows.length * rowH + 4;
  const vals = rows.flatMap(r => [r.a, r.b ?? 0]);
  const max = niceMax(Math.max(...vals, 0)), min = Math.min(0, ...vals);
  const span = max - (min < 0 ? -niceMax(-min) : 0), lo = min < 0 ? -niceMax(-min) : 0;
  const x = v => L + (W - L - R) * (v - lo) / span;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img">
    ${lo < 0 ? `<line x1="${x(0)}" x2="${x(0)}" y1="0" y2="${H}" class="vz-grid"/>` : ''}
    ${rows.map((r, i) => {
      const y0 = 4 + i * rowH + (rowH - per) / 2;
      const one = (v, j, h) => { const yy = y0 + j * (bh + gap); const a = x(Math.min(0, v)), w = Math.abs(x(v) - x(0));
        const d = v >= 0 ? roundR(a, yy, w, h, 4) : `M${a + w},${yy}h-${Math.max(0, w - 4)}a4,4 0 0 0 -4,4v${h - 8}a4,4 0 0 0 4,4h${Math.max(0, w - 4)}z`;
        return `<path d="${d}" class="rp-bar ${cls[j]}" data-i="${i}"/>`; };
      return `<text x="${L - 10}" y="${y0 + per / 2 + 4}" class="vz-ax lg" text-anchor="end">${esc(r.label.length > maxCh ? r.label.slice(0, maxCh - 1) + '…' : r.label)}</text>
        ${one(r.a, 0, names.length === 2 ? bh : 16)}${names.length === 2 ? one(r.b, 1, bh) : ''}
        <text x="${x(Math.max(0, r.a, r.b ?? 0)) + 6}" y="${y0 + per / 2 + 4}" class="vz-val">${compact(r.a)}</text>
        <rect x="0" y="${y0 - 6}" width="${W}" height="${per + 12}" fill="transparent" data-hit="${i}"/>`;
    }).join('')}
  </svg>`;
  el.querySelectorAll('[data-hit]').forEach(m => {
    const r = rows[Number(m.dataset.hit)];
    m.addEventListener('pointermove', e => tip(e.clientX, e.clientY, [[r.label, r.sub || ''], ...names.map((n, j) => [rp(j ? r.b : r.a), n])]));
    m.addEventListener('pointerleave', untip);
  });
}

/* kolom berpasangan per bulan (pemasukan vs pengeluaran) */
function monthChart(el, rows){
  if(!el) return;
  if(!rows.length){ el.innerHTML = '<div class="jb-empty">Belum ada transaksi di periode ini.</div>'; return; }
  const W = Math.max(300, el.clientWidth), H = 240, L = 48, R = 10, T = 18, B = 28;
  const max = niceMax(Math.max(...rows.flatMap(r => [r.in, r.out])));
  const slot = (W - L - R) / rows.length, bw = Math.min(22, Math.max(4, (slot - 10) / 2));
  const y = v => T + (H - T - B) * (1 - v / max);
  const ticks = [0, .25, .5, .75, 1].map(f => f * max);
  const every = Math.ceil(rows.length / Math.max(2, Math.floor((W - L - R) / 56)));
  const col = (cx, v, c, i) => { const h = H - B - y(v); return h > 0 ? `<path d="M${cx},${H - B}v-${Math.max(0, h - 4)}${h > 4 ? `a4,4 0 0 1 4,-4h${bw - 8}a4,4 0 0 1 4,4` : `h${bw}`}v${Math.max(0, h - 4)}z" class="rp-bar ${c}" data-i="${i}"/>` : ''; };
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Arus kas bulanan">
    ${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="vz-grid"/><text x="${L - 8}" y="${y(t) + 4}" class="vz-ax" text-anchor="end">${compact(t)}</text>`).join('')}
    ${rows.map((r, i) => { const cx = L + slot * i + slot / 2;
      return `${col(cx - bw - 1, r.in, 's1', i)}${col(cx + 1, r.out, 's2', i)}
        ${i % every === 0 ? `<text x="${cx}" y="${H - 9}" class="vz-ax" text-anchor="middle">${MON[+r.k.slice(5) - 1]}${r.k.slice(5) === '01' || i === 0 ? ' ' + r.k.slice(2, 4) : ''}</text>` : ''}
        <rect x="${cx - slot / 2}" y="${T}" width="${slot}" height="${H - T - B}" fill="transparent" data-hit="${i}"/>`; }).join('')}
  </svg>`;
  el.querySelectorAll('[data-hit]').forEach(m => {
    const r = rows[Number(m.dataset.hit)];
    m.addEventListener('pointermove', e => tip(e.clientX, e.clientY, [[`${MON_FULL[+r.k.slice(5) - 1]} ${r.k.slice(0, 4)}`, ''], [rp(r.in), 'pemasukan'], [rp(r.out), 'pengeluaran'], [rp(r.net), 'bersih'], [rp(r.saldo), 'saldo berjalan']]));
    m.addEventListener('pointerleave', untip);
  });
}
