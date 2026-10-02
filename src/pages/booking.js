/* BOOKING (brief #1A, #15, #16, #19) — termasuk booking baru dari landing page */
import { $, $$, S, F, RENDER, rp, esc, today, range, inRange, fmtDate, timeRange,
         chipbar, customRange, crewBadge, statusBadge, payBadge, empty } from '../core.js';
import { bookingDrawer } from './detail.js';

RENDER.booking = () => {
  const f = F.booking, r = range(f.date, f.custom);
  let rows = S.data.bookings.filter(b => f.date==='all' || inRange(b.session_date, r));
  if(f.crew === 'attention')       rows = rows.filter(b=>b.needs_attention);
  else if(f.crew === 'incomplete') rows = rows.filter(b=>b.crew_status!=='COMPLETE');
  else if(f.crew !== 'all')        rows = rows.filter(b=>b.crew_status===f.crew);

  const sorters = {
    newest:  (a,b)=> (b.created_at||'').localeCompare(a.created_at||''),
    oldest:  (a,b)=> (a.created_at||'').localeCompare(b.created_at||''),
    // "terdekat" = yang akan datang lebih dulu, baru yang sudah lewat
    nearest: (a,b)=>{
      const t = today();
      const fa = (a.session_date||'9999') >= t, fb = (b.session_date||'9999') >= t;
      if(fa !== fb) return fa ? -1 : 1;
      return fa ? (a.session_date||'').localeCompare(b.session_date||'')
                : (b.session_date||'').localeCompare(a.session_date||'');
    },
    farthest:(a,b)=> (b.session_date||'9999').localeCompare(a.session_date||'9999')
  };
  rows = [...rows].sort(sorters[f.sort]);
  $('#pgSub').textContent = `${rows.length} booking`;

  $('#page').innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <div class="flabel">Filter waktu</div>
      ${chipbar([{v:'all',l:'Semua'},{v:'today',l:'Hari ini'},{v:'tomorrow',l:'Besok'},{v:'week',l:'Minggu ini'},{v:'nextweek',l:'Minggu depan'},{v:'month',l:'Bulan ini'},{v:'nextmonth',l:'Bulan depan'},{v:'custom',l:'Custom'}], f.date, v=>{f.date=v;RENDER.booking();})}
      ${f.date==='custom' ? '<div style="margin-top:10px">'+customRange(f.custom, c=>{f.custom=c;RENDER.booking();})+'</div>' : ''}
      <div class="flabel" style="margin-top:16px">Urutkan</div>
      ${chipbar([{v:'nearest',l:'Tanggal terdekat'},{v:'farthest',l:'Tanggal terjauh'},{v:'newest',l:'Terbaru'},{v:'oldest',l:'Terlama'}], f.sort, v=>{f.sort=v;RENDER.booking();}, true)}
      <div class="flabel" style="margin-top:16px">Crew status</div>
      ${chipbar([{v:'all',l:'All'},{v:'COMPLETE',l:'Complete'},{v:'PARTIAL',l:'Partial'},{v:'NOT_ASSIGNED',l:'Not Assigned'},{v:'incomplete',l:'Belum lengkap'},{v:'attention',l:'Needs Attention'}], f.crew, v=>{f.crew=v;RENDER.booking();}, true)}
      <label style="display:flex;align-items:center;gap:9px;margin-top:16px;font-size:12.5px;color:var(--ink-2);cursor:pointer">
        <input type="checkbox" id="reqCrew" ${f.requireCrew?'checked':''} style="width:17px;height:17px;accent-color:var(--primary)">
        Require Complete Crew Before Confirmation
      </label>
    </div>

    ${rows.length ? `<div class="card"><div class="tablewrap"><table>
      <thead><tr>
        <th>Client</th><th>Kategori</th><th>Tanggal</th><th>Crew Status</th><th>Status</th><th class="r">Total</th><th class="r">Payment</th>
      </tr></thead><tbody>
      ${rows.map(b=>`<tr class="click" data-b="${b.id}">
        <td><div class="tname">${esc(b.client_display)}${b.status==='NEW' && b.source==='website' ? ' <span class="badge b-neutral" style="font-size:10px;padding:2px 8px">Baru · Website</span>' : ''}</div>
          <div class="tsub">${esc(b.package_name)}${b.needs_attention?' · <span style="color:var(--err)">perlu perhatian</span>':''}</div></td>
        <td>${esc(b.service)}${b.sub_category ? `<div class="tsub">${esc(b.sub_category)}</div>` : ''}</td>
        <td>${fmtDate(b.session_date)}<div class="tsub">${esc(timeRange(b))}</div></td>
        <td>${crewBadge(b.crew_status)}
          ${b.crew_status!=='COMPLETE' ? `<div class="tsub" style="color:var(--err)">${
            b.needs_photographer && !b.photographer_name ? '⚠ Photographer belum ditugaskan<br>' : ''}${
            b.needs_videographer && !b.videographer_name ? '⚠ Videographer belum ditugaskan' : ''}</div>` : ''}</td>
        <td>${statusBadge(b.status)}</td>
        <td class="r num" style="font-weight:600">${rp(b.total_invoice)}</td>
        <td class="r">${payBadge(b.payment_status)}${b.payment_overdue?'<div class="tsub" style="color:var(--err)">overdue</div>':''}</td>
      </tr>`).join('')}
      </tbody></table></div></div>` : empty('Tidak ada booking','Coba longgarkan filternya.')}`;

  $('#reqCrew').onchange = e => f.requireCrew = e.target.checked;
  $$('[data-b]').forEach(tr => tr.onclick = () => bookingDrawer(tr.dataset.b));
};
