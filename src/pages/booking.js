/* BOOKING (brief #1A, #15, #16, #19) — termasuk booking baru dari landing page */
import { $, $$, S, F, RENDER, rp, esc, today, range, inRange, fmtDate, timeRange,
         crewBadge, statusBadge, payBadge, empty } from '../core.js';
import { bookingDrawer, confirmDeleteBooking } from './detail.js';
import { calLabel, openCalendar } from '../datepicker.js';

const SORTS = [['nearest','Tanggal terdekat'],['farthest','Tanggal terjauh'],['newest','Terbaru'],['oldest','Terlama']];
const CREWS = [['all','Semua crew status'],['COMPLETE','Complete'],['PARTIAL','Partial'],['NOT_ASSIGNED','Not Assigned'],
               ['incomplete','Belum lengkap'],['attention','Needs Attention']];
const CAL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 11h18"/></svg>';
const selOpts = (list, v) => list.map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`).join('');

const TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>';

RENDER.booking = () => {
  const f = F.booking;
  // filter waktu hanya "Bulan ini" atau "Custom"; nilai lain (mis. dari Dashboard) = semua tanggal
  if(!['month','custom'].includes(f.date) || (f.date === 'custom' && !f.custom.from && !f.custom.to)) f.date = 'all';
  const r = range(f.date, f.custom);
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
    <div class="bk-bar">
      <div class="chips">
        <button class="chip ${f.date==='month'?'on':''}" id="bkMonth">Bulan ini</button>
        <button class="datebtn ${f.date==='custom'?'on':''}" id="bkCustom">${CAL_ICON}
          ${f.date==='custom' ? calLabel(f.custom.from, f.custom.to, f.custom.label) : 'Custom'}
          ${f.date==='custom' ? '<span class="x" data-clear>✕</span>' : ''}</button>
      </div>
      <label class="selchip"><span>Urutkan</span><select id="bkSort" aria-label="Urutkan">${selOpts(SORTS, f.sort)}</select></label>
      <label class="selchip"><span>Crew</span><select id="bkCrew" aria-label="Crew status">${selOpts(CREWS, f.crew)}</select></label>
      <label class="bk-req">
        <input type="checkbox" id="reqCrew" ${f.requireCrew?'checked':''}>
        Require Complete Crew Before Confirmation
      </label>
    </div>

    ${rows.length ? `<div class="card"><div class="tablewrap"><table>
      <thead><tr>
        <th>Client</th><th>Kategori</th><th>Tanggal</th><th>Crew Status</th><th>Status</th><th class="r">Total</th><th class="r">Payment</th><th class="r"></th>
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
        <td class="r"><button class="ibtn del" data-bdel="${b.id}" title="Hapus booking" aria-label="Hapus booking">${TRASH}</button></td>
      </tr>`).join('')}
      </tbody></table></div></div>` : empty('Tidak ada booking','Coba longgarkan filternya.')}`;

  $('#reqCrew').onchange = e => f.requireCrew = e.target.checked;
  $('#bkMonth').onclick = () => { f.date = f.date === 'month' ? 'all' : 'month'; RENDER.booking(); };
  $('#bkCustom').onclick = e => {
    if(e.target.hasAttribute('data-clear')){ f.date = 'all'; f.custom = {}; return RENDER.booking(); }
    openCalendar({from:f.custom.from, to:f.custom.to, label:f.custom.label, onApply: c => {
      f.custom = c; f.date = (c.from || c.to) ? 'custom' : 'all'; RENDER.booking();
    }});
  };
  $('#bkSort').onchange = e => { f.sort = e.target.value; RENDER.booking(); };
  $('#bkCrew').onchange = e => { f.crew = e.target.value; RENDER.booking(); };
  $$('[data-b]').forEach(tr => tr.onclick = () => bookingDrawer(tr.dataset.b));
  $$('[data-bdel]').forEach(btn => btn.onclick = e => { e.stopPropagation(); confirmDeleteBooking(btn.dataset.bdel); });
};
