/* FREELANCER (brief #2, #8) */
import { $, $$, S, RENDER, rp, esc, today, fmtDate, initials, toast, money, moneyVal,
         openModal, closeModal, saveRow, insertRow, saveBooking } from '../core.js';
import { STAGES, stageOf } from '../stages.js';

const RATE_SUFFIX = {PER_PROJECT:'/project', PER_HOUR:'/jam', PER_DAY:'/hari'};
const rateLabel = f => rp(f.rate) + (RATE_SUFFIX[f.rate_type]||'');
export const ROLE_LABEL = {PHOTOGRAPHER:'Photographer', VIDEOGRAPHER:'Videographer', EDITOR:'Editor', ASSISTANT:'Assistant', WCC:'Wedding Content Creator', OTHER:'Lainnya'};
const CREW_SLOT = {PHOTOGRAPHER:'photographer_id', VIDEOGRAPHER:'videographer_id'};

RENDER.freelancer = () => {
  const rows = S.data.freelancers;
  const n = r => rows.filter(f => f.role === r).length;
  $('#pgSub').textContent = `${rows.filter(f=>f.is_active).length} aktif dari ${rows.length}`;

  const ov = [
    ['Total Freelancer', rows.length],
    ['Photographer', n('PHOTOGRAPHER')],
    ['Videographer', n('VIDEOGRAPHER')],
    ['Peran lain', rows.filter(f => !['PHOTOGRAPHER','VIDEOGRAPHER'].includes(f.role)).length]
  ].map(([l,v]) => `<div class="card kpi jb-ov"><div class="lbl">${l}</div><div class="val">${v}</div><div class="cap">orang</div></div>`).join('');

  $('#page').innerHTML = `
    <div class="grid g4">${ov}</div>
    <div class="sec-h"><h3>Daftar Freelancer</h3>
      <div class="right"><button class="btn sm" id="addFl">+ Tambah Freelancer</button></div></div>
    <div class="grid g3">${rows.map(f => {
      const jobs = S.data.bookings.filter(b => b.photographer_id === f.id || b.videographer_id === f.id);
      const upcoming = jobs.filter(b => b.session_date >= today() && b.status !== 'CANCELLED')
                           .sort((a,b) => a.session_date.localeCompare(b.session_date));
      const slot = CREW_SLOT[f.role];
      const open = slot ? S.data.bookings.filter(b => stageOf(b) && !b[slot] &&
        (f.role === 'PHOTOGRAPHER' ? b.needs_photographer : b.needs_videographer)).length : 0;
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
          <div class="rowline"><span class="k">Rate</span><span class="v">${rateLabel(f)}</span></div>
          <div class="rowline"><span class="k">WhatsApp</span><span class="v">${esc(f.whatsapp||'—')}</span></div>
          <div class="rowline"><span class="k">Email</span><span class="v fl-mail">${esc(f.email||'—')}</span></div>
          <div class="rowline"><span class="k">Jadwal mendatang</span><span class="v">${upcoming.length} project</span></div>
        </div>
        <div class="fl-sched">${upcoming.length
          ? upcoming.slice(0,2).map(b=>`${fmtDate(b.session_date)} — ${esc(b.client_display)}`).join('<br>')
          : 'Belum ada jadwal mendatang.'}</div>

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
            <button class="btn soft sm" data-edit="${f.id}">Rate</button>
          </div>
        </div>
      </div>`;}).join('')}</div>`;

  $$('[data-edit]').forEach(b => b.onclick = () => editRate(b.dataset.edit));
  $$('[data-flgear]').forEach(b => b.onclick = () => editGear(b.dataset.flgear));
  $$('[data-fldel]').forEach(b => b.onclick = () => delegateModal(b.dataset.fldel));
  $('#addFl').onclick = () => addFreelancer();
};

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
  const row = (b, action) => `<div class="deleg">
      <div style="min-width:0">
        <div class="dn">${esc(b.client_display)}</div>
        <div class="tsub">${esc(b.service)} · ${fmtDate(b.session_date)} · ${esc(b.session_time||'')}</div>
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

/* ---------- tambah freelancer ---------- */
function addFreelancer(){
  openModal(`<h3>Tambah Freelancer</h3>
    <p>Rate disimpan sebagai angka, tampilannya saja yang Rupiah.</p>
    <div class="fld" style="margin-top:16px"><label>Nama <span style="color:var(--primary)">*</span></label><input id="nfName" placeholder="Nama lengkap"></div>
    <div class="fgrid two" style="margin-top:11px">
      <div class="fld"><label>Peran</label>
        <select id="nfRole">${Object.entries(ROLE_LABEL).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></div>
      <div class="fld"><label>Rate type</label>
        <select id="nfType"><option value="PER_PROJECT">Per Project</option><option value="PER_HOUR">Per Hour</option><option value="PER_DAY">Per Day</option></select></div>
    </div>
    <div class="fld money" style="margin-top:11px"><label>Rate</label><input id="nfRate" inputmode="numeric" placeholder="Rp0"></div>
    <div class="fgrid two" style="margin-top:11px">
      <div class="fld"><label>WhatsApp</label><input id="nfWa" inputmode="tel" placeholder="6281234567890"></div>
      <div class="fld"><label>Email</label><input id="nfMail" type="email" placeholder="nama@kalaatma.id"></div>
    </div>
    <div class="fld" style="margin-top:11px"><label>Gear (satu per baris)</label>
      <textarea id="nfGear" rows="4" placeholder="Sony A7 III&#10;Lensa 24-70mm f/2.8"></textarea></div>
    <div id="nfErr" style="color:var(--err);font-size:12.5px;margin-top:10px;display:none"></div>
    <div class="acts"><button class="btn soft" data-mclose>Batal</button><button class="btn" id="nfSave">Simpan</button></div>`);
  const rate = money($('#nfRate'), 0);
  $('#nfSave').onclick = async () => {
    const name = $('#nfName').value.trim();
    if(!name){ $('#nfErr').textContent = 'Nama wajib diisi.'; $('#nfErr').style.display = 'block'; return; }
    await insertRow('freelancers', {
      name, role: $('#nfRole').value, rate: moneyVal(rate), rate_type: $('#nfType').value,
      whatsapp: $('#nfWa').value.trim() || null, email: $('#nfMail').value.trim() || null,
      gear: $('#nfGear').value.split('\n').map(x => x.trim()).filter(Boolean),
      is_active: true
    }, 'freelancers');
    closeModal(); RENDER.freelancer(); toast(name + ' ditambahkan');
  };
}

function editRate(id){
  const f = S.data.freelancers.find(x=>x.id===id);
  openModal(`<h3>Rate ${esc(f.name)}</h3>
    <p>Tampilan pakai Rupiah, database tetap menyimpan angka.</p>
    <div class="fld money" style="margin-top:16px"><label>Rate</label><input id="rtVal" inputmode="numeric"></div>
    <div class="fld" style="margin-top:11px"><label>Rate type</label>
      <select id="rtType">
        <option value="PER_PROJECT">Per Project</option><option value="PER_HOUR">Per Hour</option><option value="PER_DAY">Per Day</option>
      </select></div>
    <div class="fld" style="margin-top:11px"><label>Preview</label><input id="rtPrev" readonly></div>
    <div class="acts"><button class="btn soft" data-mclose>Batal</button><button class="btn" id="rtSave">Simpan</button></div>`);
  const v = money($('#rtVal'), f.rate), t = $('#rtType'); t.value = f.rate_type;
  const prev = () => $('#rtPrev').value = rp(moneyVal(v)) + (RATE_SUFFIX[t.value]||'');
  prev(); v.addEventListener('money', prev); t.onchange = prev;
  $('#rtSave').onclick = async () => {
    await saveRow('freelancers', id, {rate: moneyVal(v), rate_type: t.value}, 'freelancers');
    closeModal(); RENDER.freelancer(); toast('Rate diperbarui');
  };
}
