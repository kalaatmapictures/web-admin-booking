/* =====================================================================
   BOOKING DETAIL (brief #2, #3, #6, #10, #18), INVOICE (#11, #12),
   NOTIFIKASI (#20)
   ===================================================================== */
import { $, $$, S, F, RENDER, rp, esc, today, fmtDate, timeRange, initials, toast, money, moneyVal,
         openDrawer, openModal, closeModal, saveBooking, addPayment, crewBadge, payBadge,
         BOOKING_STATUSES, dpPercent, closeDrawer, deleteBooking } from '../core.js';
import { hasRole, rateFor } from '../freelancers.js';

const rerender = () => RENDER[S.page]();
/* jalankan aksi tulis; tampilkan galat tanpa membuat UI macet */
async function safely(fn){
  try{ await fn(); return true; }
  catch(e){ toast('Gagal menyimpan: ' + e.message); return false; }
}
/* 08xx → 628xx untuk wa.me */
export const waNumber = n => { const d = String(n||'').replace(/\D/g,''); return d.startsWith('0') ? '62' + d.slice(1) : d; };

/* Timestamp "floating" (tanpa Z) supaya jam tidak bergeser saat dibuka
   dari zona waktu lain — 08:00 tetap terbaca 08:00. */
const gcalStamp = (d,t,addH=0) => {
  const [H,M] = (t||'09:00').split(':').map(Number);
  const x = new Date(d+'T00:00:00'); x.setHours(H+addH, M, 0, 0);
  const p = n => String(n).padStart(2,'0');
  return `${x.getFullYear()}${p(x.getMonth()+1)}${p(x.getDate())}T${p(x.getHours())}${p(x.getMinutes())}00`;
};
function gcalUrl(b){
  const detail = [
    'Client: ' + b.client_display, 'Category: ' + b.service, 'Package: ' + b.package_name,
    'Photographer: ' + (b.photographer_name||'Belum ditugaskan'),
    'Videographer: ' + (b.videographer_name||'Belum ditugaskan'),
    'Notes: ' + (b.notes||'-')
  ].join('\n');
  const p = new URLSearchParams({
    action:'TEMPLATE',
    text:`${b.service} — ${b.client_display}`,
    dates: b.session_end_time
      ? `${gcalStamp(b.session_date,b.session_time)}/${gcalStamp(b.session_date,b.session_end_time)}`
      : `${gcalStamp(b.session_date,b.session_time)}/${gcalStamp(b.session_date,b.session_time,4)}`,
    details:detail, location:b.location||''
  });
  return 'https://calendar.google.com/calendar/render?' + p.toString();
}
function waUrl(b, name, wa, role){
  const msg = `Halo ${name},\n\nkamu mendapatkan assignment untuk project:\n\n`
    + `Client: ${b.client_display}\nKategori: ${b.service}\nPackage: ${b.package_name}\n`
    + `Tanggal: ${fmtDate(b.session_date,true)}\nJam: ${timeRange(b)}\nLokasi: ${b.location||'-'}\n`
    + (b.map_link ? `Titik lokasi: ${b.map_link}\n` : '')
    + `Role: ${role}\n\nMohon konfirmasi availability.\n\nTerima kasih.`;
  return `https://wa.me/${waNumber(wa)}?text=${encodeURIComponent(msg)}`;
}
function mailUrl(b, email, role){
  const subject = `Assignment Project — ${b.client_display} — ${fmtDate(b.session_date)}`;
  const body = [
    `Client: ${b.client_display}`, `Kategori: ${b.service}`, `Package: ${b.package_name}`,
    `Tanggal: ${fmtDate(b.session_date,true)}`, `Jam: ${timeRange(b)}`,
    `Lokasi: ${b.location||'-'}`,
    ...(b.map_link ? ['Titik lokasi: ' + b.map_link] : []),
    `Role: ${role}`, `Notes: ${b.notes||'-'}`,
    '', 'Google Calendar: ' + gcalUrl(b), '', 'Mohon konfirmasi availability.', '', 'Kalaatma Pictures'
  ].join('\n');
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
function clientWaUrl(b){
  const msg = `Halo ${b.client_display}, terima kasih sudah booking ${b.service} di Kalaatma Pictures.\n\n`
    + `Booking ID: ${b.booking_id}\nPaket: ${b.package_name}\nTanggal: ${fmtDate(b.session_date,true)}\nJam: ${timeRange(b)} WIB\n\n`;
  return `https://wa.me/${waNumber(b.whatsapp)}?text=${encodeURIComponent(msg)}`;
}

/* Hapus booking (dari drawer atau tabel Booking). Pembayaran & catatan kas
   dari pembayaran itu ikut terhapus, jadi disebutkan jelas di konfirmasi. */
export function confirmDeleteBooking(id){
  const b = S.data.bookings.find(x => x.id === id);
  if(!b) return;
  const pays = S.data.payments.filter(p => p.booking_id === id);
  const paid = pays.reduce((n, p) => n + p.amount, 0);
  openModal(`<div class="warnicon" style="background:var(--err-bg);color:var(--err)">🗑</div>
    <h3>Hapus booking ${esc(b.client_display)}?</h3>
    <p>${esc(b.booking_id)} · ${esc(b.service)} · ${fmtDate(b.session_date)}</p>
    ${pays.length ? `<div class="banner" style="margin:14px 0 0">${pays.length} pembayaran (${rp(paid)}) dan catatan kas-nya akan ikut terhapus.</div>` : ''}
    <p style="margin-top:12px">Booking dihapus permanen dan tidak bisa dikembalikan. Kalau client hanya batal dan datanya masih ingin disimpan, ubah statusnya ke <b>CANCELLED</b> saja.</p>
    <div class="acts">
      <button class="btn soft" data-mclose>Batal</button>
      ${b.status !== 'CANCELLED' ? '<button class="btn soft" id="dbCancel">Jadikan CANCELLED</button>' : ''}
      <button class="btn danger" id="dbDelete">Hapus permanen</button>
    </div>`);
  const cancel = $('#dbCancel');
  if(cancel) cancel.onclick = async () => {
    cancel.disabled = true;
    const ok = await safely(() => saveBooking(id, {status:'CANCELLED'}));
    closeModal(); if(ok) toast('Booking ditandai CANCELLED');
    if($('#drawer').classList.contains('open')) bookingDrawer(id);
    rerender();
  };
  $('#dbDelete').onclick = async () => {
    $('#dbDelete').disabled = true;
    const ok = await safely(() => deleteBooking(id));
    closeModal();
    if(ok){ closeDrawer(); toast(`Booking ${b.client_display} dihapus`); }
    rerender();
  };
}

export function bookingDrawer(id){
  const b = S.data.bookings.find(x=>x.id===id);
  if(!b) return;
  const pays = S.data.payments.filter(p=>p.booking_id===id);
  const pct = dpPercent();
  // freelancer muncul di semua peran yang dipegangnya (peran utama + peran di rate-nya)
  const opt = (role, sel) => S.data.freelancers.filter(f=>(f.is_active && (hasRole(f, role)||f.role==='OTHER')) || f.id===sel)
    .map(f=>{ const r = rateFor(f.id, b.service, role);
      return `<option value="${f.id}" ${sel===f.id?'selected':''}>${esc(f.name)}${r?` — ${rp(r.rate)}`:''}</option>`; }).join('');

  const crewCard = (role, roleLabel, name, wa, email, needKey, need, selKey, selVal) => `
    <div style="margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:9px;margin-bottom:8px">
        <b style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)">${roleLabel}</b>
        <label style="margin-left:auto;font-size:11.5px;color:var(--muted);display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" data-need="${needKey}" ${need?'checked':''} style="width:15px;height:15px;accent-color:var(--primary)"> dibutuhkan
        </label>
      </div>
      ${!need ? `<div class="linkrow"><span class="na">Tidak dibutuhkan pada booking ini.</span></div>` : name ? `
        <div class="crewbox">
          <span class="av">${initials(name)}</span>
          <div style="min-width:0"><div class="nm">${esc(name)}</div><div class="ct">${esc(wa||'—')} · ${esc(email||'—')}</div>
            <span class="badge b-ok" style="margin-top:4px"><span class="d"></span>Assigned</span></div>
        </div>
        <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:8px">
          ${wa?`<a class="btn wa sm" target="_blank" rel="noopener" style="text-decoration:none" href="${waUrl(b,name,wa,roleLabel)}">WhatsApp ${roleLabel}</a>`:''}
          ${email?`<a class="btn soft sm" style="text-decoration:none" href="${mailUrl(b,email,roleLabel)}">Email Freelancer</a>`:''}
        </div>`
      : `<div class="linkrow" style="background:var(--err-bg);color:#C13A40"><b>⚠ ${roleLabel.toUpperCase()} BELUM DITUGASKAN</b></div>`}
      ${need?`<div class="fld"><select data-sel="${selKey}">
        <option value="">— Pilih ${roleLabel} —</option>${opt(role, selVal)}</select></div>`:''}
    </div>`;

  const linkField = (key, label, val) => `
    <div class="fld" style="margin-bottom:9px">
      <label>${label}</label>
      <div style="display:flex;gap:7px">
        <input data-link="${key}" value="${esc(val||'')}" placeholder="Tempel link Google Drive">
        ${val?`<a class="btn soft sm" href="${esc(val)}" target="_blank" rel="noopener" style="text-decoration:none;flex:0 0 auto">Buka</a>`
             :`<span class="btn ghost sm" style="flex:0 0 auto;pointer-events:none">Belum ada</span>`}
      </div>
    </div>`;

  const ig = [b.client_instagram, b.bride_instagram, b.groom_instagram].filter(Boolean).join(' · ');
  const addons = b.add_ons || [];

  openDrawer(`
    <div class="dh">
      <div>
        <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--primary);font-weight:600">${esc(b.booking_id)}${b.source==='website' ? ' · dari website' : ''}</div>
        <h2>${esc(b.client_display)}</h2>
        <div class="tsub">${esc(b.service)}${b.sub_category ? ' · ' + esc(b.sub_category) : ''} · ${esc(b.package_name)}</div>
        <div class="tsub">${fmtDate(b.session_date)} · ${esc(timeRange(b))}</div>
        <div class="tsub">${esc(b.location||'—')}${b.map_link?` · <a href="${esc(b.map_link)}" target="_blank" rel="noopener">Buka titik lokasi</a>`:''}</div>
      </div>
      <button class="x" data-dclose>✕</button>
    </div>

    <div class="card" style="margin-bottom:13px">
      <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
        ${crewBadge(b.crew_status)} ${payBadge(b.payment_status)} ${b.invoice_number?`<span class="badge b-neutral">${esc(b.invoice_number)}</span>`:''}
      </div>
      <div class="fld" style="margin-top:12px"><label>Status booking</label>
        <select id="dbStatus">${BOOKING_STATUSES.map(s=>`<option ${b.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
    </div>

    <div class="card" style="margin-bottom:13px">
      <b style="font-size:13px">Data dari client</b>
      <div class="rowline" style="margin-top:6px"><span class="k">WhatsApp</span><span class="v">${esc(b.whatsapp||'—')}</span></div>
      ${ig ? `<div class="rowline"><span class="k">Instagram</span><span class="v">${esc(ig)}</span></div>` : ''}
      ${b.number_of_people ? `<div class="rowline"><span class="k">Jumlah orang</span><span class="v">${b.number_of_people} orang</span></div>` : ''}
      <div class="rowline"><span class="k">Add-on</span><span class="v">${addons.length ? addons.map(a => esc(a.name) + (a.qty > 1 ? ` ×${a.qty}` : '')).join(', ') : '—'}</span></div>
      ${b.notes ? `<div class="rowline"><span class="k">Request</span><span class="v" style="font-weight:400;max-width:70%">${esc(b.notes)}</span></div>` : ''}
      ${b.whatsapp ? `<a class="btn wa sm" style="margin-top:10px;text-decoration:none" target="_blank" rel="noopener" href="${clientWaUrl(b)}">WhatsApp Client</a>` : ''}
    </div>

    <div class="card" style="margin-bottom:13px">
      <b style="font-size:13px">Harga</b>
      <div class="tsub" style="margin-bottom:12px">Master paket ${rp(b.master_reference_price)} — tetap utuh walau harga di sini diubah.</div>
      <div class="fld money" style="margin-bottom:9px"><label>Harga Package</label><input id="pPkg" inputmode="numeric"></div>
      ${b.add_on_price ? `<div class="rowline" style="margin-bottom:9px"><span class="k">Add-on dari website</span><span class="v">${rp(b.add_on_price)}</span></div>` : ''}
      <div class="fld money" style="margin-bottom:9px"><label>Additional</label><input id="pAdd" inputmode="numeric"></div>
      <div class="fld money" style="margin-bottom:9px"><label>Extra Time</label><input id="pExt" inputmode="numeric"></div>
      <div class="fld money" style="margin-bottom:9px"><label>Transport</label><input id="pTrp" inputmode="numeric"></div>
      <div class="fld money" style="margin-bottom:9px"><label>Other Charge</label><input id="pOth" inputmode="numeric"></div>
      <div class="fld money" style="margin-bottom:9px"><label>Discount</label><input id="pDis" inputmode="numeric"></div>
      <div class="fld" style="margin-bottom:9px"><label>Jatuh tempo pelunasan</label><input type="date" id="pDue" value="${b.payment_due_date||''}"></div>
      <div class="rowline"><span class="k">Subtotal</span><span class="v" id="oSub">—</span></div>
      <div class="rowline big"><span class="k">Total Invoice</span><span class="v" id="oTot">—</span></div>
      <div class="rowline"><span class="k">DP ${pct}%</span><span class="v" id="oDp">—</span></div>
      <div class="rowline"><span class="k">Sudah dibayar</span><span class="v">${rp(b.paid_amount)}</span></div>
      <div class="rowline"><span class="k">Sisa</span><span class="v" id="oRem">—</span></div>
      <button class="btn block" id="savePrice" style="margin-top:13px">Simpan harga</button>
    </div>

    <div class="card" style="margin-bottom:13px">
      <b style="font-size:13px">Crew Assignment</b>
      <div class="tsub" style="margin-bottom:12px">${b.crew_status==='COMPLETE'?'🟢 Crew Complete':b.crew_status==='PARTIAL'?'🟡 Crew belum lengkap':'🔴 Crew belum lengkap'}</div>
      ${crewCard('PHOTOGRAPHER','Photographer', b.photographer_name, b.photographer_wa, b.photographer_email, 'needs_photographer', b.needs_photographer, 'photographer_id', b.photographer_id)}
      ${crewCard('VIDEOGRAPHER','Videographer', b.videographer_name, b.videographer_wa, b.videographer_email, 'needs_videographer', b.needs_videographer, 'videographer_id', b.videographer_id)}
    </div>

    <div class="card" style="margin-bottom:13px">
      <b style="font-size:13px">Google Calendar</b>
      <div class="tsub" style="margin-bottom:11px">${b.gcal_synced ? 'Event tersinkron.' : 'Integration not connected — belum ada kredensial Google OAuth.'}</div>
      <div style="display:flex;gap:7px;flex-wrap:wrap">
        <button class="btn soft sm" id="syncCal">Sync Google Calendar</button>
        <a class="btn sm" href="${gcalUrl(b)}" target="_blank" rel="noopener" style="text-decoration:none">Open Google Calendar</a>
      </div>
    </div>

    <div class="card" style="margin-bottom:13px">
      <b style="font-size:13px">Deliverable</b>
      <div class="tsub" style="margin-bottom:12px">Kosongkan kalau belum ada — tidak diisi link palsu.</div>
      ${linkField('photo_drive_link','Photo Drive Link', b.photo_drive_link)}
      ${linkField('video_drive_link','Video Drive Link', b.video_drive_link)}
      ${linkField('raw_file_link','Raw File Link', b.raw_file_link)}
      ${linkField('final_file_link','Final File Link', b.final_file_link)}
      <div class="fld" style="margin-bottom:9px"><label>Tanggal delivery</label><input type="date" data-link="delivery_date" value="${b.delivery_date||''}"></div>
      <button class="btn block" id="saveLinks">Simpan deliverable</button>
    </div>

    <div class="card" style="margin-bottom:13px">
      <div style="display:flex;align-items:center"><b style="font-size:13px">Pembayaran</b>
        <button class="btn soft sm" id="addPay" style="margin-left:auto">Catat pembayaran</button></div>
      <div style="margin-top:10px">${pays.length ? pays.map(p=>`
        <div class="rowline"><span class="k">${fmtDate(p.paid_at)} · ${esc(p.kind)}${p.method?' · '+esc(p.method):''}</span><span class="v">${rp(p.amount)}</span></div>`).join('')
        : '<div class="tsub">Belum ada pembayaran tercatat.</div>'}</div>
      <div class="tsub" style="margin-top:8px">Pembayaran otomatis tercatat juga di Keuangan / Kas.</div>
    </div>

    <div style="display:grid;gap:9px">
      <button class="btn block" id="openInv">Lihat Invoice</button>
      <button class="btn soft block" id="dlInvDirect">Unduh Invoice PDF</button>
    </div>

    <div class="dangerzone">
      <div><b>Hapus booking</b><div class="tsub">Untuk data testing atau calon client yang tidak jadi. Tidak bisa dibatalkan.</div></div>
      <button class="btn danger sm" id="delBooking">Hapus</button>
    </div>`);

  // pricing
  const inputs = {
    pkg: money($('#pPkg'), b.effective_package_price), add: money($('#pAdd'), b.additional_charge),
    ext: money($('#pExt'), b.extra_time_charge), trp: money($('#pTrp'), b.transport_charge),
    oth: money($('#pOth'), b.other_charge), dis: money($('#pDis'), b.discount)
  };
  const calc = () => {
    const sub = moneyVal(inputs.pkg)+(b.add_on_price||0)+moneyVal(inputs.add)+moneyVal(inputs.ext)+moneyVal(inputs.trp)+moneyVal(inputs.oth);
    const tot = sub - moneyVal(inputs.dis);
    $('#oSub').textContent = rp(sub); $('#oTot').textContent = rp(tot);
    $('#oDp').textContent = rp(Math.round(tot*pct/100)); $('#oRem').textContent = rp(tot - b.paid_amount);
  };
  calc(); Object.values(inputs).forEach(el => el.addEventListener('money', calc));
  $('#savePrice').onclick = async () => {
    const ok = await safely(() => saveBooking(id, {
      custom_package_price: moneyVal(inputs.pkg), additional_charge: moneyVal(inputs.add),
      extra_time_charge: moneyVal(inputs.ext), transport_charge: moneyVal(inputs.trp),
      other_charge: moneyVal(inputs.oth), discount: moneyVal(inputs.dis),
      payment_due_date: $('#pDue').value || null
    }));
    if(ok) toast('Harga tersimpan — master paket tidak berubah');
    bookingDrawer(id); rerender();
  };

  // crew
  $$('[data-sel]').forEach(s => s.onchange = async () => {
    if(await safely(() => saveBooking(id, {[s.dataset.sel]: s.value || null}))) toast('Crew diperbarui');
    bookingDrawer(id); rerender();
  });
  $$('[data-need]').forEach(c => c.onchange = async () => {
    await safely(() => saveBooking(id, {[c.dataset.need]: c.checked}));
    bookingDrawer(id); rerender();
  });

  // status change with crew guard
  $('#dbStatus').onchange = async e => {
    const next = e.target.value;
    const cur = S.data.bookings.find(x=>x.id===id);
    if(next === 'CONFIRMED' && cur.crew_status !== 'COMPLETE'){
      e.target.value = cur.status;
      openModal(`<div class="warnicon">⚠</div>
        <h3>Crew belum lengkap</h3>
        <p>Booking ini belum memiliki Photographer/Videographer yang ditugaskan.</p>
        <div style="margin-top:15px">
          <div class="rowline"><span class="k">Photographer</span><span class="v">${cur.photographer_name?esc(cur.photographer_name):'<span style="color:var(--err)">Belum ditugaskan</span>'}</span></div>
          <div class="rowline"><span class="k">Videographer</span><span class="v">${cur.videographer_name?esc(cur.videographer_name):'<span style="color:var(--err)">Belum ditugaskan</span>'}</span></div>
        </div>
        ${F.booking.requireCrew ? `<p style="margin-top:14px;color:var(--err)">Setting <b>Require Complete Crew Before Confirmation</b> sedang aktif, jadi konfirmasi diblokir sampai crew lengkap.</p>` : ''}
        <div class="acts">
          <button class="btn soft" id="goAssign">Assign Crew</button>
          ${F.booking.requireCrew ? '' : '<button class="btn" id="anyway">Confirm Anyway</button>'}
        </div>`);
      $('#goAssign').onclick = () => closeModal();
      const any = $('#anyway');
      if(any) any.onclick = async () => {
        const ok = await safely(() => saveBooking(id, {status:'CONFIRMED', crew_override_note:'Dikonfirmasi tanpa crew lengkap pada '+today()}));
        closeModal(); if(ok) toast('Dikonfirmasi — ditandai crew belum lengkap'); bookingDrawer(id); rerender();
      };
      return;
    }
    if(await safely(() => saveBooking(id, {status: next}))) toast('Status diperbarui');
    bookingDrawer(id); rerender();
  };

  $('#delBooking').onclick = () => confirmDeleteBooking(id);

  // deliverables
  $('#saveLinks').onclick = async () => {
    const patch = {};
    $$('[data-link]').forEach(i => patch[i.dataset.link] = i.value.trim() || null);
    if(await safely(() => saveBooking(id, patch))) toast('Deliverable tersimpan');
    bookingDrawer(id); rerender();
  };

  $('#syncCal').onclick = () => openModal(`<h3>Integration not connected</h3>
    <p>Sinkronisasi otomatis butuh kredensial Google Calendar API (OAuth client ID + secret) yang belum terpasang.
    Sementara itu tombol <b>Open Google Calendar</b> membuka form event yang sudah terisi data booking ini,
    tinggal disimpan manual.</p>
    <div class="acts"><button class="btn" data-mclose>Mengerti</button></div>`);

  $('#addPay').onclick = () => {
    const cur = S.data.bookings.find(x=>x.id===id);
    openModal(`<h3>Catat pembayaran</h3>
      <p>Sisa saat ini ${rp(cur.remaining_payment)}.</p>
      <div class="fld money" style="margin-top:16px"><label>Jumlah</label><input id="pyAmt" inputmode="numeric" placeholder="Rp0"></div>
      <div class="fld" style="margin-top:11px"><label>Jenis</label>
        <select id="pyKind"><option value="DP" ${cur.paid_amount<=0?'selected':''}>DP</option><option value="INSTALLMENT" ${cur.paid_amount>0?'selected':''}>Cicilan</option><option value="SETTLEMENT">Pelunasan</option><option value="REFUND">Refund</option></select></div>
      <div class="fld" style="margin-top:11px"><label>Metode</label><input id="pyMethod" placeholder="Transfer BRI / QRIS / Cash"></div>
      <div class="fld" style="margin-top:11px"><label>Tanggal</label><input id="pyDate" type="date" value="${today()}"></div>
      <div class="acts"><button class="btn soft" data-mclose>Batal</button><button class="btn" id="pySave">Simpan</button></div>`);
    const amt = money($('#pyAmt'), cur.paid_amount<=0 ? cur.dp_amount : 0);
    $('#pySave').onclick = async () => {
      if(moneyVal(amt) <= 0) return toast('Jumlah belum diisi');
      const ok = await safely(() => addPayment(id, {amount:moneyVal(amt), kind:$('#pyKind').value, method:$('#pyMethod').value.trim()||null, paid_at:$('#pyDate').value}));
      closeModal(); if(ok) toast('Pembayaran tercatat — masuk ke kas'); bookingDrawer(id); rerender();
    };
  };

  $('#openInv').onclick = () => showInvoice(id);
  $('#dlInvDirect').onclick = () => downloadInvoice(S.data.bookings.find(x => x.id === id));
}

/* =====================================================================
   PEMBUAT PDF INVOICE
   Ditulis sendiri tanpa library eksternal: PDF 1.4 dengan font bawaan
   Helvetica, jadi tidak perlu CDN dan tetap jalan tanpa internet.
   ===================================================================== */
const HELV_W = [
278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,
1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,
667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,
333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,
556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const HELVB_W = [
278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,
975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,
667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,
333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,
611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
/* karakter non-ASCII yang benar-benar dipakai invoice → kode WinAnsi + lebar */
const PDF_UNI = {'—':[0x97,1000],'–':[0x96,556],'·':[0xB7,278],'’':[0x92,222],'…':[0x85,1000],'“':[0x93,333],'”':[0x94,333],'×':[0xD7,584]};

function pdfCharW(ch, bold){
  const c = ch.charCodeAt(0);
  if(c >= 32 && c <= 126) return (bold ? HELVB_W : HELV_W)[c - 32];
  if(PDF_UNI[ch]) return PDF_UNI[ch][1];
  return 556;
}
const pdfTextW = (s, size, bold) => [...String(s)].reduce((w,ch) => w + pdfCharW(ch, bold), 0) * size / 1000;

function pdfEsc(s){
  let out = '';
  for(const ch of String(s)){
    const c = ch.charCodeAt(0);
    if(ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
    else if(c >= 32 && c <= 126) out += ch;
    else if(PDF_UNI[ch]) out += '\\' + PDF_UNI[ch][0].toString(8).padStart(3,'0');
    else if(c < 256) out += '\\' + c.toString(8).padStart(3,'0');
    else out += '?';
  }
  return out;
}
/* potong teks yang kepanjangan supaya tidak menabrak kolom sebelah */
function pdfClip(s, maxW, size, bold){
  s = String(s ?? '');
  if(pdfTextW(s, size, bold) <= maxW) return s;
  let cut = s;
  while(cut.length > 1 && pdfTextW(cut + '…', size, bold) > maxW) cut = cut.slice(0, -1);
  return cut + '…';
}

function pdfDoc(){
  const ops = [];
  const P = {
    W: 595.28, H: 841.89,
    text(s, x, y, {size=10, bold=false, align='left', color=[0.11,0.12,0.23]} = {}){
      const str = String(s ?? '');
      if(!str) return;
      const w = pdfTextW(str, size, bold);
      const tx = align === 'right' ? x - w : align === 'center' ? x - w/2 : x;
      ops.push(`BT /${bold?'F2':'F1'} ${size} Tf ${color[0]} ${color[1]} ${color[2]} rg 1 0 0 1 ${tx.toFixed(2)} ${y.toFixed(2)} Tm (${pdfEsc(str)}) Tj ET`);
    },
    line(x1, y, x2, {w=0.7, color=[0.9,0.91,0.97]} = {}){
      ops.push(`${color[0]} ${color[1]} ${color[2]} RG ${w} w ${x1.toFixed(2)} ${y.toFixed(2)} m ${x2.toFixed(2)} ${y.toFixed(2)} l S`);
    },
    build(){
      const content = ops.join('\n');
      const objs = [
        '<</Type/Catalog/Pages 2 0 R>>',
        '<</Type/Pages/Kids[3 0 R]/Count 1>>',
        `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${P.W} ${P.H}]/Resources<</Font<</F1 5 0 R/F2 6 0 R>>>>/Contents 4 0 R>>`,
        `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
        '<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>',
        '<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>'
      ];
      let out = '%PDF-1.4\n';
      const off = [0];
      objs.forEach((body, i) => { off.push(out.length); out += `${i+1} 0 obj\n${body}\nendobj\n`; });
      const xref = out.length;
      out += `xref\n0 ${objs.length+1}\n0000000000 65535 f \n`;
      for(let i = 1; i <= objs.length; i++) out += String(off[i]).padStart(10,'0') + ' 00000 n \n';
      out += `trailer\n<</Size ${objs.length+1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
      const bytes = new Uint8Array(out.length);
      for(let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xFF;
      return bytes;
    }
  };
  return P;
}

/* baris rincian invoice — dipakai versi layar maupun PDF */
function invoiceItems(b){
  const items = [['Package — ' + b.package_name, b.effective_package_price]];
  (b.add_ons || []).forEach(a => items.push([`Add-on — ${a.name}${a.qty > 1 ? ` ×${a.qty}` : ''}`, a.total]));
  if(b.additional_charge) items.push(['Additional', b.additional_charge]);
  if(b.extra_time_charge) items.push(['Extra Time', b.extra_time_charge]);
  if(b.transport_charge)  items.push(['Transport', b.transport_charge]);
  if(b.other_charge)      items.push(['Other Charge', b.other_charge]);
  if(b.discount)          items.push(['Discount', b.discount, true]);
  return items;
}
const PAY_TEXT = {FULLY_PAID:'Fully Paid',DP_PAID:'DP Paid',PARTIALLY_PAID:'Partially Paid',UNPAID:'Unpaid'};
const bankLine = () => {
  const bk = S.catalog?.settings?.bank;
  return bk ? `${bk.name} ${bk.accountNo} a.n. ${bk.accountName}` : '';
};

function invoicePDF(b){
  const p = pdfDoc();
  const INDIGO = [0.29,0.275,0.894], GREY = [0.54,0.56,0.71];
  const L = 56, R = p.W - 56;
  let y = 786;

  p.text('KALAATMA PICTURES', L, y, {size:15, bold:true});
  p.text('Telling Love Through Pictures', L, y-15, {size:8.5, color:GREY});
  p.text('INVOICE', R, y+2, {size:20, bold:true, align:'right', color:INDIGO});
  p.text(b.invoice_number || 'DRAFT — belum terbit', R, y-14, {size:9, align:'right', color:GREY});
  p.text(fmtDate(today(), true), R, y-26, {size:9, align:'right', color:GREY});
  y -= 40;
  p.line(L, y, R, {w:1.2, color:[0.86,0.87,0.95]});
  y -= 26;

  const col2 = L + 262;
  p.text('CLIENT', L, y, {size:8, bold:true, color:GREY});
  p.text('PROJECT', col2, y, {size:8, bold:true, color:GREY});
  y -= 15;
  p.text(pdfClip(b.client_display, 230, 10.5, true), L, y, {size:10.5, bold:true});
  p.text('Category: ' + b.service, col2, y, {size:9.5});
  y -= 13;
  p.text(b.whatsapp || '—', L, y, {size:9.5, color:GREY});
  p.text(pdfClip('Package: ' + b.package_name, 230, 9.5, false), col2, y, {size:9.5});
  y -= 13;
  p.text(b.client_instagram || b.bride_instagram || '', L, y, {size:9.5, color:GREY});
  p.text('Event Date: ' + fmtDate(b.session_date, true), col2, y, {size:9.5});
  y -= 13;
  p.text('Time: ' + timeRange(b), col2, y, {size:9.5});
  y -= 13;
  p.text(pdfClip('Location: ' + (b.location || '—'), 230, 9.5, false), col2, y, {size:9.5});
  y -= 30;

  p.text('DETAIL', L, y, {size:8, bold:true, color:GREY});
  y -= 16;
  p.text('ITEM', L, y, {size:8, bold:true, color:GREY});
  p.text('JUMLAH', R, y, {size:8, bold:true, align:'right', color:GREY});
  y -= 8;
  p.line(L, y, R);
  y -= 16;

  for(const [label, val, neg] of invoiceItems(b)){
    p.text(pdfClip(label, 340, 10, false), L, y, {size:10});
    p.text((neg ? '-' : '') + rp(val), R, y, {size:10, align:'right'});
    y -= 12;
    p.line(L, y, R, {w:0.5, color:[0.94,0.95,0.99]});
    y -= 14;
  }

  y += 6;
  p.line(L, y, R, {w:1.4, color:INDIGO});
  y -= 20;
  p.text('TOTAL', L, y, {size:13, bold:true, color:INDIGO});
  p.text(rp(b.total_invoice), R, y, {size:13, bold:true, align:'right', color:INDIGO});
  y -= 34;

  p.text('PAYMENT', L, y, {size:8, bold:true, color:GREY});
  y -= 18;
  const pay = (k, v, bold) => {
    p.text(k, L, y, {size:10, bold});
    p.text(v, R, y, {size:10, bold, align:'right'});
    y -= 12;
    p.line(L, y, R, {w:0.5, color:[0.94,0.95,0.99]});
    y -= 14;
  };
  pay('Total Invoice', rp(b.total_invoice));
  pay(`DP ${dpPercent()}%`, rp(b.dp_amount));
  pay('Paid', rp(b.paid_amount));
  pay('Remaining', rp(b.remaining_payment));
  pay('Payment Status', PAY_TEXT[b.payment_status] || '—', true);
  if(bankLine()){ y -= 4; p.text('Transfer ke: ' + bankLine(), L, y, {size:9, color:GREY}); }

  p.text('Kalaatma Pictures', p.W/2, 96, {size:11, bold:true, align:'center'});
  p.text('Telling Love Through Pictures', p.W/2, 82, {size:8.5, align:'center', color:GREY});
  p.line(L, 112, R, {w:1.2, color:[0.86,0.87,0.95]});
  return p.build();
}

export function downloadInvoice(b){
  const name = `Invoice-${b.invoice_number || b.booking_id}.pdf`;
  let url;
  try{
    url = URL.createObjectURL(new Blob([invoicePDF(b)], {type:'application/pdf'}));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    toast('PDF diunduh: ' + name);
    setTimeout(() => URL.revokeObjectURL(url), 20000);
  }catch(e){
    // sebagian browser memblokir unduhan dari iframe — buka di tab baru
    if(url) window.open(url, '_blank');
    else toast('Gagal membuat PDF: ' + e.message);
  }
}

let INVOICE_CURRENT = null;
export function showInvoice(id){
  const b = S.data.bookings.find(x=>x.id===id);
  INVOICE_CURRENT = b;
  const no = b.invoice_number || 'DRAFT — belum terbit';
  const line = (k,v,neg) => `<tr><td>${esc(k)}</td><td style="text-align:right">${neg?'−':''}${rp(v)}</td></tr>`;
  $('#invoiceDoc').innerHTML = `
    <div class="ih">
      <div><div class="co">KALAATMA PICTURES</div><div class="tg">Telling Love Through Pictures</div></div>
      <div class="rt"><div class="t">INVOICE</div>
        <div style="font-size:11px;color:#8A90BC">${esc(no)}</div>
        <div style="font-size:11px;color:#8A90BC">${fmtDate(today(),true)}</div></div>
    </div>

    <div style="display:flex;gap:30px;flex-wrap:wrap">
      <div style="flex:1;min-width:180px">
        <h4>Client</h4>
        <div style="font-weight:600">${esc(b.client_display)}</div>
        <div>${esc(b.whatsapp||'—')}</div>
        <div>${esc(b.client_instagram||b.bride_instagram||'')}</div>
      </div>
      <div style="flex:1;min-width:180px">
        <h4>Project</h4>
        <div>Category: <b>${esc(b.service)}</b></div>
        <div>Package: <b>${esc(b.package_name)}</b></div>
        <div>Event Date: <b>${fmtDate(b.session_date,true)}</b></div>
        <div>Time: <b>${esc(timeRange(b))}</b></div>
        <div>Location: <b>${esc(b.location||'—')}</b></div>
      </div>
    </div>

    <h4>Detail</h4>
    <table><thead><tr><th>Item</th><th style="text-align:right">Jumlah</th></tr></thead><tbody>
      ${invoiceItems(b).map(([k, v, neg]) => line(k, v, neg)).join('')}
      <tr class="tot"><td>TOTAL</td><td style="text-align:right">${rp(b.total_invoice)}</td></tr>
    </tbody></table>

    <h4>Payment</h4>
    <table><tbody>
      ${line('Total Invoice', b.total_invoice)}
      ${line(`DP ${dpPercent()}%`, b.dp_amount)}
      ${line('Paid', b.paid_amount)}
      ${line('Remaining', b.remaining_payment)}
      <tr><td>Payment Status</td><td style="text-align:right;font-weight:700">${PAY_TEXT[b.payment_status]}</td></tr>
    </tbody></table>
    ${bankLine() ? `<div style="margin-top:12px;font-size:11.5px;color:#8A90BC">Transfer ke: ${esc(bankLine())}</div>` : ''}

    <div class="ifoot"><b>Kalaatma Pictures</b>Telling Love Through Pictures</div>`;
  $('#invoiceModal').classList.add('open');
}
export function initInvoice(){
  $('#dlInv').onclick = () => { if(INVOICE_CURRENT) downloadInvoice(INVOICE_CURRENT); };
  $('#printInv').onclick = () => {
    try{ window.print(); }
    catch(e){ toast('Print diblokir browser — pakai tombol Unduh PDF'); }
  };
}

/* =====================================================================
   NOTIFIKASI (brief #20)
   ===================================================================== */
export function showNotifications(){
  const fresh = S.data.bookings.filter(b => b.status === 'NEW')
    .sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''))
    .map(b => ({id:b.id, text:`Booking baru: ${b.client_display} — ${b.service} ${b.package_name}, ${fmtDate(b.session_date)}.`, tone:'b-neutral'}));
  const list = S.data.bookings
    .filter(b => b.crew_status !== 'COMPLETE' && !['CANCELLED','COMPLETED'].includes(b.status))
    .sort((a,b)=>(a.session_date||'').localeCompare(b.session_date||''))
    .map(b => {
      const what = b.crew_status === 'NOT_ASSIGNED' ? 'crew lengkap'
        : (b.needs_photographer && !b.photographer_name) ? 'Photographer' : 'Videographer';
      return {id:b.id, text:`Booking ${b.client_display} pada ${fmtDate(b.session_date)} belum memiliki ${what}.`,
              tone: b.crew_status==='NOT_ASSIGNED'?'b-err':'b-warn'};
    });
  const overdue = S.data.bookings.filter(b=>b.payment_overdue)
    .map(b => ({id:b.id, text:`Pembayaran ${b.client_display} lewat jatuh tempo — sisa ${rp(b.remaining_payment)}.`, tone:'b-err'}));
  const all = [...fresh, ...list, ...overdue];

  openModal(`<h3>Notifikasi</h3>
    <p>${all.length ? all.length + ' hal butuh tindakan.' : 'Semua beres.'}</p>
    <div class="att" style="margin-top:16px">
      ${all.map(n=>`<button data-nb="${n.id}">
        <span class="badge ${n.tone}"><span class="d"></span></span>
        <span class="t">${esc(n.text)}</span></button>`).join('') ||
        '<div class="empty" style="padding:20px"><span>Tidak ada notifikasi.</span></div>'}
    </div>
    <div class="acts"><button class="btn soft" data-mclose>Tutup</button></div>`);
  $$('[data-nb]').forEach(b => b.onclick = () => { closeModal(); bookingDrawer(b.dataset.nb); });
}
