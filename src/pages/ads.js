/* META ADS — pantau performa iklan Facebook & Instagram langsung dari BMS.
   Data diambil dari Meta Marketing API (Graph API) memakai token yang disimpan
   di tabel meta_ads_config (khusus admin). Dibandingkan otomatis dengan periode
   sebelumnya dan dengan booking yang masuk ke BMS pada periode yang sama. */
import { $, $$, S, F, RENDER, rp, esc, iso, today, range, inRange, chipbar, customRange,
         api, logAct, toast, openModal, closeModal, money, moneyVal, svg } from '../core.js';
import { ago } from './activity.js';

const GRAPH = 'https://graph.facebook.com/v23.0/';
const REFRESH_MIN = 15;            // auto-refresh selama halaman terbuka
const STALE_MIN = 5;               // ganti periode → pakai cache bila belum selama ini

/* "Hasil" = aksi yang dihitung sebagai hasil iklan. Tiap jenis berisi daftar
   action_type Meta; yang pertama ditemukan dipakai (tidak dijumlah, supaya tidak dobel). */
const RESULTS = {
  auto:      {l:'Otomatis (ikut tujuan kampanye)'},
  messaging: {l:'Chat WhatsApp / Messenger / DM', u:'chat', a:['onsite_conversion.messaging_conversation_started_7d']},
  lead:      {l:'Lead (formulir)', u:'lead', a:['lead','onsite_conversion.lead_grouped','offsite_conversion.fb_pixel_lead']},
  purchase:  {l:'Pembelian', u:'pembelian', a:['omni_purchase','purchase','offsite_conversion.fb_pixel_purchase']},
  lpv:       {l:'Landing page view', u:'LPV', a:['landing_page_view','omni_landing_page_view']},
  link:      {l:'Klik link', u:'klik', a:['link_click']}
};
/* mode otomatis: urutan jenis hasil menurut tujuan kampanye */
const BY_OBJECTIVE = {
  OUTCOME_LEADS:['lead','messaging'], LEAD_GENERATION:['lead','messaging'],
  OUTCOME_ENGAGEMENT:['messaging','lead'], MESSAGES:['messaging'],
  OUTCOME_SALES:['purchase','messaging','lead'], CONVERSIONS:['purchase','lead'],
  OUTCOME_TRAFFIC:['lpv','link'], LINK_CLICKS:['link'],
  OUTCOME_AWARENESS:[], REACH:[], BRAND_AWARENESS:[]
};
const FALLBACK = ['messaging','lead','purchase','lpv','link'];
/* klik & LPV hanya masuk total "hasil" bila admin memang memilihnya — supaya
   biaya per hasil tidak tercampur klik yang jauh lebih murah dari chat/lead */
const counted = key => key && (!['link','lpv'].includes(key) || M.cfg.result_type === key);
const OBJECTIVE_LABEL = {
  OUTCOME_LEADS:'Prospek', LEAD_GENERATION:'Prospek', OUTCOME_ENGAGEMENT:'Interaksi', MESSAGES:'Pesan',
  OUTCOME_SALES:'Penjualan', CONVERSIONS:'Konversi', OUTCOME_TRAFFIC:'Traffic', LINK_CLICKS:'Traffic',
  OUTCOME_AWARENESS:'Awareness', REACH:'Jangkauan', BRAND_AWARENESS:'Awareness', OUTCOME_APP_PROMOTION:'Aplikasi'
};
/* mata uang tanpa sen di Meta (anggaran dikirim dalam satuan utuh) */
const NO_CENTS = new Set(['IDR','JPY','KRW','VND','CLP','COP','CRC','HUF','ISK','PYG','TWD']);

const M = {
  cfg:undefined,         // undefined = belum dimuat · null = belum dihubungkan
  missingTable:false,
  cache:{}, loading:null, error:null
};
F.ads = {date:'last7', custom:{}, show:'spend', status:'all', sort:'spend'};

/* ---------- format ---------- */
const num = n => Math.round(Number(n)||0).toLocaleString('id-ID');
const dec = (n, d=2) => (Number(n)||0).toLocaleString('id-ID', {minimumFractionDigits:d, maximumFractionDigits:d});
const pct = n => dec(n) + '%';
function cur(n, code = M.account?.currency || 'IDR'){
  if(code === 'IDR') return rp(n);
  try{ return (Number(n)||0).toLocaleString('id-ID', {style:'currency', currency:code, maximumFractionDigits:2}); }
  catch(_){ return code + ' ' + dec(n); }
}
const div = (a, b) => b ? a / b : 0;

/* ---------- Graph API ---------- */
function graphError(e){
  const c = e.code;
  if(c === 190) return 'Access token tidak valid atau sudah kedaluwarsa. Buat token baru lalu perbarui di Pengaturan.';
  if(c === 4 || c === 17 || c === 32 || c === 613 || c === 80000 || c === 80004) return 'Batas permintaan Meta tercapai. Tunggu beberapa menit lalu coba lagi.';
  if(c === 10 || c === 294 || (c >= 200 && c < 300)) return 'Token tidak punya izin membaca akun iklan ini (butuh izin ads_read dan akses ke akun iklan).';
  if(c === 100 && /act_|account/i.test(e.message||'')) return 'ID akun iklan tidak ditemukan. Periksa kembali ID di Pengaturan.';
  return e.error_user_msg || e.message || 'Gagal mengambil data dari Meta.';
}
async function graph(path, params, cfg = M.cfg){
  const u = new URL(GRAPH + path);
  for(const [k, v] of Object.entries(params||{})) u.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : v);
  u.searchParams.set('access_token', cfg.access_token);
  let url = u.toString(), out = null;
  while(url){
    let j;
    try{ j = await (await fetch(url)).json(); }
    catch(_){ throw new Error('Tidak bisa terhubung ke Meta. Periksa koneksi internet.'); }
    if(j.error) throw new Error(graphError(j.error));
    if(!Array.isArray(j.data)) return j;          // objek tunggal (info akun)
    out = (out || []).concat(j.data);
    url = j.paging?.next || null;
  }
  return out;
}
const actId = id => 'act_' + String(id||'').trim().replace(/^act_/i, '');

/* ---------- konfigurasi (tabel meta_ads_config) ---------- */
async function loadConfig(){
  try{
    const rows = await api('meta_ads_config?select=*&id=eq.1');
    M.cfg = rows[0] || null; M.missingTable = false;
  }catch(e){
    if(/42P01|PGRST205|404/.test(e.message)){ M.cfg = null; M.missingTable = true; }
    else throw e;
  }
}

/* ---------- periode ---------- */
const PERIODS = [
  {v:'today',l:'Hari ini'},{v:'yesterday',l:'Kemarin'},{v:'last7',l:'7 hari'},{v:'last14',l:'14 hari'},
  {v:'last30',l:'30 hari'},{v:'month',l:'Bulan ini'},{v:'lastmonth',l:'Bulan lalu'},{v:'custom',l:'Custom'}
];
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return iso(x); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5) + 1;
function period(){
  const f = F.ads, t = today();
  let r;
  if(f.date === 'yesterday') r = {from:addDays(t,-1), to:addDays(t,-1)};
  else if(f.date === 'last14') r = {from:addDays(t,-13), to:t};
  else r = range(f.date, f.custom);
  if(!r.from || !r.to) return null;
  if(r.to > t) r = {...r, to:t};                           // Meta menolak tanggal di masa depan
  if(r.from > r.to) return null;
  const n = daysBetween(r.from, r.to);
  return {...r, days:n, prev:{from:addDays(r.from, -n), to:addDays(r.from, -1)}};
}
const periodLabel = p => p.from === p.to
  ? new Date(p.from + 'T00:00:00').toLocaleDateString('id-ID', {day:'numeric', month:'short', year:'numeric'})
  : `${new Date(p.from + 'T00:00:00').toLocaleDateString('id-ID', {day:'numeric', month:'short'})} – ${new Date(p.to + 'T00:00:00').toLocaleDateString('id-ID', {day:'numeric', month:'short', year:'numeric'})}`;

/* ---------- olah data insights ---------- */
const actionMap = list => Object.fromEntries((list||[]).map(a => [a.action_type, Number(a.value)||0]));
function pickResult(actions, key){
  for(const t of RESULTS[key]?.a || []) if(actions[t]) return actions[t];
  return 0;
}
/* jenis hasil satu kampanye: pilihan admin, atau otomatis menurut tujuan + data yang ada */
function resultKey(objective, actions){
  const pref = M.cfg.result_type || 'auto';
  if(pref !== 'auto') return pref;
  const order = BY_OBJECTIVE[objective];
  if(order && !order.length) return null;                  // kampanye awareness: tidak ada "hasil"
  for(const k of [...(order||[]), ...FALLBACK]) if(pickResult(actions, k)) return k;
  return (order||FALLBACK)[0];
}
function sumActions(rows){
  const out = {};
  for(const r of rows) for(const [k, v] of Object.entries(actionMap(r.actions))) out[k] = (out[k]||0) + v;
  return out;
}
function summarize(campRows){
  const c = campRows.map(r => {
    const actions = actionMap(r.actions);
    const key = resultKey(r.objective, actions);
    const spend = Number(r.spend)||0, impressions = Number(r.impressions)||0;
    const clicks = Number(r.inline_link_clicks)||0, results = key ? pickResult(actions, key) : 0;
    return {
      id:r.campaign_id, name:r.campaign_name, objective:r.objective, key, actions,
      spend, impressions, clicks, results, reach:Number(r.reach)||0, frequency:Number(r.frequency)||0,
      ctr:div(clicks, impressions)*100, cpc:div(spend, clicks), cpm:div(spend, impressions)*1000, cpr:div(spend, results)
    };
  });
  const t = c.reduce((a, x) => ({spend:a.spend+x.spend, impressions:a.impressions+x.impressions, clicks:a.clicks+x.clicks,
    results:a.results+(counted(x.key) ? x.results : 0)}), {spend:0, impressions:0, clicks:0, results:0});
  const byKey = {};
  for(const x of c) if(counted(x.key) && x.results) byKey[x.key] = (byKey[x.key]||0) + x.results;
  return {campaigns:c, total:{...t, ctr:div(t.clicks, t.impressions)*100, cpc:div(t.spend, t.clicks), cpm:div(t.spend, t.impressions)*1000, cpr:div(t.spend, t.results), byKey}};
}

async function fetchPeriod(p){
  const acct = actId(M.cfg.ad_account_id);
  const base = {time_range:{since:p.from, until:p.to}, limit:500};
  const F_CAMP = 'campaign_id,campaign_name,objective,spend,impressions,reach,frequency,inline_link_clicks,actions';
  const [account, camps, daily, totals, prev, list] = await Promise.all([
    graph(acct, {fields:'name,currency,account_status,timezone_name,disable_reason'}),
    graph(acct + '/insights', {...base, level:'campaign', fields:F_CAMP}),
    graph(acct + '/insights', {...base, level:'campaign', time_increment:1, fields:'campaign_id,objective,spend,impressions,inline_link_clicks,actions'}),
    graph(acct + '/insights', {...base, level:'account', fields:'reach,frequency'}),
    graph(acct + '/insights', {time_range:{since:p.prev.from, until:p.prev.to}, limit:500, level:'campaign', fields:F_CAMP}),
    graph(acct + '/campaigns', {fields:'id,name,effective_status,objective,daily_budget,lifetime_budget', limit:500})
  ]);
  const now = summarize(camps);
  const keyOf = Object.fromEntries(now.campaigns.map(x => [x.id, x.key]));
  /* tren harian: hasil per hari memakai jenis hasil kampanyenya pada periode ini */
  const days = {};
  for(let d = p.from; d <= p.to; d = addDays(d, 1)) days[d] = {date:d, spend:0, impressions:0, clicks:0, results:0};
  for(const r of daily){
    const d = days[r.date_start]; if(!d) continue;
    d.spend += Number(r.spend)||0; d.impressions += Number(r.impressions)||0; d.clicks += Number(r.inline_link_clicks)||0;
    const k = keyOf[r.campaign_id] ?? resultKey(r.objective, actionMap(r.actions));
    if(counted(k)) d.results += pickResult(actionMap(r.actions), k);
  }
  const info = Object.fromEntries((list||[]).map(c => [c.id, c]));
  const offset = NO_CENTS.has(account.currency) ? 1 : 100;
  for(const c of now.campaigns){
    const i = info[c.id];
    c.status = i?.effective_status || 'UNKNOWN';
    c.budget = i?.daily_budget ? Number(i.daily_budget)/offset : null;
    c.lifetime = i?.lifetime_budget ? Number(i.lifetime_budget)/offset : null;
  }
  const active = (list||[]).filter(c => c.effective_status === 'ACTIVE').length;
  return {
    account, active, at:Date.now(),
    total:{...now.total, reach:Number(totals[0]?.reach)||0, frequency:Number(totals[0]?.frequency)||0, actions:sumActions(camps)},
    campaigns:now.campaigns, prev:summarize(prev).total, daily:Object.values(days)
  };
}

async function load(force){
  const p = period(); if(!p) return;
  const key = p.from + '|' + p.to;
  const hit = M.cache[key];
  if(!force && hit && Date.now() - hit.at < STALE_MIN*60e3) return;
  if(M.loading === key) return;
  M.loading = key; M.error = null;
  if(S.page === 'ads') RENDER.ads();
  try{
    M.cache[key] = await fetchPeriod(p);
    M.account = M.cache[key].account;
  }catch(e){ M.error = e.message; }
  M.loading = null;
  if(S.page === 'ads') RENDER.ads();
}

/* auto-refresh: hanya saat halaman Meta Ads terbuka dan tab terlihat */
setInterval(() => {
  if(S.page === 'ads' && M.cfg && !document.hidden) load(true);
}, REFRESH_MIN*60e3);
document.addEventListener('visibilitychange', () => {
  if(!document.hidden && S.page === 'ads' && M.cfg) load(false);
});

/* ---------- booking BMS pada periode yang sama ---------- */
function bmsBookings(p){
  const rows = (S.data.bookings||[]).filter(b => b.status !== 'CANCELLED' && b.created_at && inRange(iso(b.created_at), p));
  return {count:rows.length, revenue:rows.reduce((n, b) => n + (Number(b.total_invoice)||0), 0)};
}

/* ---------- komponen tampilan ---------- */
function delta(now, before, lowerIsBetter){
  if(!before && !now) return '';
  if(!before) return '<span class="ad-delta">baru</span>';
  const ch = (now - before) / before * 100;
  if(Math.abs(ch) < 0.5) return '<span class="ad-delta">stabil</span>';
  const good = lowerIsBetter ? ch < 0 : ch > 0;
  return `<span class="ad-delta ${good ? 'up' : 'down'}">${ch > 0 ? '▲' : '▼'} ${Math.abs(ch).toFixed(0)}%</span>`;
}
const kpi = (label, value, d, cap, accent) => `<div class="card kpi ${accent ? 'accent' : ''}">
  <div class="lbl">${label}</div><div class="val num">${value}</div>
  <div class="cap">${d || ''}${d && cap ? ' · ' : ''}${cap || ''}</div></div>`;

function resultLabel(t){
  const keys = Object.keys(t.byKey||{});
  if(!keys.length) return 'hasil';
  if(keys.length === 1) return RESULTS[keys[0]].u;
  return 'hasil';
}
function resultBreakdown(t){
  const e = Object.entries(t.byKey||{}).sort((a, b) => b[1] - a[1]);
  return e.length > 1 ? e.map(([k, v]) => `${num(v)} ${RESULTS[k].u}`).join(' · ') : '';
}

/* kesehatan kampanye dengan bahasa sederhana */
function health(c){
  const notes = [];
  const target = Number(M.cfg.target_cpr)||0;
  if(c.spend > 0 && c.key && !c.results) notes.push(['err', `Belum ada ${RESULTS[c.key].u}`]);
  if(target && c.results && c.cpr > target) notes.push(['err', `Biaya per ${RESULTS[c.key].u} di atas target`]);
  if(c.impressions >= 1000 && c.ctr < 0.8 && c.key !== null) notes.push(['warn', 'CTR rendah — coba ganti materi iklan']);
  if(c.frequency >= 3.5) notes.push(['warn', 'Frekuensi tinggi — audiens mulai jenuh']);
  return notes;
}
const healthBadge = notes => !notes.length ? '<span class="badge b-ok"><span class="d"></span>Sehat</span>'
  : notes.some(n => n[0] === 'err') ? '<span class="badge b-err"><span class="d"></span>Perlu dicek</span>'
  : '<span class="badge b-warn"><span class="d"></span>Pantau</span>';
const STATUS = {
  ACTIVE:['Aktif','b-ok'], PAUSED:['Dijeda','b-grey'], CAMPAIGN_PAUSED:['Dijeda','b-grey'], ARCHIVED:['Diarsipkan','b-grey'],
  DELETED:['Dihapus','b-grey'], IN_PROCESS:['Diproses','b-neutral'], WITH_ISSUES:['Bermasalah','b-err'], PENDING_REVIEW:['Ditinjau','b-neutral'],
  DISAPPROVED:['Ditolak','b-err'], PREAPPROVED:['Disetujui','b-neutral'], PENDING_BILLING_INFO:['Butuh pembayaran','b-warn'], ADSET_PAUSED:['Dijeda','b-grey']
};
const statusBadge = s => { const [t, c] = STATUS[s] || [String(s).replace(/_/g,' ').toLowerCase(), 'b-grey']; return `<span class="badge ${c}">${esc(t)}</span>`; };

/* ringkasan otomatis untuk dibaca sekilas */
function insights(d, bms){
  const t = d.total, p = d.prev, out = [];
  const unit = resultLabel(t);
  const ch = (a, b) => b ? (a - b) / b * 100 : null;
  if(!t.spend){ out.push(['grey', 'Belum ada biaya iklan pada periode ini.']); return out; }
  const cprCh = ch(t.cpr, p.cpr);
  if(t.results && cprCh !== null && Math.abs(cprCh) >= 10)
    out.push([cprCh < 0 ? 'ok' : 'err', `Biaya per ${unit} <b>${cprCh < 0 ? 'turun' : 'naik'} ${Math.abs(cprCh).toFixed(0)}%</b> dibanding periode sebelumnya (${cur(p.cpr)} → ${cur(t.cpr)}).`]);
  const resCh = ch(t.results, p.results);
  if(resCh !== null && Math.abs(resCh) >= 10)
    out.push([resCh > 0 ? 'ok' : 'warn', `Jumlah ${unit} <b>${resCh > 0 ? 'naik' : 'turun'} ${Math.abs(resCh).toFixed(0)}%</b> (${num(p.results)} → ${num(t.results)}).`]);
  /* bandingkan hanya kampanye dengan jenis hasil yang sama (jenis terbanyak) */
  const main = Object.entries(t.byKey).sort((a, b) => b[1] - a[1])[0]?.[0];
  const withRes = d.campaigns.filter(c => c.key === main && c.results >= 3);
  if(withRes.length > 1){
    const best = [...withRes].sort((a, b) => a.cpr - b.cpr)[0];
    out.push(['ok', `Paling efisien: <b>${esc(best.name)}</b> — ${cur(best.cpr)} per ${RESULTS[best.key].u}.`]);
  }
  const waste = d.campaigns.filter(c => c.key && c.spend > 0 && !c.results).sort((a, b) => b.spend - a.spend)[0];
  if(waste && waste.spend >= t.spend * 0.1)
    out.push(['err', `<b>${esc(waste.name)}</b> sudah menghabiskan ${cur(waste.spend)} tanpa ${RESULTS[waste.key].u}.`]);
  const tired = d.campaigns.filter(c => c.frequency >= 3.5);
  if(tired.length) out.push(['warn', `${tired.length} kampanye frekuensinya tinggi (≥3,5×) — saatnya ganti materi atau perluas audiens.`]);
  if(t.ctr && t.impressions >= 1000 && t.ctr < 0.8) out.push(['warn', `CTR keseluruhan ${pct(t.ctr)} — di bawah rata-rata wajar (±1%). Coba uji foto/video baru.`]);
  if(bms.count && (d.account.currency||'IDR') === 'IDR')
    out.push(['info', `${num(bms.count)} booking masuk ke BMS pada periode ini — biaya iklan ${cur(t.spend / bms.count)} per booking.`]);
  if(!out.length) out.push(['ok', 'Performa stabil dibanding periode sebelumnya.']);
  return out;
}

/* grafik harian: batang = metrik pilihan */
function chart(daily, show){
  const val = d => show === 'spend' ? d.spend : show === 'results' ? d.results : show === 'clicks' ? d.clicks : div(d.spend, d.results);
  const fmt = v => show === 'spend' || show === 'cpr' ? cur(v) : num(v);
  const W = 640, H = 210, pl = 6, pr = 6, pt = 14, pb = 26;
  const n = daily.length, vals = daily.map(val), max = Math.max(...vals, 0) || 1;
  const bw = (W - pl - pr) / n, gap = Math.min(6, bw * 0.28);
  const step = Math.ceil(n / 8);
  const short = d => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', {day:'numeric', month:'short'});
  const bars = daily.map((d, i) => {
    const h = vals[i] / max * (H - pt - pb), x = pl + i * bw + gap / 2, y = H - pb - h;
    return `<g><title>${short(d.date)}: ${fmt(vals[i])}</title>
      <rect x="${x.toFixed(1)}" y="${pt}" width="${(bw - gap).toFixed(1)}" height="${H - pt - pb}" fill="transparent"/>
      <rect class="ad-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw - gap).toFixed(1)}" height="${Math.max(h, vals[i] ? 2 : 0).toFixed(1)}" rx="${Math.min(5, (bw - gap) / 3).toFixed(1)}"/>
      ${i % step === 0 ? `<text x="${(x + (bw - gap) / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${short(d.date)}</text>` : ''}</g>`;
  }).join('');
  const total = vals.reduce((a, b) => a + b, 0);
  const avg = show === 'cpr' ? null : total / n;
  const ay = avg !== null ? H - pb - avg / max * (H - pt - pb) : 0;
  return `<svg class="ad-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafik harian">
    <line x1="${pl}" x2="${W - pr}" y1="${H - pb}" y2="${H - pb}" class="ad-axis"/>
    ${bars}
    ${avg !== null && n > 1 ? `<line x1="${pl}" x2="${W - pr}" y1="${ay.toFixed(1)}" y2="${ay.toFixed(1)}" class="ad-avg"/>` : ''}
  </svg>
  <div class="ad-chart-foot"><span>Tertinggi <b>${fmt(Math.max(...vals, 0))}</b></span>
    ${avg !== null ? `<span><i class="ad-avg-sw"></i>Rata-rata <b>${fmt(avg)}</b>/hari</span>` : ''}</div>`;
}

/* ---------- halaman ---------- */
RENDER.ads = () => {
  if(M.cfg === undefined){
    $('#page').innerHTML = `<div class="card"><div class="empty"><b>Memuat…</b><span>Menyiapkan halaman Meta Ads.</span></div></div>`;
    loadConfig().then(() => { if(S.page === 'ads') RENDER.ads(); })
      .catch(e => { M.cfg = null; M.error = e.message; if(S.page === 'ads') RENDER.ads(); });
    return;
  }
  if(!M.cfg) return renderSetup();

  const f = F.ads, p = period();
  $('#pgSub').textContent = M.account ? `${M.account.name} · ${actId(M.cfg.ad_account_id)}` : actId(M.cfg.ad_account_id);
  const filters = `<div class="card" style="margin-bottom:14px">
      <div class="ad-top">
        <div style="min-width:0;flex:1">
          <div class="flabel">Periode</div>
          ${chipbar(PERIODS, f.date, v => { f.date = v; RENDER.ads(); load(false); })}
          ${f.date === 'custom' ? '<div style="margin-top:10px">' + customRange(f.custom, c => { f.custom = c; RENDER.ads(); load(false); }) + '</div>' : ''}
        </div>
        <div class="ad-acts">
          <button class="btn soft sm" id="adRefresh" ${M.loading ? 'disabled' : ''}>${M.loading ? 'Memuat…' : '↻ Perbarui'}</button>
          <button class="btn line sm" id="adCfg">Pengaturan</button>
        </div>
      </div>
    </div>`;

  if(!p){
    $('#page').innerHTML = filters + `<div class="card"><div class="empty"><b>Pilih rentang tanggal</b><span>Isi tanggal mulai dan akhir.</span></div></div>`;
    return bind();
  }
  const d = M.cache[p.from + '|' + p.to];
  if(!d && !M.loading && !M.error){ load(false); }

  let body;
  if(!d){
    body = M.error ? errorCard() : `<div class="card"><div class="empty"><div class="ic">${svg('ads')}</div><b>Mengambil data dari Meta…</b><span>${periodLabel(p)}</span></div></div>`;
  } else {
    const t = d.total, pv = d.prev, bms = bmsBookings(p), unit = resultLabel(t);
    const idr = (d.account.currency||'IDR') === 'IDR';
    const ACC = {1:null, 2:'Akun iklan dinonaktifkan', 3:'Akun iklan belum dibayar', 7:'Akun iklan sedang ditinjau', 9:'Akun dalam masa tenggang pembayaran', 100:'Akun menunggu penutupan', 101:'Akun iklan ditutup'};
    const accWarn = ACC[d.account.account_status];
    const sorters = {spend:(a, b) => b.spend - a.spend, results:(a, b) => b.results - a.results,
                     cpr:(a, b) => (a.results ? a.cpr : Infinity) - (b.results ? b.cpr : Infinity), ctr:(a, b) => b.ctr - a.ctr};
    const camps = d.campaigns.filter(c => f.status === 'all' || c.status === 'ACTIVE').sort(sorters[f.sort]);

    body = `
      ${M.error ? errorCard(true) : ''}
      ${accWarn ? `<div class="banner"><b>Perhatian:</b> ${accWarn}. Iklan tidak akan tayang sampai masalah ini diselesaikan di Meta Ads Manager.</div>` : ''}
      <div class="ad-meta">${periodLabel(p)} · dibanding ${periodLabel(p.prev)} · diperbarui ${ago(new Date(d.at).toISOString())} · ${d.active} kampanye aktif</div>

      <div class="grid g4">
        ${kpi('Biaya iklan', cur(t.spend), delta(t.spend, pv.spend), `${cur(div(t.spend, p.days))}/hari`, true)}
        ${kpi(unit === 'hasil' ? 'Hasil' : 'Hasil (' + unit + ')', num(t.results), delta(t.results, pv.results), resultBreakdown(t) || 'vs periode sebelumnya')}
        ${kpi('Biaya per ' + unit, t.results ? cur(t.cpr) : '—', t.results ? delta(t.cpr, pv.cpr, true) : '', M.cfg.target_cpr ? 'target ' + cur(M.cfg.target_cpr) : 'makin kecil makin baik')}
        ${kpi('Jangkauan', num(t.reach), '', `frekuensi ${dec(t.frequency, 1)}×`)}
      </div>
      <div class="grid g4" style="margin-top:13px">
        ${kpi('Tayangan', num(t.impressions), delta(t.impressions, pv.impressions), `CPM ${cur(t.cpm)}`)}
        ${kpi('Klik link', num(t.clicks), delta(t.clicks, pv.clicks), `CPC ${cur(t.cpc)}`)}
        ${kpi('CTR', pct(t.ctr), delta(t.ctr, pv.ctr), 'klik ÷ tayangan')}
        ${idr ? kpi('Booking masuk BMS', num(bms.count), '', bms.count ? `${cur(t.spend / bms.count)} iklan per booking` : 'pada periode ini')
              : kpi('Kampanye aktif', num(d.active), '', `${d.campaigns.length} berbelanja di periode ini`)}
      </div>

      <div class="grid g2" style="margin-top:13px">
        <div class="card">
          <div class="ad-card-h"><b>Ringkasan cepat</b></div>
          <div class="ad-ins">${insights(d, bms).map(([tone, txt]) => `<div class="ad-in ${tone}"><span class="d"></span><div>${txt}</div></div>`).join('')}</div>
        </div>
        <div class="card">
          <div class="ad-card-h"><b>Tren harian</b>
            ${chipbar([{v:'spend',l:'Biaya'},{v:'results',l:'Hasil'},{v:'cpr',l:'Biaya/hasil'},{v:'clicks',l:'Klik'}], f.show, v => { f.show = v; RENDER.ads(); }, true)}</div>
          ${chart(d.daily, f.show)}
        </div>
      </div>

      ${idr && bms.count ? `<div class="card" style="margin-top:13px">
        <div class="ad-card-h"><b>Iklan vs omset BMS</b><span class="tsub">semua booking yang masuk di periode ini, tidak hanya dari iklan</span></div>
        <div class="grid g3 ad-roi">
          <div><div class="tsub">Omset booking</div><b class="num">${rp(bms.revenue)}</b></div>
          <div><div class="tsub">Biaya iklan</div><b class="num">${rp(t.spend)}</b></div>
          <div><div class="tsub">Omset ÷ biaya iklan</div><b class="num">${t.spend ? dec(bms.revenue / t.spend, 1) + '×' : '—'}</b></div>
        </div></div>` : ''}

      <div class="sec-h"><h3>Kampanye</h3>
        <div class="right">
          ${chipbar([{v:'all',l:'Semua'},{v:'active',l:'Aktif'}], f.status, v => { f.status = v; RENDER.ads(); })}
          ${chipbar([{v:'spend',l:'Biaya'},{v:'results',l:'Hasil'},{v:'cpr',l:'Termurah'},{v:'ctr',l:'CTR'}], f.sort, v => { f.sort = v; RENDER.ads(); }, true)}
        </div></div>
      ${camps.length ? `<div class="card"><div class="tablewrap"><table>
        <thead><tr><th>Kampanye</th><th>Kondisi</th><th class="r">Biaya</th><th class="r">Hasil</th><th class="r">Biaya/hasil</th><th class="r">CTR</th><th class="r">CPC</th><th class="r">Frek.</th></tr></thead>
        <tbody>${camps.map(c => { const h = health(c); return `<tr>
          <td><div class="tname">${esc(c.name)}</div>
            <div class="tsub">${statusBadge(c.status)} ${esc(OBJECTIVE_LABEL[c.objective] || c.objective || '')}${c.budget ? ' · ' + cur(c.budget) + '/hari' : c.lifetime ? ' · total ' + cur(c.lifetime) : ''}</div></td>
          <td>${healthBadge(h)}${h.length ? `<div class="tsub ad-notes">${h.map(x => esc(x[1])).join('<br>')}</div>` : ''}</td>
          <td class="r num">${cur(c.spend)}</td>
          <td class="r num">${c.key ? `${num(c.results)}<div class="tsub">${RESULTS[c.key].u}</div>` : '<span class="tsub">awareness</span>'}</td>
          <td class="r num">${c.results ? cur(c.cpr) : '—'}</td>
          <td class="r num">${pct(c.ctr)}</td>
          <td class="r num">${c.clicks ? cur(c.cpc) : '—'}</td>
          <td class="r num">${dec(c.frequency, 1)}</td>
        </tr>`; }).join('')}</tbody></table></div></div>`
        : `<div class="card"><div class="empty"><b>Tidak ada kampanye</b><span>Belum ada kampanye yang berbelanja pada periode ini.</span></div></div>`}

      <div class="ad-foot">Data dari Meta Marketing API · diperbarui otomatis tiap ${REFRESH_MIN} menit selama halaman ini terbuka. Angka hari ini bisa berubah sampai Meta selesai memproses.</div>`;
  }
  $('#page').innerHTML = filters + body;
  bind();

  function bind(){
    $('#adRefresh').onclick = () => load(true);
    $('#adCfg').onclick = () => openSettings();
    $$('[data-adcfg]').forEach(b => b.onclick = () => openSettings());
    $$('[data-adretry]').forEach(b => b.onclick = () => load(true));
  }
};

function errorCard(compact){
  if(compact) return `<div class="banner"><b>Gagal memperbarui:</b> ${esc(M.error)} <button class="linkbtn" data-adretry style="margin-left:auto">Coba lagi</button></div>`;
  return `<div class="card"><div class="empty"><div class="ic" style="background:var(--err-bg);color:var(--err)">!</div>
    <b>Gagal mengambil data</b><span>${esc(M.error)}</span>
    <div style="display:flex;gap:8px;justify-content:center;margin-top:16px;flex-wrap:wrap">
      <button class="btn soft sm" data-adretry>Coba lagi</button><button class="btn sm" data-adcfg>Pengaturan</button></div></div></div>`;
}

function renderSetup(){
  $('#pgSub').textContent = 'Belum terhubung';
  $('#page').innerHTML = `
    ${M.missingTable ? `<div class="banner"><b>Database belum siap:</b> jalankan ulang <code>supabase/schema.sql</code> di Supabase SQL Editor untuk membuat tabel <code>meta_ads_config</code>.</div>` : ''}
    ${M.error ? `<div class="banner"><b>Error:</b> ${esc(M.error)}</div>` : ''}
    <div class="card ad-setup">
      <div class="empty" style="padding:26px 10px 10px"><div class="ic">${svg('ads')}</div>
        <b>Hubungkan akun Meta Ads</b><span>Pantau biaya, hasil, dan kampanye Facebook & Instagram langsung dari BMS.</span></div>
      <ol class="ad-steps">
        <li>Buka <a href="https://business.facebook.com/settings/system-users" target="_blank" rel="noopener">Meta Business Settings → System Users</a>, buat <i>system user</i> (peran Admin atau Employee).</li>
        <li>Klik <b>Assign assets</b> → pilih akun iklan Anda → beri akses <b>View performance</b>.</li>
        <li>Klik <b>Generate new token</b>, pilih app Anda, centang izin <b>ads_read</b>, masa berlaku <b>Never</b>. Salin token.</li>
        <li>Salin <b>ID akun iklan</b> dari Ads Manager (angka di URL, <code>act=1234567890</code>).</li>
        <li>Klik tombol di bawah dan tempel keduanya.</li>
      </ol>
      <div style="text-align:center;padding:4px 0 10px"><button class="btn" id="adConnect" ${M.missingTable ? 'disabled' : ''}>Hubungkan Meta Ads</button></div>
    </div>`;
  $('#adConnect').onclick = () => openSettings();
}

function openSettings(){
  const c = M.cfg || {};
  openModal(`<h3>Pengaturan Meta Ads</h3>
    <p>Token hanya tersimpan di database BMS dan hanya bisa dibaca admin. Gunakan token dengan izin <b>ads_read</b> saja.</p>
    <div class="fld" style="margin-top:16px"><label>ID akun iklan <span style="color:var(--primary)">*</span></label>
      <input id="adAcc" placeholder="act_1234567890" value="${esc(c.ad_account_id || '')}" autocomplete="off"></div>
    <div class="fld" style="margin-top:11px"><label>Access token <span style="color:var(--primary)">*</span></label>
      <input id="adTok" type="password" placeholder="${c.access_token ? 'Kosongkan bila tidak diganti' : 'EAAG…'}" autocomplete="off">
      <div class="hint">${c.access_token ? 'Token tersimpan: ••••' + esc(c.access_token.slice(-6)) : 'Dari System User di Meta Business Settings.'}</div></div>
    <div class="fld" style="margin-top:11px"><label>Hitung sebagai "hasil"</label>
      <select id="adRes">${Object.entries(RESULTS).map(([k, r]) => `<option value="${k}" ${(c.result_type || 'auto') === k ? 'selected' : ''}>${r.l}</option>`).join('')}</select>
      <div class="hint">Untuk iklan klik-ke-WhatsApp pilih "Chat". Otomatis = menyesuaikan tujuan tiap kampanye.</div></div>
    <div class="fld money" style="margin-top:11px"><label>Target biaya per hasil (opsional)</label>
      <input id="adTarget" inputmode="numeric" placeholder="mis. Rp25.000">
      <div class="hint">Kampanye di atas target ditandai "Perlu dicek".</div></div>
    <div id="adErr" class="ad-err"></div>
    <div class="acts">
      ${M.cfg ? '<button class="btn ghost" id="adDisc" style="flex:0 0 auto">Putuskan</button>' : ''}
      <button class="btn soft" data-mclose>Batal</button><button class="btn" id="adSave">Simpan & tes</button></div>`);
  money($('#adTarget'), c.target_cpr || 0);

  $('#adSave').onclick = async () => {
    const err = $('#adErr'), btn = $('#adSave');
    const row = {
      id:1, ad_account_id:actId($('#adAcc').value).replace(/\s/g, ''),
      access_token:$('#adTok').value.trim() || c.access_token || '',
      result_type:$('#adRes').value, target_cpr:moneyVal($('#adTarget')) || null
    };
    err.textContent = '';
    if(!/^act_\d{5,}$/.test(row.ad_account_id)){ err.textContent = 'ID akun iklan harus berupa angka, mis. act_1234567890.'; return; }
    if(!row.access_token){ err.textContent = 'Access token wajib diisi.'; return; }
    btn.disabled = true; btn.textContent = 'Mengetes koneksi…';
    try{
      const acc = await graph(row.ad_account_id, {fields:'name,currency,account_status'}, row);
      await api('meta_ads_config', {method:'POST', body:row, prefer:'resolution=merge-duplicates,return=minimal'});
      const changed = [];
      if(row.ad_account_id !== c.ad_account_id) changed.push(`akun ${row.ad_account_id}`);
      if(row.access_token !== c.access_token) changed.push('token diperbarui');
      if(row.result_type !== (c.result_type || 'auto')) changed.push(`hasil: ${RESULTS[row.result_type].l}`);
      if((row.target_cpr || null) !== (c.target_cpr ?? null)) changed.push(`target ${row.target_cpr ? cur(row.target_cpr, acc.currency) : '—'}`);
      await logAct(M.cfg ? 'update' : 'create', 'Meta Ads', acc.name || row.ad_account_id, changed.join(' · ') || null);
      M.cfg = row; M.account = acc; M.cache = {}; M.error = null;
      closeModal(); toast('Terhubung ke ' + (acc.name || 'Meta Ads'));
      RENDER.ads(); load(true);
    }catch(e){
      err.textContent = e.message;
      btn.disabled = false; btn.textContent = 'Simpan & tes';
    }
  };
  if($('#adDisc')) $('#adDisc').onclick = async () => {
    await api('meta_ads_config?id=eq.1', {method:'DELETE', prefer:'return=minimal'});
    await logAct('delete', 'Meta Ads', M.account?.name || c.ad_account_id, 'Koneksi diputus');
    M.cfg = null; M.account = null; M.cache = {}; M.error = null;
    closeModal(); toast('Koneksi Meta Ads diputus'); RENDER.ads();
  };
}
