/* META ADS — performa iklan dari Meta (ditarik Edge Function meta-ads-sync).
   Hanya menampilkan data; analisa dilakukan di luar BMS. */
import { $, $$, S, F, RENDER, rp, esc, iso, range, chipbar, customRange, empty, api, callFn, toast, fmtDate } from '../core.js';

const A = S.ads = { key:null, byAd:[], daily:[], runs:[], loading:false, error:null, syncing:false };

const PERIODS = [{v:'last7',l:'7 hari'},{v:'last14',l:'14 hari'},{v:'last30',l:'30 hari'},{v:'month',l:'Bulan ini'},{v:'lastmonth',l:'Bulan lalu'},{v:'custom',l:'Custom'}];
const RESULT = {messages:'chat', leads:'lead', link_clicks:'klik', reach:'reach'};
const n0 = v => Math.round(Number(v)||0).toLocaleString('id-ID');
const pct = v => isFinite(v) ? (v*100).toLocaleString('id-ID', {maximumFractionDigits:2}) + '%' : '—';
const div = (a, b) => b ? a / b : NaN;

function money(v, cur){
  if(!isFinite(v)) return '—';
  if(!cur || cur === 'IDR') return rp(v);
  return Number(v).toLocaleString('id-ID', {style:'currency', currency:cur, maximumFractionDigits:2});
}

function period(){
  const f = F.ads;
  const d = new Date(); d.setHours(0,0,0,0);
  const r = f.date === 'last14' ? {from: iso(new Date(d.getTime() - 13*864e5)), to: iso(d)} : range(f.date, f.custom);
  if(!r.from || !r.to) return null;
  // periode sebelumnya dengan panjang sama, untuk perbandingan
  const days = Math.round((new Date(r.to) - new Date(r.from)) / 864e5) + 1;
  const prevTo = new Date(r.from + 'T00:00:00'); prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - days + 1);
  return {...r, days, prevFrom: iso(prevFrom), prevTo: iso(prevTo)};
}

async function load(p){
  A.loading = true; A.error = null;
  try{
    const [byAd, daily, runs] = await Promise.all([
      api('rpc/meta_ads_by_ad', {method:'POST', body:{p_from:p.from, p_to:p.to}}),
      api('rpc/meta_ads_daily', {method:'POST', body:{p_from:p.prevFrom, p_to:p.to}}),
      api('meta_sync_runs?select=*&order=started_at.desc&limit=5')
    ]);
    Object.assign(A, {byAd, daily, runs, key: p.from + '|' + p.to});
  }catch(e){ A.error = e.message; A.key = p.from + '|' + p.to; }
  A.loading = false;
}

async function sync(days){
  A.syncing = true; RENDER.ads();
  try{
    const out = await callFn('meta-ads-sync', {days});
    if(!out.ok) throw new Error(out.error || 'Sync gagal');
    toast(`Sync selesai · ${out.rows} baris data`);
  }catch(e){
    toast('Sync gagal: ' + (e.message === 'Failed to fetch' ? 'Edge Function meta-ads-sync belum di-deploy' : e.message));
  }
  A.syncing = false; A.key = null; RENDER.ads();
}

/* ---------- agregasi ---------- */
function sumRows(rows){
  const t = {spend:0, impressions:0, reach:0, clicks:0, link_clicks:0, messages:0, leads:0, results:0, types:new Set()};
  for(const r of rows){
    t.spend += +r.spend||0; t.impressions += +r.impressions||0; t.reach += +r.reach_daily_sum||0;
    t.clicks += +r.clicks||0; t.link_clicks += +r.link_clicks||0; t.messages += +r.messages||0;
    t.leads += +r.leads||0; t.results += +r.results||0;
    if(r.result_type) t.types.add(r.result_type);
  }
  return t;
}
function groupRows(level){
  const key = {campaign:'campaign_id', adset:'adset_id', ad:'ad_id'}[level];
  const groups = new Map();
  for(const r of A.byAd){
    const k = r[key] || '—';
    if(!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.entries()].map(([id, rows]) => {
    const r0 = rows[0], t = sumRows(rows);
    const name = level === 'campaign' ? r0.campaign_name : level === 'adset' ? r0.adset_name : r0.ad_name;
    const sub = level === 'campaign' ? (r0.objective || '').replace('OUTCOME_', '') :
                level === 'adset' ? r0.campaign_name : `${r0.campaign_name} › ${r0.adset_name}`;
    const status = level === 'campaign' ? r0.campaign_status : level === 'adset' ? r0.adset_status : r0.status;
    const budget = level === 'campaign' ? r0.campaign_budget : level === 'adset' ? (r0.adset_budget ?? null) : null;
    // hasil hanya dijumlah bila jenisnya sama; campuran ditampilkan per jenis
    const types = [...t.types];
    return {id, name: name || '(tanpa nama)', sub, status, budget, thumb: level === 'ad' ? r0.thumbnail_url : null,
            ...t, types, mixed: types.length > 1, cpr: types.length === 1 ? div(t.spend, t.results) : NaN};
  });
}

function statusBadge(s){
  if(!s) return '<span class="badge b-grey">—</span>';
  if(s === 'ACTIVE') return '<span class="badge b-ok"><span class="d"></span>Aktif</span>';
  if(/PAUSED|ARCHIVED|DELETED/.test(s)) return '<span class="badge b-grey">Pause</span>';
  if(/REVIEW|PROCESS|PENDING/.test(s)) return '<span class="badge b-warn"><span class="d"></span>Review</span>';
  return `<span class="badge b-err"><span class="d"></span>${esc(s.replace(/_/g,' ').toLowerCase())}</span>`;
}
function resultCell(g){
  if(g.mixed) return [g.messages && `${n0(g.messages)} chat`, g.leads && `${n0(g.leads)} lead`, g.link_clicks && `${n0(g.link_clicks)} klik`].filter(Boolean).join(' · ') || '0';
  return `${n0(g.results)} <span class="tsub" style="display:inline">${RESULT[g.types[0]] || ''}</span>`;
}

/* perubahan vs periode sebelumnya; good = arah yang lebih baik */
function delta(cur, prev, good){
  if(!isFinite(cur) || !isFinite(prev) || !prev) return '<div class="cap">— vs periode sebelumnya</div>';
  const ch = (cur - prev) / prev;
  if(Math.abs(ch) < 0.005) return '<div class="cap">= periode sebelumnya</div>';
  const up = ch > 0;
  const txt = `${up ? '▲' : '▼'} ${Math.abs(ch*100).toLocaleString('id-ID',{maximumFractionDigits:0})}%`;
  if(good === 0) return `<div class="cap">${txt} vs periode sebelumnya</div>`;
  const tone = (up === (good > 0)) ? 'var(--ok)' : 'var(--err)';
  return `<div class="cap"><b style="color:${tone};font-weight:600">${txt}</b> vs periode sebelumnya</div>`;
}

/* ---------- grafik harian (satu seri, metrik dipilih) ---------- */
const METRICS = {
  spend:   {l:'Spend',          get:d => +d.spend,                  fmt:(v,c)=>money(v,c)},
  messages:{l:'Chat',           get:d => +d.messages,               fmt:n0},
  leads:   {l:'Leads',          get:d => +d.leads,                  fmt:n0},
  link_clicks:{l:'Klik link',   get:d => +d.link_clicks,            fmt:n0},
  cpchat:  {l:'Cost per chat',  get:d => div(+d.spend, +d.messages), fmt:(v,c)=>money(v,c)}
};
function chart(p, cur){
  const m = METRICS[F.ads.metric];
  const map = Object.fromEntries(A.daily.map(d => [d.date, d]));
  const days = [];
  for(let d = new Date(p.from + 'T00:00:00'); iso(d) <= p.to; d.setDate(d.getDate() + 1)) days.push(iso(d));
  const vals = days.map(k => map[k] ? m.get(map[k]) : (F.ads.metric === 'cpchat' ? NaN : 0));
  const max = Math.max(0, ...vals.filter(isFinite));
  if(!max) return `<div class="empty" style="padding:26px"><span>Belum ada data ${esc(m.l.toLowerCase())} pada periode ini.</span></div>`;
  const label = d => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', {day:'numeric', month:'short'});
  const ticks = days.length <= 8 ? days.map((_, i) => i) : [0, Math.floor((days.length - 1) / 2), days.length - 1];
  return `<div class="adchart">
    <div class="adchart-y"><span>${m.fmt(max, cur)}</span><span>0</span></div>
    <div class="adchart-plot">
      ${days.map((d, i) => `<div class="adbar" tabindex="0" data-tip="${esc(label(d))} · ${esc(m.l)}: ${esc(isFinite(vals[i]) ? m.fmt(vals[i], cur) : '—')}">
        <i style="height:${isFinite(vals[i]) ? Math.max(vals[i] / max * 100, vals[i] ? 1.5 : 0).toFixed(1) : 0}%"></i></div>`).join('')}
      <div class="adtip" id="adTip"></div>
    </div>
    <div></div>
    <div class="adchart-x">${days.map((d, i) => `<span>${ticks.includes(i) ? esc(label(d)) : ''}</span>`).join('')}</div>
  </div>`;
}

function exportCsv(rows, level, p){
  const head = ['Nama','Status','Budget harian','Spend','Hasil','Jenis hasil','Cost per hasil','Impressions','Klik link','CTR link %','CPM','Chat','Leads'];
  const q = v => /[",\n;]/.test(String(v)) ? `"${String(v).replace(/"/g,'""')}"` : v;
  const lines = rows.map(g => [g.name, g.status || '', g.budget ?? '', Math.round(g.spend), g.mixed ? '' : g.results,
    g.mixed ? 'campuran' : (RESULT[g.types[0]] || ''), isFinite(g.cpr) ? Math.round(g.cpr) : '', g.impressions, g.link_clicks,
    isFinite(div(g.link_clicks, g.impressions)) ? (div(g.link_clicks, g.impressions)*100).toFixed(2) : '',
    isFinite(div(g.spend, g.impressions)) ? Math.round(div(g.spend, g.impressions)*1000) : '', g.messages, g.leads].map(q).join(','));
  const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\n')], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `meta-ads-${level}-${p.from}_${p.to}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
}

/* ---------- halaman ---------- */
RENDER.ads = () => {
  const f = F.ads, p = period();
  const filters = `<div class="card" style="margin-bottom:14px">
      <div class="flabel">Periode</div>
      ${chipbar(PERIODS, f.date, v => { f.date = v; RENDER.ads(); })}
      ${f.date === 'custom' ? '<div style="margin-top:10px">' + customRange(f.custom, c => { f.custom = c; RENDER.ads(); }) + '</div>' : ''}
    </div>`;
  if(!p){ $('#page').innerHTML = filters + empty('Pilih rentang tanggal', 'Isi tanggal awal dan akhir.'); return; }
  $('#pgSub').textContent = `${fmtDate(p.from)} – ${fmtDate(p.to)}`;

  if(A.key !== p.from + '|' + p.to){
    if(!A.loading){
      $('#page').innerHTML = filters + '<div class="card"><div class="empty" style="padding:30px"><span>Memuat data iklan…</span></div></div>';
      load(p).then(() => { if(S.page === 'ads') RENDER.ads(); });
    }
    return;
  }

  const last = A.runs[0];
  const syncBar = `<div class="card adsync">
      <div style="min-width:0">
        <div style="font-size:13px;font-weight:600">Sinkronisasi Meta</div>
        <div class="tsub">${last ? `Terakhir ${new Date(last.started_at).toLocaleString('id-ID', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'})} · ${
          last.ok === true ? 'berhasil' : last.ok === false ? '<b style="color:var(--err)">gagal</b> — ' + esc(last.message || '') : 'berjalan…'}` : 'Belum pernah sync. Data otomatis ditarik setiap pagi pukul 06.00 WIB.'}</div>
      </div>
      <div class="right">
        <button class="btn line sm" id="adsBackfill" ${A.syncing ? 'disabled' : ''}>Tarik 90 hari</button>
        <button class="btn sm" id="adsSync" ${A.syncing ? 'disabled' : ''}>${A.syncing ? 'Menyinkronkan…' : 'Sync sekarang'}</button>
      </div>
    </div>`;

  if(A.error){
    const missing = /meta_ads|PGRST202|404/.test(A.error);
    $('#page').innerHTML = filters + syncBar + `<div class="card" style="margin-top:14px">${empty(
      missing ? 'Tabel Meta Ads belum ada' : 'Gagal memuat data',
      missing ? 'Jalankan ulang supabase/schema.sql di SQL Editor Supabase, lalu muat ulang halaman ini.' : A.error)}</div>`;
    bindSync(); return;
  }

  const inCur = A.daily.filter(d => d.date >= p.from), inPrev = A.daily.filter(d => d.date < p.from);
  const tot = rows => rows.reduce((t, d) => { for(const k of ['spend','impressions','link_clicks','messages','leads']) t[k] += +d[k]||0; return t; },
    {spend:0, impressions:0, link_clicks:0, messages:0, leads:0});
  const c = tot(inCur), pv = tot(inPrev);
  const cur = A.byAd[0]?.currency || 'IDR';
  const activeAds = A.byAd.filter(r => r.status === 'ACTIVE' && +r.spend > 0).length;

  if(!A.byAd.length && !inCur.length){
    $('#page').innerHTML = filters + syncBar + `<div class="card" style="margin-top:14px">${empty('Belum ada data iklan pada periode ini',
      A.runs.length ? 'Coba periode lain, atau klik "Tarik 90 hari" untuk mengambil data lama.' : 'Setelah token Meta dipasang, klik "Tarik 90 hari" untuk mengambil data pertama kali.')}</div>`;
    bindSync(); return;
  }

  const kpi = (lbl, val, cap, extra = '') => `<div class="card kpi ${extra}"><div class="lbl">${lbl}</div><div class="val">${val}</div>${cap}</div>`;
  const groups = groupRows(f.level);
  const sorters = {
    spend:  (a, b) => b.spend - a.spend,
    cpr:    (a, b) => (isFinite(a.cpr) ? a.cpr : Infinity) - (isFinite(b.cpr) ? b.cpr : Infinity) || b.spend - a.spend,
    results:(a, b) => b.results - a.results || b.spend - a.spend
  };
  groups.sort(sorters[f.sort]);
  const showBudget = f.level !== 'ad';

  $('#page').innerHTML = filters + syncBar + `
    <div class="grid g4" style="margin-top:14px">
      ${kpi('Spend', money(c.spend, cur), delta(c.spend, pv.spend, 0), 'accent')}
      ${kpi('Chat dimulai', n0(c.messages), `<div class="cap">${money(div(c.spend, c.messages), cur)} / chat</div>${delta(div(c.spend, c.messages), div(pv.spend, pv.messages), -1)}`)}
      ${kpi('Leads', n0(c.leads), `<div class="cap">${money(div(c.spend, c.leads), cur)} / lead</div>${delta(div(c.spend, c.leads), div(pv.spend, pv.leads), -1)}`)}
      ${kpi('Klik link', n0(c.link_clicks), `<div class="cap">${money(div(c.spend, c.link_clicks), cur)} / klik</div>${delta(div(c.spend, c.link_clicks), div(pv.spend, pv.link_clicks), -1)}`)}
    </div>
    <div class="grid g4" style="margin-top:13px">
      ${kpi('Impressions', n0(c.impressions), delta(c.impressions, pv.impressions, 1))}
      ${kpi('CPM', money(div(c.spend, c.impressions) * 1000, cur), delta(div(c.spend, c.impressions), div(pv.spend, pv.impressions), -1))}
      ${kpi('CTR link', pct(div(c.link_clicks, c.impressions)), delta(div(c.link_clicks, c.impressions), div(pv.link_clicks, pv.impressions), 1))}
      ${kpi('Iklan aktif', n0(activeAds), '<div class="cap">aktif & ada spend di periode ini</div>')}
    </div>

    <div class="sec-h"><h3>Tren harian</h3>
      <div class="right">${chipbar(Object.entries(METRICS).map(([v, m]) => ({v, l:m.l})), f.metric, v => { f.metric = v; RENDER.ads(); }, true)}</div></div>
    <div class="card">${chart(p, cur)}</div>

    <div class="sec-h"><h3>Rincian</h3>
      <div class="right"><button class="btn ghost sm" id="adsCsv">Export CSV</button></div></div>
    <div class="card" style="margin-bottom:14px">
      <div class="flabel">Level</div>
      ${chipbar([{v:'campaign',l:'Campaign'},{v:'adset',l:'Ad Set'},{v:'ad',l:'Iklan'}], f.level, v => { f.level = v; RENDER.ads(); })}
      <div class="flabel" style="margin-top:16px">Urutkan</div>
      ${chipbar([{v:'spend',l:'Spend terbesar'},{v:'cpr',l:'Cost per hasil termurah'},{v:'results',l:'Hasil terbanyak'}], f.sort, v => { f.sort = v; RENDER.ads(); }, true)}
    </div>
    <div class="card"><div class="tablewrap"><table>
      <thead><tr><th>${{campaign:'Campaign', adset:'Ad Set', ad:'Iklan'}[f.level]}</th><th>Status</th>${showBudget ? '<th class="r">Budget/hari</th>' : ''}
        <th class="r">Spend</th><th class="r">Hasil</th><th class="r">Cost/hasil</th><th class="r">CTR link</th><th class="r">CPM</th>
        <th class="r" title="Rata-rata frekuensi harian (impressions ÷ reach harian)">Freq/hari</th></tr></thead>
      <tbody>${groups.map(g => `<tr>
        <td><div style="display:flex;gap:10px;align-items:center">${g.thumb ? `<img src="${esc(g.thumb)}" alt="" class="adthumb" loading="lazy">` : ''}
          <div class="adname"><div class="tname">${esc(g.name)}</div><div class="tsub">${esc(g.sub || '')}</div></div></div></td>
        <td>${statusBadge(g.status)}</td>
        ${showBudget ? `<td class="r num">${g.budget ? money(g.budget, cur) : '<span class="tsub">—</span>'}</td>` : ''}
        <td class="r num">${money(g.spend, cur)}</td>
        <td class="r num">${resultCell(g)}</td>
        <td class="r num">${money(g.cpr, cur)}</td>
        <td class="r num">${pct(div(g.link_clicks, g.impressions))}</td>
        <td class="r num">${money(div(g.spend, g.impressions) * 1000, cur)}</td>
        <td class="r num">${isFinite(div(g.impressions, g.reach)) ? div(g.impressions, g.reach).toFixed(2) : '—'}</td>
      </tr>`).join('')}</tbody></table></div></div>`;

  bindSync();
  $('#adsCsv').onclick = () => exportCsv(groups, f.level, p);

  // tooltip grafik
  const tip = $('#adTip');
  if(tip) $$('.adbar').forEach(b => {
    const show = () => {
      tip.textContent = b.dataset.tip; tip.style.display = 'block';
      const plot = b.parentElement.getBoundingClientRect(), r = b.getBoundingClientRect();
      const x = Math.min(Math.max(r.left - plot.left + r.width / 2, tip.offsetWidth / 2), plot.width - tip.offsetWidth / 2);
      tip.style.left = x + 'px';
    };
    b.onmouseenter = show; b.onfocus = show;
    b.onmouseleave = b.onblur = () => { tip.style.display = 'none'; };
  });
};

function bindSync(){
  $('#adsSync').onclick = () => sync(3);
  $('#adsBackfill').onclick = () => sync(90);
}
