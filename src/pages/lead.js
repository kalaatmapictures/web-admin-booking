/* LEAD (brief #1B) */
import { $, S, F, RENDER, rp, esc, range, inRange, fmtDate, chipbar, customRange, empty } from '../core.js';

RENDER.lead = () => {
  const f = F.lead, r = range(f.date, f.custom);
  let rows = S.data.leads.filter(l => f.date==='all' || inRange((l.created_at||'').slice(0,10), r));
  const rank = {OVERDUE:0, TODAY:1, SAFE:2, NONE:3, CLOSED:4};
  const sorters = {
    newest: (a,b)=>(b.created_at||'').localeCompare(a.created_at||''),
    oldest: (a,b)=>(a.created_at||'').localeCompare(b.created_at||''),
    fnear:  (a,b)=>(a.follow_up_date||'9999').localeCompare(b.follow_up_date||'9999'),
    flate:  (a,b)=> rank[a.follow_up_state]-rank[b.follow_up_state] || (a.follow_up_date||'').localeCompare(b.follow_up_date||'')
  };
  rows = [...rows].sort(sorters[f.sort]);
  const dot = s => ({OVERDUE:'<span class="badge b-err"><span class="d"></span>Overdue</span>',
    TODAY:'<span class="badge b-warn"><span class="d"></span>Hari ini</span>',
    SAFE:'<span class="badge b-ok"><span class="d"></span>Aman</span>',
    NONE:'<span class="badge b-grey">Belum dijadwalkan</span>',
    CLOSED:'<span class="badge b-grey">Closed</span>'}[s]);
  $('#pgSub').textContent = `${rows.length} lead · ${rows.filter(l=>l.follow_up_state==='OVERDUE').length} overdue`;

  $('#page').innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <div class="flabel">Filter waktu</div>
      ${chipbar([{v:'all',l:'Semua'},{v:'today',l:'Hari ini'},{v:'last7',l:'7 hari terakhir'},{v:'last30',l:'30 hari terakhir'},{v:'month',l:'Bulan ini'},{v:'lastmonth',l:'Bulan lalu'},{v:'custom',l:'Custom'}], f.date, v=>{f.date=v;RENDER.lead();})}
      ${f.date==='custom' ? '<div style="margin-top:10px">'+customRange(f.custom, c=>{f.custom=c;RENDER.lead();})+'</div>' : ''}
      <div class="flabel" style="margin-top:16px">Urutkan</div>
      ${chipbar([{v:'newest',l:'Lead terbaru'},{v:'oldest',l:'Lead terlama'},{v:'fnear',l:'Follow-up terdekat'},{v:'flate',l:'Follow-up terlambat'}], f.sort, v=>{f.sort=v;RENDER.lead();}, true)}
    </div>
    ${rows.length ? `<div class="card"><div class="tablewrap"><table>
      <thead><tr><th>Lead</th><th>Kategori</th><th>Status</th><th>Follow-up</th><th class="r">Estimasi</th><th class="r">Aksi</th></tr></thead>
      <tbody>${rows.map(l=>`<tr>
        <td><div class="tname">${esc(l.name)}</div><div class="tsub">${esc(l.source||'')} · ${esc(l.whatsapp||'')}</div></td>
        <td>${esc(l.category||'—')}</td>
        <td><span class="badge b-grey">${esc(l.status)}</span></td>
        <td>${dot(l.follow_up_state)}<div class="tsub">${l.follow_up_date?fmtDate(l.follow_up_date):'—'}</div></td>
        <td class="r num">${rp(l.estimated_value)}</td>
        <td class="r">${l.whatsapp?`<a class="btn wa sm" href="https://wa.me/${esc(l.whatsapp)}" target="_blank" rel="noopener" style="text-decoration:none">WhatsApp</a>`:'—'}</td>
      </tr>`).join('')}</tbody></table></div></div>` : empty('Belum ada lead','Tidak ada lead pada rentang waktu ini.')}`;
};
