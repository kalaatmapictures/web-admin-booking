/* COMPLETED CLIENT (brief #5, #6, #7) */
import { $, $$, S, F, RENDER, rp, esc, inRange, fmtDate, payBadge, statusBadge, empty } from '../core.js';
import { catGroups, catGroup } from '../stages.js';
import { calLabel, dateButton, bindDateButton } from '../datepicker.js';
import { bookingDrawer, showInvoice } from './detail.js';

RENDER.client = () => {
  const f = F.client;
  const cat = catGroup(f.cat); f.cat = cat.id;

  // Halaman ini khusus project yang sudah beres
  let rows = S.data.bookings.filter(b => ['COMPLETED','DELIVERED'].includes(b.status));
  const total = rows.length;
  if(cat.services) rows = rows.filter(b => cat.services.includes(b.service));
  rows = rows.filter(b => inRange(b.session_date, {from: f.from, to: f.to}));

  const sorters = {
    newest:(a,b)=>(b.created_at||'').localeCompare(a.created_at||''),
    oldest:(a,b)=>(a.created_at||'').localeCompare(b.created_at||''),
    shoot: (a,b)=>(b.session_date||'').localeCompare(a.session_date||''),
    deliv: (a,b)=>(b.delivery_date||'').localeCompare(a.delivery_date||''),
    name:  (a,b)=>a.client_display.localeCompare(b.client_display),
    cat:   (a,b)=>a.service.localeCompare(b.service),
    value: (a,b)=>b.total_invoice-a.total_invoice
  };
  rows = [...rows].sort(sorters[f.sort]);

  const bits = [`${rows.length} project selesai`];
  if(f.cat !== 'ALL') bits.push(cat.label);
  if(f.from || f.to) bits.push(calLabel(f.from, f.to, f.monthLabel));
  if(rows.length !== total) bits.push(`dari total ${total}`);
  $('#pgSub').textContent = bits.join(' · ');

  const drive = (url, label, short) => url
    ? `<a class="dlink" href="${esc(url)}" target="_blank" rel="noopener" title="${label}">${short}</a>`
    : `<span class="dlink off" title="Link belum tersedia">${short}</span>`;

  $('#page').innerHTML = `
    <div class="jb-bar">
      <label class="selchip"><span>Kategori</span><select id="clCat" aria-label="Kategori">
          ${catGroups().map(c => `<option value="${esc(c.id)}" ${f.cat===c.id?'selected':''}>${esc(c.label)}</option>`).join('')}
        </select></label>
      <div class="chips" style="margin-left:auto">${dateButton('clDate', f)}</div>
    </div>

    ${rows.length ? `<div class="card"><div class="tablewrap"><table>
      <thead><tr>
        <th>Client</th><th>Shooting</th><th>Delivery</th><th>Crew</th>
        <th class="r">Total invoice</th><th>Pembayaran</th><th>Project</th><th>Deliverable</th><th class="r"></th>
      </tr></thead>
      <tbody>${rows.map(b => `<tr class="click" data-clopen="${b.id}">
        <td>
          <div class="tname">${esc(b.client_display)}</div>
          <div class="tsub">${esc(b.service)} · ${esc(b.package_name)}</div>
        </td>
        <td>${fmtDate(b.session_date)}</td>
        <td>${b.delivery_date ? fmtDate(b.delivery_date) : '<span class="tsub">—</span>'}</td>
        <td>
          <div class="tsub">P: ${esc(b.photographer_name || '—')}</div>
          <div class="tsub">V: ${esc(b.videographer_name || '—')}</div>
        </td>
        <td class="r num" style="font-weight:600">${rp(b.total_invoice)}</td>
        <td>${payBadge(b.payment_status)}</td>
        <td>${statusBadge(b.status)}</td>
        <td data-stop><div class="dlinks">
          ${drive(b.photo_drive_link,'Open Photo','Foto')}
          ${drive(b.video_drive_link,'Open Video','Video')}
          ${drive(b.final_file_link,'Open Google Drive','Drive')}
        </div></td>
        <td class="r" data-stop>
          <button class="btn soft sm" data-clinv="${b.id}">Invoice</button>
        </td>
      </tr>`).join('')}</tbody></table></div></div>`
      : empty('Belum ada project selesai', total ? 'Tidak ada yang cocok dengan filter ini.' : 'Project akan muncul di sini setelah statusnya Delivered atau Completed.')}`;

  $('#clCat').onchange = e => { f.cat = e.target.value; RENDER.client(); };
  $$('[data-clopen]').forEach(r => r.onclick = e => { if(!e.target.closest('[data-stop]')) bookingDrawer(r.dataset.clopen); });
  $$('[data-clinv]').forEach(b => b.onclick = e => { e.stopPropagation(); showInvoice(b.dataset.clinv); });
  bindDateButton('clDate', f, RENDER.client);
};
