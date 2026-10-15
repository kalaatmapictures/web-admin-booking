/* DASHBOARD (brief #13, #14, #17) + aktivitas admin terbaru */
import { $, $$, S, F, RENDER, rp, esc, range, inRange, categories, go } from '../core.js';
import { normPeriod, periodButtons, bindPeriod, periodLabel } from '../datepicker.js';
import { activityFeed } from './activity.js';

RENDER.dashboard = () => {
  const f = F.dash;
  normPeriod(f);
  const r = range(f.date, f.custom);
  const CATEGORIES = categories();
  if(f.product !== 'All' && !CATEGORIES.includes(f.product)) f.product = 'All';
  const all = S.data.bookings.filter(b => b.status !== 'CANCELLED');
  const rows = all.filter(b => (f.product==='All' || b.service===f.product) && inRange(b.session_date, r));

  const revenue = rows.reduce((n,b)=>n+b.total_invoice,0);
  const profit  = rows.reduce((n,b)=>n+b.profit,0);
  const hpp     = rows.reduce((n,b)=>n+(b.hpp_snapshot||0)+(b.crew_cost||0),0);
  const clients = new Set(rows.map(b=>b.client_display)).size;
  const avg     = rows.length ? Math.round(revenue/rows.length) : 0;
  const fresh   = S.data.bookings.filter(b => b.status === 'NEW').length;

  const byCat = CATEGORIES.map(c => {
    const rs = rows.filter(b=>b.service===c);
    return {cat:c, revenue:rs.reduce((n,b)=>n+b.total_invoice,0), count:rs.length,
            profit:rs.reduce((n,b)=>n+b.profit,0), avg: rs.length?Math.round(rs.reduce((n,b)=>n+b.total_invoice,0)/rs.length):0};
  }).filter(x=>x.count>0).sort((a,b)=>b.revenue-a.revenue);
  const maxRev = Math.max(1, ...byCat.map(c=>c.revenue));
  const COLORS = ['#4A46E0','#6F6BF5','#1FB98A','#E8951F','#E4585E','#8A90BC'];

  // attention (selalu dari seluruh data, bukan hasil filter)
  const att = {
    fresh,
    noPh: all.filter(b=>b.needs_photographer && !b.photographer_name && b.status!=='COMPLETED').length,
    noVg: all.filter(b=>b.needs_videographer && !b.videographer_name && b.status!=='COMPLETED').length,
    part: all.filter(b=>b.crew_status==='PARTIAL' && b.status!=='COMPLETED').length,
    over: all.filter(b=>b.payment_overdue).length,
    deliv: all.filter(b=>['EVENT_DONE','DELIVERED'].includes(b.status) && b.delivery_missing).length
  };
  const attRow = (tone,label,n,filterKey) => n ? `
    <button data-att="${filterKey}">
      <span class="badge ${tone}"><span class="d"></span></span>
      <span class="t">${label}</span><span class="n">${n}</span>
    </button>` : '';

  const circ = 2*Math.PI*54; let off = 0;
  const donut = byCat.map((c,i) => {
    const frac = revenue ? c.revenue/revenue : 0;
    const seg = `<circle cx="74" cy="74" r="54" stroke="${COLORS[i%6]}" stroke-dasharray="${(frac*circ).toFixed(1)} ${circ}" stroke-dashoffset="${-off}"/>`;
    off += frac*circ; return seg;
  }).join('');

  $('#pgSub').textContent = `${f.product === 'All' ? 'Semua product' : f.product} · ${periodLabel(f)}`;

  $('#page').innerHTML = `
    <div class="bk-bar">
      <label class="selchip"><span>Product</span><select id="dashProduct" aria-label="Product">
        ${['All', ...CATEGORIES].map(c => `<option value="${esc(c)}" ${c===f.product?'selected':''}>${c==='All' ? 'Semua product' : esc(c)}</option>`).join('')}
      </select></label>
      ${periodButtons('dash', f)}
    </div>

    <div class="grid g4">
      <div class="card kpi accent"><div class="lbl">Omset</div><div class="val">${rp(revenue)}</div><div class="cap">${rows.length} booking</div></div>
      <div class="card kpi"><div class="lbl">Profit</div><div class="val">${rp(profit)}</div><div class="cap">HPP + crew ${rp(hpp)}</div></div>
      <div class="card kpi"><div class="lbl">Client</div><div class="val">${clients}</div><div class="cap">unik pada periode ini</div></div>
      <div class="card kpi"><div class="lbl">Avg Transaksi</div><div class="val">${rp(avg)}</div><div class="cap">per booking</div></div>
    </div>

    <div class="sec-h"><h3>Attention Required</h3></div>
    <div class="card">
      ${Object.values(att).some(Boolean) ? `<div class="att">
        ${attRow('b-neutral','Booking baru dari website belum diproses',att.fresh,'fresh')}
        ${attRow('b-err','Booking belum ada Photographer',att.noPh,'noph')}
        ${attRow('b-err','Booking belum ada Videographer',att.noVg,'novg')}
        ${attRow('b-warn','Booking crew belum lengkap',att.part,'partial')}
        ${attRow('b-err','Payment overdue',att.over,'overdue')}
        ${attRow('b-warn','Project belum punya link delivery',att.deliv,'deliv')}
      </div>` : `<div class="empty" style="padding:24px"><b>Semua aman</b><span>Tidak ada yang butuh perhatian.</span></div>`}
    </div>

    <div class="sec-h"><h3>Perbandingan Kategori</h3></div>
    <div class="grid g2">
      <div class="card">
        <div style="font-size:13px;font-weight:600">Revenue per kategori</div>
        ${byCat.length ? `<div class="bars">${byCat.map(c=>`
          <div class="bar"><div class="top"><span>${esc(c.cat)}</span><b>${rp(c.revenue)}</b></div>
          <div class="track"><div class="fill" style="width:${(c.revenue/maxRev*100).toFixed(1)}%"></div></div></div>`).join('')}</div>`
          : `<div class="empty" style="padding:22px"><span>Belum ada data pada periode ini.</span></div>`}
      </div>
      <div class="card">
        <div style="font-size:13px;font-weight:600">Porsi omset</div>
        ${byCat.length ? `<div class="donut-wrap">
          <svg class="donut" viewBox="0 0 148 148">${donut}</svg>
          <div class="legend">${byCat.map((c,i)=>`<div class="li"><span class="sw" style="background:${COLORS[i%6]}"></span>${esc(c.cat)}<span class="amt">${revenue?Math.round(c.revenue/revenue*100):0}%</span></div>`).join('')}</div>
        </div>` : `<div class="empty" style="padding:22px"><span>Belum ada data.</span></div>`}
      </div>
    </div>

    <div class="grid g3" style="margin-top:13px">
      ${byCat.map(c=>`<div class="card">
        <div style="display:flex;align-items:center;gap:8px"><b style="font-size:14px">${esc(c.cat)}</b>
          <button class="btn ghost sm" style="margin-left:auto" data-view="${esc(c.cat)}">View Detail</button></div>
        <div class="rowline"><span class="k">Revenue</span><span class="v">${rp(c.revenue)}</span></div>
        <div class="rowline"><span class="k">Booking</span><span class="v">${c.count}</span></div>
        <div class="rowline"><span class="k">Profit</span><span class="v">${rp(c.profit)}</span></div>
        <div class="rowline"><span class="k">Avg Transaksi</span><span class="v">${rp(c.avg)}</span></div>
      </div>`).join('')}
    </div>

    <div class="sec-h"><h3>Aktivitas Admin Terbaru</h3>
      <div class="right"><button class="btn ghost sm" id="dashAct">Lihat semua</button></div></div>
    <div class="card">${activityFeed(S.data.activity.slice(0, 6))}</div>`;

  $$('[data-view]').forEach(b => b.onclick = () => { F.dash.product = b.dataset.view; RENDER.dashboard(); });
  $('#dashProduct').onchange = e => { f.product = e.target.value; RENDER.dashboard(); };
  bindPeriod('dash', f, RENDER.dashboard);
  $$('[data-att]').forEach(b => b.onclick = () => {
    const k = b.dataset.att;
    F.booking.date = 'all';
    F.booking.crew = k==='fresh' ? 'all' : k==='partial' ? 'PARTIAL' : (k==='noph'||k==='novg') ? 'incomplete' : 'attention';
    F.booking.sort = k==='fresh' ? 'newest' : F.booking.sort;
    go(k === 'fresh' ? 'joblist' : 'booking');
  });
  $('#dashAct').onclick = () => go('activity');
};
