/* FREELANCER (brief #2, #8)
   Daftar freelancer + rate per event (rate type & event bisa diatur admin)
   + laporan seberapa sering tiap freelancer ditugaskan. */
import { $, $$, S, F, RENDER, rp, esc, today, fmtDate, initials, toast, money, moneyVal,
         openModal, closeModal, confirmBox, saveRow, saveBooking, api, logAct, describe } from '../core.js';
import { STAGES, stageOf } from '../stages.js';
import { calLabel, dateButton, bindDateButton, dISO } from '../datepicker.js';

export const ROLE_LABEL = {PHOTOGRAPHER:'Photographer', VIDEOGRAPHER:'Videographer', EDITOR:'Editor', ASSISTANT:'Assistant', WCC:'Wedding Content Creator', OTHER:'Lainnya'};
const CREW_SLOT = {PHOTOGRAPHER:'photographer_id', VIDEOGRAPHER:'videographer_id'};
const SLOT_LABEL = {photographer_id:'Photographer', videographer_id:'Videographer'};
const DEFAULT_RATE_TYPES = ['Per Project', 'Per Jam', 'Per Hari'];
const GENERAL_EVENT = 'Umum';

const ICON = {
  edit:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  del:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
  save:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'
};

/* ---------- pilihan rate type & event ---------- */
const options = kind => (S.data.freelancerOptions || []).filter(o => o.kind === kind);
const uniq = a => [...new Set(a.filter(Boolean))];
export const rateTypes = () => {
  const list = options('RATE_TYPE').map(o => o.label);
  return list.length ? list : DEFAULT_RATE_TYPES;
};
/* event dari daftar admin + yang sudah dipakai di rate (supaya nilai lama tetap terpilih) */
export const eventList = () => uniq([GENERAL_EVENT, ...options('EVENT').map(o => o.label),
  ...(S.data.freelancerRates || []).map(r => r.event)]);
const selectOpts = (list, sel) => uniq([...list, sel]).map(v => `<option ${v === sel ? 'selected' : ''}>${esc(v)}</option>`).join('');

/* ---------- rate per event ---------- */
export const ratesOf = id => (S.data.freelancerRates || []).filter(r => r.freelancer_id === id)
  .sort((a, b) => (a.event === GENERAL_EVENT) - (b.event === GENERAL_EVENT) || a.event.localeCompare(b.event));
const rateText = r => `${rp(r.rate)} <span class="tsub">· ${esc(r.rate_type)}</span>`;
/* rate yang berlaku untuk sebuah booking: event = nama layanan, kalau tidak ada pakai "Umum" */
export const rateFor = (fid, service) => {
  const list = ratesOf(fid);
  const lc = s => String(s || '').trim().toLowerCase();
  return list.find(r => lc(r.event) === lc(service)) || list.find(r => r.event === GENERAL_EVENT) || null;
};

const schemaBanner = () => S.data.flSchemaMissing
  ? `<div class="banner" style="margin-bottom:14px"><b>Database belum diperbarui.</b> Jalankan ulang <code>supabase/schema.sql</code>
     di Supabase SQL Editor supaya rate per event, rate type, dan event bisa disimpan.</div>` : '';
const needSchema = () => {
  if(!S.data.flSchemaMissing) return false;
  toast('Jalankan schema.sql terbaru di Supabase dulu'); return true;
};

/* =====================================================================
   HALAMAN
   ===================================================================== */
RENDER.freelancer = () => {
  const f = F.freelancer;
  const tabs = `<div class="fl-tabs">
      <button class="${f.tab === 'list' ? 'on' : ''}" data-fltab="list">Daftar Freelancer</button>
      <button class="${f.tab === 'report' ? 'on' : ''}" data-fltab="report">Laporan Penugasan</button>
    </div>`;
  if(f.tab === 'report') renderReport(tabs); else renderList(tabs);
  $$('[data-fltab]').forEach(b => b.onclick = () => { f.tab = b.dataset.fltab; RENDER.freelancer(); });
};

function renderList(tabs){
  const rows = S.data.freelancers;
  const n = r => rows.filter(f => f.role === r).length;
  $('#pgSub').textContent = `${rows.filter(f=>f.is_active).length} aktif dari ${rows.length}`;

  const ov = [
    ['Total Freelancer', rows.length],
    ['Photographer', n('PHOTOGRAPHER')],
    ['Videographer', n('VIDEOGRAPHER')],
    ['Peran lain', rows.filter(f => !['PHOTOGRAPHER','VIDEOGRAPHER'].includes(f.role)).length]
  ].map(([l,v]) => `<div class="card kpi jb-ov"><div class="lbl">${l}</div><div class="val">${v}</div><div class="cap">orang</div></div>`).join('');

  $('#page').innerHTML = `${tabs}${schemaBanner()}
    <div class="grid g4">${ov}</div>
    <div class="sec-h"><h3>Daftar Freelancer</h3>
      <div class="right">
        <button class="btn soft sm" id="flOpts">Atur Rate Type & Event</button>
        <button class="btn sm" id="addFl">+ Tambah Freelancer</button>
      </div></div>
    <div class="grid g3">${rows.map(f => {
      const jobs = S.data.bookings.filter(b => b.photographer_id === f.id || b.videographer_id === f.id);
      const upcoming = jobs.filter(b => b.session_date >= today() && b.status !== 'CANCELLED')
                           .sort((a,b) => a.session_date.localeCompare(b.session_date));
      const done = jobs.filter(b => b.status !== 'CANCELLED').length;
      const slot = CREW_SLOT[f.role];
      const open = slot ? S.data.bookings.filter(b => stageOf(b) && !b[slot] &&
        (f.role === 'PHOTOGRAPHER' ? b.needs_photographer : b.needs_videographer)).length : 0;
      const rates = ratesOf(f.id);
      return `<div class="card fl-card">
        <div class="fl-head">
          <span class="fl-av">${initials(f.name)}</span>
          <div style="min-width:0">
            <div class="fl-name">${esc(f.name)}</div>
            <div class="tsub">${ROLE_LABEL[f.role]||esc(f.role)}</div>
          </div>
          <span class="badge ${f.is_active?'b-ok':'b-grey'}">${f.is_active?'Aktif':'Nonaktif'}</span>
        </div>

        <div class="fl-rows">
          <div class="rowline"><span class="k">WhatsApp</span><span class="v">${esc(f.whatsapp||'—')}</span></div>
          <div class="rowline"><span class="k">Email</span><span class="v fl-mail">${esc(f.email||'—')}</span></div>
          <div class="rowline"><span class="k">Total penugasan</span><span class="v">${done} project</span></div>
          <div class="rowline"><span class="k">Jadwal mendatang</span><span class="v">${upcoming.length} project</span></div>
        </div>
        <div class="fl-sched">${upcoming.length
          ? upcoming.slice(0,2).map(b=>`${fmtDate(b.session_date)} — ${esc(b.client_display)}`).join('<br>')
          : 'Belum ada jadwal mendatang.'}</div>

        <div class="gear">
          <div class="gear-h">Rate per event
            <button class="gear-edit" data-edit="${f.id}">Kelola</button></div>
          ${rates.length
            ? `<div class="fl-rates">${rates.map(r => `<div class="fl-rate"><span class="ev">${esc(r.event)}</span><span class="v">${rateText(r)}</span></div>`).join('')}</div>`
            : `<div class="tsub">Belum ada rate.</div>`}
        </div>

        <div class="gear">
          <div class="gear-h">Gear yang dibawa
            <button class="gear-edit" data-flgear="${f.id}">Ubah</button></div>
          ${(f.gear||[]).length
            ? `<div class="gear-list">${f.gear.map(g=>`<span class="gear-c">${esc(g)}</span>`).join('')}</div>`
            : `<div class="tsub">Belum dicatat.</div>`}
        </div>

        <div class="fl-acts">
          ${slot
            ? `<button class="btn sm fl-main" data-fldel="${f.id}">Delegasikan${open?` <span class="fl-n">${open}</span>`:''}</button>`
            : `<span class="fl-note">Tidak ada slot crew untuk peran ini</span>`}
          <div class="fl-row2">
            ${f.whatsapp
              ? `<a class="btn wa sm" href="https://wa.me/${esc(f.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a>`
              : `<span class="btn sm fl-off">WhatsApp</span>`}
            ${f.email
              ? `<a class="btn soft sm" href="mailto:${esc(f.email)}">Email</a>`
              : `<span class="btn sm fl-off">Email</span>`}
            <button class="btn soft sm" data-flrep="${f.id}">Laporan</button>
          </div>
        </div>
      </div>`;}).join('')}</div>`;

  $$('[data-edit]').forEach(b => b.onclick = () => manageRates(b.dataset.edit));
  $$('[data-flgear]').forEach(b => b.onclick = () => editGear(b.dataset.flgear));
  $$('[data-fldel]').forEach(b => b.onclick = () => delegateModal(b.dataset.fldel));
  $$('[data-flrep]').forEach(b => b.onclick = () => freelancerReport(b.dataset.flrep));
  $('#addFl').onclick = () => addFreelancer();
  $('#flOpts').onclick = () => manageOptions();
}

/* ---------- gear ---------- */
function editGear(id){
  const f = S.data.freelancers.find(x => x.id === id);
  openModal(`<h3>Gear ${esc(f.name)}</h3>
    <p>Satu alat per baris. Dipakai untuk mengecek kesiapan sebelum hari H.</p>
    <div class="fld" style="margin-top:16px"><label>Daftar gear</label>
      <textarea id="gearTxt" rows="7" placeholder="Sony A7 III&#10;Lensa 24-70mm f/2.8&#10;Godox V1">${esc((f.gear||[]).join('\n'))}</textarea></div>
    <div class="acts"><button class="btn soft" data-mclose>Batal</button><button class="btn" id="gearSave">Simpan</button></div>`);
  $('#gearSave').onclick = async () => {
    const list = $('#gearTxt').value.split('\n').map(x => x.trim()).filter(Boolean);
    await saveRow('freelancers', id, {gear: list}, 'freelancers');
    closeModal(); RENDER.freelancer(); toast(list.length ? `${list.length} gear tercatat` : 'Gear dikosongkan');
  };
}

/* ---------- delegasi pekerjaan → langsung mengubah kartu Joblist ---------- */
function delegateModal(id){
  const f = S.data.freelancers.find(x => x.id === id);
  const slot = CREW_SLOT[f.role];
  const role = ROLE_LABEL[f.role];

  const openings = S.data.bookings
    .filter(b => stageOf(b) && !b[slot] && (f.role === 'PHOTOGRAPHER' ? b.needs_photographer : b.needs_videographer))
    .sort((a,b) => (a.session_date||'9999').localeCompare(b.session_date||'9999'));
  const mine = S.data.bookings.filter(b => b[slot] === f.id && stageOf(b))
    .sort((a,b) => (a.session_date||'9999').localeCompare(b.session_date||'9999'));

  const stageChip = b => {
    const st = STAGES.find(s => s.id === stageOf(b));
    return `<span class="lb" style="background:${st.bg};color:${st.fg}">${st.label}</span>`;
  };
  const rateNote = b => { const r = rateFor(f.id, b.service); return r ? ` · rate ${rp(r.rate)} (${esc(r.event)})` : ''; };
  const row = (b, action) => `<div class="deleg">
      <div style="min-width:0">
        <div class="dn">${esc(b.client_display)}</div>
        <div class="tsub">${esc(b.service)} · ${fmtDate(b.session_date)} · ${esc(b.session_time||'')}${rateNote(b)}</div>
        <div style="margin-top:5px">${stageChip(b)}</div>
      </div>${action}</div>`;

  openModal(`<h3>Delegasikan ke ${esc(f.name)}</h3>
    <p>${role} · penugasan langsung mengubah kartu di Joblist.</p>

    <div style="text-align:left;margin-top:18px">
      <div class="mlabel">Butuh ${role} (${openings.length})</div>
      <div style="margin-top:10px">${openings.length
        ? openings.map(b => row(b, `<button class="btn sm" data-assign="${b.id}">Tugaskan</button>`)).join('')
        : '<div class="tsub">Tidak ada booking yang butuh ' + role + ' saat ini.</div>'}</div>

      <div class="mlabel" style="margin-top:22px">Sedang ditangani (${mine.length})</div>
      <div style="margin-top:10px">${mine.length
        ? mine.map(b => row(b, `<button class="btn soft sm" data-unassign="${b.id}">Lepas</button>`)).join('')
        : '<div class="tsub">Belum ada penugasan.</div>'}</div>
    </div>
    <div class="acts"><button class="btn soft" data-mclose>Tutup</button></div>`);

  $$('[data-assign]').forEach(b => b.onclick = async () => {
    await saveBooking(b.dataset.assign, {[slot]: f.id});
    toast(`${f.name} ditugaskan — kartu Joblist diperbarui`);
    delegateModal(id); RENDER.freelancer();
  });
  $$('[data-unassign]').forEach(b => b.onclick = async () => {
    await saveBooking(b.dataset.unassign, {[slot]: null});
    toast('Penugasan dilepas');
    delegateModal(id); RENDER.freelancer();
  });
}

/* =====================================================================
   RATE PER EVENT
   ===================================================================== */
const rateDesc = r => `${r.event} · ${rp(r.rate)} ${r.rate_type}`;
const showErr = (sel, msg) => { const e = $(sel); e.textContent = msg; e.style.display = msg ? 'block' : 'none'; };
const isDup = (fid, event, type, exceptId) => ratesOf(fid).some(r => r.id !== exceptId &&
  r.event.toLowerCase() === event.toLowerCase() && r.rate_type.toLowerCase() === type.toLowerCase());

async function insertRates(f, rows){
  if(!rows.length) return;
  const saved = await api('freelancer_rates', {method:'POST', body:rows.map(r => ({...r, freelancer_id:f.id})), prefer:'return=representation'});
  S.data.freelancerRates.push(...saved);
  await logAct('create', 'Rate Freelancer', f.name, rows.map(rateDesc).join(' · '));
}

function manageRates(id, editId = null){
  const f = S.data.freelancers.find(x => x.id === id);
  const rates = ratesOf(id);
  const cur = editId ? rates.find(r => r.id === editId) : null;
  openModal(`<h3>Rate ${esc(f.name)}</h3>
    <p>Satu freelancer bisa punya rate berbeda untuk tiap event. Rate event <b>${GENERAL_EVENT}</b> dipakai bila event booking belum punya rate khusus.</p>
    ${schemaBanner()}
    <div style="text-align:left;margin-top:16px">
      ${rates.length ? `<div class="fl-ratelist">${rates.map(r => `<div class="fl-rate ${r.id === editId ? 'on' : ''}">
          <div style="min-width:0"><div class="ev">${esc(r.event)}</div>${r.note ? `<div class="tsub">${esc(r.note)}</div>` : ''}</div>
          <span class="v">${rateText(r)}</span>
          <button class="ibtn" data-rtedit="${r.id}" title="Ubah rate" aria-label="Ubah rate">${ICON.edit}</button>
          <button class="ibtn del" data-rtdel="${r.id}" title="Hapus rate" aria-label="Hapus rate">${ICON.del}</button>
        </div>`).join('')}</div>`
        : '<div class="tsub">Belum ada rate. Tambahkan di bawah.</div>'}

      <div class="mlabel" style="margin-top:20px">${cur ? 'Ubah rate' : 'Tambah rate'}</div>
      <div class="fgrid two" style="margin-top:10px">
        <div class="fld"><label>Event</label><select id="rtEvent">${selectOpts(eventList(), cur?.event ?? eventList()[0])}</select></div>
        <div class="fld"><label>Rate type</label><select id="rtType">${selectOpts(rateTypes(), cur?.rate_type ?? rateTypes()[0])}</select></div>
      </div>
      <div class="fgrid two" style="margin-top:11px">
        <div class="fld money"><label>Rate</label><input id="rtVal" inputmode="numeric" placeholder="Rp0"></div>
        <div class="fld"><label>Catatan (opsional)</label><input id="rtNote" placeholder="mis. termasuk transport" value="${esc(cur?.note || '')}"></div>
      </div>
      <div id="rtErr" class="fl-err"></div>
      <div style="display:flex;gap:8px;margin-top:12px">
        ${cur ? '<button class="btn soft sm" id="rtCancel">Batal ubah</button>' : ''}
        <button class="btn sm" id="rtSave" style="margin-left:auto">${cur ? 'Simpan perubahan' : '+ Tambah rate'}</button>
      </div>
      <div class="tsub" style="margin-top:10px">Pilihan event & rate type kurang? <button class="gear-edit" id="rtOpts" style="margin:0">Atur pilihan</button></div>
    </div>
    <div class="acts"><button class="btn soft" data-mclose>Selesai</button></div>`);

  const val = money($('#rtVal'), cur?.rate || 0);
  $$('[data-rtedit]').forEach(b => b.onclick = () => manageRates(id, b.dataset.rtedit));
  $('#rtCancel') && ($('#rtCancel').onclick = () => manageRates(id));
  $('#rtOpts').onclick = () => manageOptions(() => manageRates(id, editId));
  $$('[data-rtdel]').forEach(b => b.onclick = async () => {
    const r = rates.find(x => x.id === b.dataset.rtdel);
    if(!await confirmBox('Hapus rate?', `${rateDesc(r)} untuk ${f.name} akan dihapus.`)) return manageRates(id);
    try{
      await api('freelancer_rates?id=eq.' + r.id, {method:'DELETE', prefer:'return=minimal'});
      S.data.freelancerRates = S.data.freelancerRates.filter(x => x.id !== r.id);
      await logAct('delete', 'Rate Freelancer', f.name, rateDesc(r));
      toast('Rate dihapus');
    }catch(e){ toast('Gagal menghapus: ' + e.message); }
    manageRates(id); RENDER.freelancer();
  });
  $('#rtSave').onclick = async () => {
    if(needSchema()) return;
    const row = {event:$('#rtEvent').value, rate_type:$('#rtType').value, rate:moneyVal(val), note:$('#rtNote').value.trim() || null};
    if(isDup(id, row.event, row.rate_type, cur?.id)) return showErr('#rtErr', `Rate ${row.event} · ${row.rate_type} sudah ada — ubah yang lama saja.`);
    try{
      if(cur){
        await api('freelancer_rates?id=eq.' + cur.id, {method:'PATCH', body:row, prefer:'return=minimal'});
        const detail = describe(cur, row);
        Object.assign(cur, row);
        if(detail) await logAct('update', 'Rate Freelancer', f.name, `${cur.event}: ${detail}`);
        toast('Rate diperbarui');
      } else {
        await insertRates(f, [row]);
        toast('Rate ditambahkan');
      }
    }catch(e){ return showErr('#rtErr', 'Gagal menyimpan: ' + e.message); }
    manageRates(id); RENDER.freelancer();
  };
}

/* ---------- pilihan rate type & event (bisa diatur admin) ---------- */
function manageOptions(back){
  const section = (kind, title, hint, col) => {
    const list = options(kind);
    const used = label => (S.data.freelancerRates || []).filter(r => r[col] === label).length;
    return `<div class="mlabel" style="margin-top:18px">${title}</div>
      <div class="tsub" style="margin:4px 0 10px">${hint}</div>
      ${list.map(o => `<div class="fl-opt">
        <input value="${esc(o.label)}" data-optval="${o.id}" aria-label="${title}">
        <span class="tsub" style="white-space:nowrap">${used(o.label)} rate</span>
        <button class="ibtn" data-optsave="${o.id}" title="Simpan nama" aria-label="Simpan nama">${ICON.save}</button>
        <button class="ibtn del" data-optdel="${o.id}" title="Hapus" aria-label="Hapus">${ICON.del}</button>
      </div>`).join('') || '<div class="tsub">Belum ada.</div>'}
      <div class="fl-opt add">
        <input id="add_${kind}" placeholder="${kind === 'EVENT' ? 'mis. Corporate, Birthday' : 'mis. Per Sesi, Per 2 Jam'}">
        <button class="btn sm" data-optadd="${kind}">Tambah</button>
      </div>`;
  };
  openModal(`<h3>Rate Type & Event</h3>
    <p>Pilihan ini muncul saat mengisi rate freelancer. Mengganti nama juga mengganti nama di semua rate yang memakainya.</p>
    ${schemaBanner()}
    <div style="text-align:left">
      ${section('RATE_TYPE', 'Rate type', 'Cara freelancer dibayar.', 'rate_type')}
      ${section('EVENT', 'Event', `Samakan dengan nama layanan di Menu (mis. Wedding) supaya rate otomatis cocok dengan booking. "${GENERAL_EVENT}" selalu tersedia sebagai rate cadangan.`, 'event')}
      <div id="optErr" class="fl-err"></div>
    </div>
    <div class="acts">${back ? '<button class="btn soft" id="optBack">Kembali</button>' : ''}<button class="btn soft" data-mclose>Selesai</button></div>`);

  const reopen = () => { manageOptions(back); RENDER.freelancer(); };
  const colOf = kind => kind === 'EVENT' ? 'event' : 'rate_type';
  const nameOf = kind => kind === 'EVENT' ? 'Event' : 'Rate type';
  const dupMsg = e => /23505|duplicate/.test(e.message) ? 'Nama itu sudah ada.' : 'Gagal menyimpan: ' + e.message;
  $('#optBack') && ($('#optBack').onclick = back);

  $$('[data-optadd]').forEach(b => b.onclick = async () => {
    if(needSchema()) return;
    const kind = b.dataset.optadd, label = $('#add_' + kind).value.trim();
    if(!label) return showErr('#optErr', 'Nama tidak boleh kosong.');
    try{
      const [saved] = await api('freelancer_options', {method:'POST', prefer:'return=representation',
        body:{kind, label, sort_order: Math.max(0, ...options(kind).map(o => o.sort_order)) + 1}});
      S.data.freelancerOptions.push(saved);
      await logAct('create', nameOf(kind), label, null);
      toast(`${nameOf(kind)} "${label}" ditambahkan`);
    }catch(e){ return showErr('#optErr', dupMsg(e)); }
    reopen();
  });
  $$('[data-optsave]').forEach(b => b.onclick = async () => {
    const o = S.data.freelancerOptions.find(x => x.id === b.dataset.optsave);
    const label = $(`[data-optval="${o.id}"]`).value.trim();
    if(!label) return showErr('#optErr', 'Nama tidak boleh kosong.');
    if(label === o.label) return;
    const col = colOf(o.kind), old = o.label;
    try{
      await api('freelancer_options?id=eq.' + o.id, {method:'PATCH', body:{label}, prefer:'return=minimal'});
      await api(`freelancer_rates?${col}=eq.${encodeURIComponent(old)}`, {method:'PATCH', body:{[col]:label}, prefer:'return=minimal'});
      o.label = label;
      S.data.freelancerRates.forEach(r => { if(r[col] === old) r[col] = label; });
      await logAct('update', nameOf(o.kind), label, `Nama: ${old} → ${label}`);
      toast('Nama diperbarui');
    }catch(e){ return showErr('#optErr', dupMsg(e)); }
    reopen();
  });
  $$('[data-optdel]').forEach(b => b.onclick = async () => {
    const o = S.data.freelancerOptions.find(x => x.id === b.dataset.optdel);
    const n = S.data.freelancerRates.filter(r => r[colOf(o.kind)] === o.label).length;
    const ok = await confirmBox(`Hapus "${o.label}"?`, n
      ? `${n} rate masih memakai "${o.label}". Rate tersebut tetap tersimpan, hanya pilihannya yang hilang dari daftar.`
      : `"${o.label}" dihapus dari daftar pilihan.`);
    if(ok){
      try{
        await api('freelancer_options?id=eq.' + o.id, {method:'DELETE', prefer:'return=minimal'});
        S.data.freelancerOptions = S.data.freelancerOptions.filter(x => x.id !== o.id);
        await logAct('delete', nameOf(o.kind), o.label, null);
        toast('Dihapus');
      }catch(e){ toast('Gagal menghapus: ' + e.message); }
    }
    reopen();
  });
}

/* ---------- tambah freelancer (langsung dengan beberapa rate) ---------- */
function addFreelancer(){
  openModal(`<h3>Tambah Freelancer</h3>
    <p>Rate bisa lebih dari satu — berbeda untuk tiap event.</p>
    ${schemaBanner()}
    <div class="fld" style="margin-top:16px"><label>Nama <span style="color:var(--primary)">*</span></label><input id="nfName" placeholder="Nama lengkap"></div>
    <div class="fld" style="margin-top:11px"><label>Peran</label>
      <select id="nfRole">${Object.entries(ROLE_LABEL).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></div>

    <div style="text-align:left;margin-top:16px">
      <div class="mlabel">Rate per event</div>
      <div id="nfRates" style="margin-top:10px"></div>
      <button class="btn soft sm" id="nfAddRate" type="button">+ Tambah rate event</button>
    </div>

    <div class="fgrid two" style="margin-top:14px">
      <div class="fld"><label>WhatsApp</label><input id="nfWa" inputmode="tel" placeholder="6281234567890"></div>
      <div class="fld"><label>Email</label><input id="nfMail" type="email" placeholder="nama@kalaatma.id"></div>
    </div>
    <div class="fld" style="margin-top:11px"><label>Gear (satu per baris)</label>
      <textarea id="nfGear" rows="4" placeholder="Sony A7 III&#10;Lensa 24-70mm f/2.8"></textarea></div>
    <div id="nfErr" class="fl-err"></div>
    <div class="acts"><button class="btn soft" data-mclose>Batal</button><button class="btn" id="nfSave">Simpan</button></div>`);

  const addRow = event => {
    const el = document.createElement('div');
    el.className = 'fl-raterow';
    el.innerHTML = `
      <select data-k="event" aria-label="Event">${selectOpts(eventList(), event)}</select>
      <select data-k="type" aria-label="Rate type">${selectOpts(rateTypes(), rateTypes()[0])}</select>
      <div class="fld money"><input data-k="rate" inputmode="numeric" placeholder="Rp0" aria-label="Rate"></div>
      <button class="ibtn del" type="button" title="Hapus baris" aria-label="Hapus baris">${ICON.del}</button>`;
    money(el.querySelector('[data-k=rate]'), 0);
    el.querySelector('button').onclick = () => el.remove();
    $('#nfRates').appendChild(el);
  };
  addRow(GENERAL_EVENT);
  $('#nfAddRate').onclick = () => addRow(eventList().find(e => !$$('#nfRates [data-k=event]').some(s => s.value === e)) || GENERAL_EVENT);

  $('#nfSave').onclick = async () => {
    const name = $('#nfName').value.trim();
    if(!name) return showErr('#nfErr', 'Nama wajib diisi.');
    const rates = $$('#nfRates .fl-raterow').map(el => ({
      event: el.querySelector('[data-k=event]').value,
      rate_type: el.querySelector('[data-k=type]').value,
      rate: moneyVal(el.querySelector('[data-k=rate]'))
    })).filter(r => r.rate > 0);
    const keys = rates.map(r => (r.event + '|' + r.rate_type).toLowerCase());
    if(new Set(keys).size !== keys.length) return showErr('#nfErr', 'Ada rate dengan event & rate type yang sama dua kali.');
    if(rates.length && S.data.flSchemaMissing) return showErr('#nfErr', 'Jalankan schema.sql terbaru dulu supaya rate bisa disimpan.');

    const btn = $('#nfSave'); btn.disabled = true;
    try{
      const [f] = await api('freelancers', {method:'POST', prefer:'return=representation', body:{
        name, role: $('#nfRole').value,
        whatsapp: $('#nfWa').value.trim() || null, email: $('#nfMail').value.trim() || null,
        gear: $('#nfGear').value.split('\n').map(x => x.trim()).filter(Boolean),
        is_active: true
      }});
      S.data.freelancers.push(f);
      S.data.freelancers.sort((a, b) => a.name.localeCompare(b.name));
      await logAct('create', 'Freelancer', name, ROLE_LABEL[f.role]);
      await insertRates(f, rates);
    }catch(e){ btn.disabled = false; return showErr('#nfErr', 'Gagal menyimpan: ' + e.message); }
    closeModal(); RENDER.freelancer(); toast(name + ' ditambahkan');
  };
}

/* =====================================================================
   LAPORAN PENUGASAN
   Satu penugasan = freelancer terpasang sebagai photographer/videographer
   di sebuah booking (tidak termasuk yang dibatalkan), dihitung per tanggal sesi.
   ===================================================================== */
const MON_SHORT = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
const monthLabel = ym => { const [y, m] = ym.split('-'); return `${MON_SHORT[+m - 1]} ${y}`; };

function assignments(f){
  const out = [];
  for(const b of S.data.bookings){
    if(b.status === 'CANCELLED' || !b.session_date) continue;
    if(f.from && b.session_date < f.from) continue;
    if(f.to && b.session_date > f.to) continue;
    for(const slot of ['photographer_id', 'videographer_id']){
      if(!b[slot]) continue;
      if(f.role !== 'ALL' && f.role !== slot) continue;
      out.push({b, fid:b[slot], slot});
    }
  }
  return out;
}
function statsFor(fl, list){
  const mine = list.filter(a => a.fid === fl.id).sort((a, b) => a.b.session_date.localeCompare(b.b.session_date));
  const t = today();
  const count = key => mine.reduce((m, a) => (m[key(a)] = (m[key(a)] || 0) + 1, m), {});
  const fee = mine.reduce((n, a) => n + (rateFor(fl.id, a.b.service)?.rate || 0), 0);
  return {
    fl, jobs: mine, total: mine.length,
    ph: mine.filter(a => a.slot === 'photographer_id').length,
    vg: mine.filter(a => a.slot === 'videographer_id').length,
    events: Object.entries(count(a => a.b.service || '—')).sort((a, b) => b[1] - a[1]),
    months: count(a => a.b.session_date.slice(0, 7)),
    last: [...mine].reverse().find(a => a.b.session_date <= t)?.b.session_date || null,
    next: mine.find(a => a.b.session_date > t)?.b.session_date || null,
    fee
  };
}
/* deret bulan dari awal s/d akhir periode (maks 24 bulan terakhir) */
function monthSpan(f, list){
  const dates = list.map(a => a.b.session_date).sort();
  const from = (f.from || dates[0] || today()).slice(0, 7), to = (f.to || dates.at(-1) || today()).slice(0, 7);
  const out = [];
  let [y, m] = from.split('-').map(Number);
  while(`${y}-${String(m).padStart(2, '0')}` <= to){
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if(++m > 12){ m = 1; y++; }
  }
  return out.slice(-24);
}
const bars = (items, max) => `<div class="bars">${items.map(([label, v]) => `
  <div class="bar"><div class="top"><span>${esc(label)}</span><b>${v}×</b></div>
  <div class="track"><div class="fill" style="width:${max ? (v / max * 100).toFixed(1) : 0}%"></div></div></div>`).join('')}</div>`;

/* periode bawaan laporan: tahun berjalan */
function initReport(f){
  if(f.init) return;
  f.init = true;
  const y = new Date().getFullYear();
  f.from = dISO(new Date(y, 0, 1)); f.to = dISO(new Date(y, 11, 31)); f.monthLabel = null;
}

function renderReport(tabs){
  const f = F.freelancer;
  initReport(f);
  const list = assignments(f);
  const stats = S.data.freelancers.map(fl => statsFor(fl, list))
    .sort((a, b) => b.total - a.total || a.fl.name.localeCompare(b.fl.name));
  const used = stats.filter(s => s.total > 0);
  const idle = stats.filter(s => s.total === 0 && s.fl.is_active);
  const top = used[0];
  const max = top?.total || 0;
  const periode = calLabel(f.from, f.to, f.monthLabel);
  $('#pgSub').textContent = `${list.length} penugasan · ${periode}`;

  const months = monthSpan(f, list);
  const perMonth = months.map(ym => [monthLabel(ym), list.filter(a => a.b.session_date.startsWith(ym)).length]);
  const perEvent = Object.entries(list.reduce((m, a) => (m[a.b.service || '—'] = (m[a.b.service || '—'] || 0) + 1, m), {}))
    .sort((a, b) => b[1] - a[1]);

  $('#page').innerHTML = `${tabs}
    <div class="grid g4" style="margin-bottom:14px">
      <div class="card kpi accent"><div class="lbl">Total penugasan</div><div class="val">${list.length}</div><div class="cap">${new Set(list.map(a => a.b.id)).size} booking</div></div>
      <div class="card kpi"><div class="lbl">Freelancer terpakai</div><div class="val">${used.length}</div><div class="cap">dari ${S.data.freelancers.length} freelancer</div></div>
      <div class="card kpi"><div class="lbl">Paling sering</div><div class="val" style="font-size:20px">${top ? esc(top.fl.name) : '—'}</div><div class="cap">${top ? top.total + '× ditugaskan' : 'belum ada penugasan'}</div></div>
      <div class="card kpi"><div class="lbl">Belum ditugaskan</div><div class="val">${idle.length}</div><div class="cap">freelancer aktif di periode ini</div></div>
    </div>

    <div class="jb-bar">
      ${['ALL','photographer_id','videographer_id'].map(v => `<button class="chip alt ${f.role === v ? 'on' : ''}" data-flrole="${v}">${v === 'ALL' ? 'Semua peran' : 'Sebagai ' + SLOT_LABEL[v]}</button>`).join('')}
      <div class="chips" style="margin-left:auto">
        ${dateButton('flDate', f)}
        <button class="btn soft sm" id="flCsv">Export CSV</button>
      </div>
    </div>

    <div class="card"><div class="tablewrap"><table class="fl-rep">
      <thead><tr>
        <th>#</th><th>Freelancer</th><th style="min-width:160px">Frekuensi</th><th class="r">Photo</th><th class="r">Video</th>
        <th>Event terbanyak</th><th>Terakhir</th><th>Berikutnya</th><th class="r">Estimasi fee</th><th></th>
      </tr></thead>
      <tbody>${stats.map((s, i) => `<tr class="${s.total ? '' : 'fl-zero'}">
        <td class="tsub">${s.total ? i + 1 : '—'}</td>
        <td><div class="tname">${esc(s.fl.name)}</div><div class="tsub">${ROLE_LABEL[s.fl.role] || esc(s.fl.role)}${s.fl.is_active ? '' : ' · nonaktif'}</div></td>
        <td><div class="fl-freq"><b>${s.total}×</b><div class="track"><div class="fill" style="width:${max ? (s.total / max * 100).toFixed(1) : 0}%"></div></div></div></td>
        <td class="r num">${s.ph}</td><td class="r num">${s.vg}</td>
        <td>${s.events.slice(0, 3).map(([e, n]) => `<span class="badge b-grey" style="margin:0 4px 4px 0">${esc(e)} ${n}</span>`).join('') || '<span class="tsub">—</span>'}</td>
        <td style="white-space:nowrap">${s.last ? fmtDate(s.last) : '<span class="tsub">—</span>'}</td>
        <td style="white-space:nowrap">${s.next ? fmtDate(s.next) : '<span class="tsub">—</span>'}</td>
        <td class="r num">${s.fee ? rp(s.fee) : '<span class="tsub">—</span>'}</td>
        <td class="r"><button class="btn ghost sm" data-flrep="${s.fl.id}">Detail</button></td>
      </tr>`).join('') || `<tr><td colspan="10" class="tsub">Belum ada freelancer.</td></tr>`}</tbody>
    </table></div>
    <div class="tsub" style="margin-top:10px">Estimasi fee = 1× rate per penugasan, memakai rate event yang sama dengan layanan booking (atau rate "${GENERAL_EVENT}"). Rate per jam/hari tidak dikalikan durasi.</div>
    </div>

    <div class="grid g2" style="margin-top:13px">
      <div class="card"><div style="font-size:13px;font-weight:600">Penugasan per bulan</div>
        ${list.length ? bars(perMonth, Math.max(...perMonth.map(x => x[1]))) : '<div class="empty" style="padding:22px"><span>Belum ada penugasan pada periode ini.</span></div>'}</div>
      <div class="card"><div style="font-size:13px;font-weight:600">Penugasan per event</div>
        ${perEvent.length ? bars(perEvent, perEvent[0][1]) : '<div class="empty" style="padding:22px"><span>Belum ada data.</span></div>'}</div>
    </div>`;

  bindDateButton('flDate', f, RENDER.freelancer);
  $$('[data-flrole]').forEach(b => b.onclick = () => { f.role = b.dataset.flrole; RENDER.freelancer(); });
  $$('[data-flrep]').forEach(b => b.onclick = () => freelancerReport(b.dataset.flrep));
  $('#flCsv').onclick = () => downloadCsv(`kalaatma-penugasan-freelancer-${today()}.csv`,
    ['Freelancer','Peran','Total penugasan','Sebagai Photographer','Sebagai Videographer','Event','Terakhir','Berikutnya','Estimasi fee'],
    stats.map(s => [s.fl.name, ROLE_LABEL[s.fl.role] || s.fl.role, s.total, s.ph, s.vg,
      s.events.map(([e, n]) => `${e} (${n})`).join('; '), s.last || '', s.next || '', s.fee]));
}

/* laporan satu freelancer: semua job pada periode laporan */
function freelancerReport(id){
  const f = F.freelancer;
  initReport(f);
  const fl = S.data.freelancers.find(x => x.id === id);
  const list = assignments(f);
  const s = statsFor(fl, list);
  const months = monthSpan(f, s.jobs).filter(ym => s.months[ym]).map(ym => [monthLabel(ym), s.months[ym]]);
  const t = today();
  openModal(`<h3>Laporan ${esc(fl.name)}</h3>
    <p>${ROLE_LABEL[fl.role] || esc(fl.role)} · ${calLabel(f.from, f.to, f.monthLabel)}${f.role !== 'ALL' ? ' · sebagai ' + SLOT_LABEL[f.role] : ''}</p>
    <div style="text-align:left;margin-top:16px">
      <div class="fl-mini">
        <div><b>${s.total}×</b><span>ditugaskan</span></div>
        <div><b>${s.jobs.filter(a => a.b.session_date <= t).length}</b><span>sudah jalan</span></div>
        <div><b>${s.jobs.filter(a => a.b.session_date > t).length}</b><span>mendatang</span></div>
        <div><b>${s.fee ? rp(s.fee) : '—'}</b><span>estimasi fee</span></div>
      </div>
      ${s.events.length ? `<div class="mlabel" style="margin-top:18px">Per event</div>${bars(s.events, s.events[0][1])}` : ''}
      ${s.total ? `<div class="mlabel" style="margin-top:18px">Per bulan</div>${bars(months, Math.max(...months.map(x => x[1])))}` : ''}
      <div class="mlabel" style="margin-top:18px">Daftar penugasan (${s.total})</div>
      <div style="margin-top:10px">${s.jobs.length ? [...s.jobs].reverse().map(a => {
        const r = rateFor(fl.id, a.b.service);
        return `<div class="deleg"><div style="min-width:0">
          <div class="dn">${esc(a.b.client_display)}</div>
          <div class="tsub">${fmtDate(a.b.session_date)} · ${esc(a.b.service)} · ${SLOT_LABEL[a.slot]}</div>
        </div><span class="tsub" style="margin-left:auto;text-align:right;white-space:nowrap">${r ? rp(r.rate) + '<br>' + esc(r.rate_type) : 'tanpa rate'}</span></div>`;
      }).join('') : '<div class="tsub">Tidak ada penugasan pada periode ini. Ubah periode di tab Laporan Penugasan.</div>'}</div>
    </div>
    <div class="acts">
      ${s.total ? '<button class="btn soft" id="flJobCsv">Export CSV</button>' : ''}
      <button class="btn" data-mclose>Tutup</button>
    </div>`);
  $('#flJobCsv') && ($('#flJobCsv').onclick = () => downloadCsv(
    `kalaatma-penugasan-${fl.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${today()}.csv`,
    ['Tanggal','Client','Event','Sebagai','Status','Rate','Rate type'],
    s.jobs.map(a => { const r = rateFor(fl.id, a.b.service);
      return [a.b.session_date, a.b.client_display, a.b.service, SLOT_LABEL[a.slot], a.b.status, r?.rate ?? '', r?.rate_type ?? '']; })));
}

function downloadCsv(name, head, rows){
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [head.map(cell).join(',')].concat(rows.map(r => r.map(cell).join(',')));
  const blob = new Blob(['﻿' + lines.join('\n')], {type:'text/csv'});
  const a = Object.assign(document.createElement('a'), {href:URL.createObjectURL(blob), download:name});
  a.click(); URL.revokeObjectURL(a.href);
}
