/* LEAD (brief #1B) — calon client yang belum booking (DM Instagram, WhatsApp,
   referral, …). Diinput manual oleh admin; status & follow-up dikelola di sini. */
import { $, $$, S, F, RENDER, rp, esc, range, inRange, fmtDate, today, toast, empty, money, moneyVal,
         openModal, closeModal, confirmBox, api, logAct, describe, categories } from '../core.js';
import { normPeriod, periodButtons, bindPeriod, dISO } from '../datepicker.js';

const SORTS = [['newest','Lead terbaru'],['oldest','Lead terlama'],['fnear','Follow-up terdekat'],['flate','Follow-up terlambat']];
export const LEAD_STATUS = [
  {id:'NEW',         label:'Baru',          cls:'b-neutral'},
  {id:'CONTACTED',   label:'Dihubungi',     cls:'b-grey'},
  {id:'QUALIFIED',   label:'Tertarik',      cls:'b-warn'},
  {id:'NEGOTIATION', label:'Negosiasi',     cls:'b-warn'},
  {id:'WON',         label:'Jadi booking',  cls:'b-ok'},
  {id:'LOST',        label:'Tidak jadi',    cls:'b-err'}
];
const SOURCES = ['Instagram', 'WhatsApp', 'TikTok', 'Referral', 'Website', 'Facebook', 'Datang langsung'];
const statusOf = id => LEAD_STATUS.find(s => s.id === id) || LEAD_STATUS[0];
const statusBadge = id => `<span class="badge ${statusOf(id).cls}">${statusOf(id).label}</span>`;
const ICON_DEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';

/* nomor WA → format 62… untuk link wa.me */
const waNumber = v => { const d = String(v || '').replace(/\D/g, ''); return d.startsWith('0') ? '62' + d.slice(1) : d; };
const plusDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return dISO(d); };

/* view v_leads_board menghitung follow_up_state, jadi daftar dimuat ulang setelah menulis */
async function reloadLeads(){
  S.data.leads = await api('v_leads_board?select=*&order=created_at.desc');
}

RENDER.lead = () => {
  const f = F.lead;
  normPeriod(f);
  f.status = f.status || 'OPEN';
  const r = range(f.date, f.custom);
  let rows = S.data.leads.filter(l => f.date==='all' || inRange((l.created_at||'').slice(0,10), r));
  const inPeriod = rows;
  if(f.status === 'OPEN') rows = rows.filter(l => !['WON','LOST'].includes(l.status));
  else if(f.status !== 'ALL') rows = rows.filter(l => l.status === f.status);
  const rank = {OVERDUE:0, TODAY:1, SAFE:2, NONE:3, CLOSED:4};
  const sorters = {
    newest: (a,b)=>(b.created_at||'').localeCompare(a.created_at||''),
    oldest: (a,b)=>(a.created_at||'').localeCompare(b.created_at||''),
    fnear:  (a,b)=>(a.follow_up_date||'9999').localeCompare(b.follow_up_date||'9999'),
    flate:  (a,b)=> rank[a.follow_up_state]-rank[b.follow_up_state] || (a.follow_up_date||'').localeCompare(b.follow_up_date||'')
  };
  rows = [...rows].sort(sorters[f.sort]);
  const dot = s => ({OVERDUE:'<span class="badge b-err"><span class="d"></span>Terlambat</span>',
    TODAY:'<span class="badge b-warn"><span class="d"></span>Hari ini</span>',
    SAFE:'<span class="badge b-ok"><span class="d"></span>Terjadwal</span>',
    NONE:'<span class="badge b-grey">Belum dijadwalkan</span>',
    CLOSED:'<span class="badge b-grey">Selesai</span>'}[s]);

  const open = inPeriod.filter(l => !['WON','LOST'].includes(l.status));
  const won = inPeriod.filter(l => l.status === 'WON').length, lost = inPeriod.filter(l => l.status === 'LOST').length;
  const due = open.filter(l => ['OVERDUE','TODAY'].includes(l.follow_up_state)).length;
  $('#pgSub').textContent = `${rows.length} lead · ${rows.filter(l=>l.follow_up_state==='OVERDUE').length} follow-up terlambat`;

  $('#page').innerHTML = `
    <div class="grid g4" style="margin-bottom:14px">
      <div class="card kpi accent"><div class="lbl">Lead aktif</div><div class="val">${open.length}</div><div class="cap">belum jadi / batal</div></div>
      <div class="card kpi"><div class="lbl">Perlu di-follow-up</div><div class="val" style="${due ? 'color:var(--err)' : ''}">${due}</div><div class="cap">hari ini & terlambat</div></div>
      <div class="card kpi"><div class="lbl">Jadi booking</div><div class="val" style="color:var(--ok)">${won}</div><div class="cap">konversi ${won + lost ? Math.round(won / (won + lost) * 100) : 0}%</div></div>
      <div class="card kpi"><div class="lbl">Estimasi nilai</div><div class="val">${rp(open.reduce((n, l) => n + (l.estimated_value || 0), 0))}</div><div class="cap">dari lead aktif</div></div>
    </div>

    <div class="bk-bar">
      ${periodButtons('ld', f)}
      <label class="selchip"><span>Status</span><select id="ldStatus" aria-label="Status">
        <option value="OPEN" ${f.status==='OPEN'?'selected':''}>Lead aktif</option>
        <option value="ALL" ${f.status==='ALL'?'selected':''}>Semua status</option>
        ${LEAD_STATUS.map(s => `<option value="${s.id}" ${f.status===s.id?'selected':''}>${s.label}</option>`).join('')}
      </select></label>
      <label class="selchip"><span>Urutkan</span><select id="ldSort" aria-label="Urutkan">
        ${SORTS.map(([k, l]) => `<option value="${k}" ${k === f.sort ? 'selected' : ''}>${l}</option>`).join('')}
      </select></label>
      <button class="btn sm" id="ldAdd" style="margin-left:auto">+ Tambah Lead</button>
    </div>
    ${rows.length ? `<div class="card"><div class="tablewrap"><table>
      <thead><tr><th>Lead</th><th>Kategori</th><th>Status</th><th>Follow-up</th><th class="r">Estimasi</th><th class="r"></th></tr></thead>
      <tbody>${rows.map(l=>`<tr class="click" data-ld="${l.id}">
        <td><div class="tname">${esc(l.name)}</div><div class="tsub">${[l.source, l.whatsapp].filter(Boolean).map(esc).join(' · ') || '—'}</div>
          ${l.notes ? `<div class="tsub ld-note">${esc(l.notes)}</div>` : ''}</td>
        <td>${esc(l.category||'—')}</td>
        <td>${statusBadge(l.status)}</td>
        <td>${dot(l.follow_up_state)}<div class="tsub">${l.follow_up_date?fmtDate(l.follow_up_date):'—'}</div></td>
        <td class="r num">${l.estimated_value ? rp(l.estimated_value) : '—'}</td>
        <td class="r"><div class="rowacts">
          ${l.whatsapp?`<a class="btn wa sm" data-stop href="https://wa.me/${waNumber(l.whatsapp)}" target="_blank" rel="noopener" style="text-decoration:none">WhatsApp</a>`:''}
          <button class="ibtn" data-ldedit="${l.id}" title="Ubah lead" aria-label="Ubah lead">${ICON_EDIT}</button>
          <button class="ibtn del" data-lddel="${l.id}" title="Hapus lead" aria-label="Hapus lead">${ICON_DEL}</button>
        </div></td>
      </tr>`).join('')}</tbody></table></div></div>`
    : empty(S.data.leads.length ? 'Tidak ada lead' : 'Belum ada lead',
        S.data.leads.length ? 'Coba ubah filter status atau periode.' : 'Catat calon client dari DM Instagram, WhatsApp, atau referral lewat tombol + Tambah Lead.')}`;

  bindPeriod('ld', f, RENDER.lead);
  $('#ldSort').onchange = e => { f.sort = e.target.value; RENDER.lead(); };
  $('#ldStatus').onchange = e => { f.status = e.target.value; RENDER.lead(); };
  $('#ldAdd').onclick = () => leadForm(null);
  $$('[data-ld]').forEach(tr => tr.onclick = () => leadForm(S.data.leads.find(l => l.id === tr.dataset.ld)));
  $$('[data-stop]').forEach(a => a.onclick = e => e.stopPropagation());
  $$('[data-ldedit]').forEach(b => b.onclick = e => { e.stopPropagation(); leadForm(S.data.leads.find(l => l.id === b.dataset.ldedit)); });
  $$('[data-lddel]').forEach(b => b.onclick = e => { e.stopPropagation(); removeLead(b.dataset.lddel); });
};

/* ---------- tambah / ubah ---------- */
function leadForm(cur){
  const cats = categories();
  const quick = [['Besok', 1], ['3 hari', 3], ['1 minggu', 7]];
  openModal(`<h3>${cur ? 'Ubah lead' : 'Tambah lead'}</h3>
    <p>${cur ? `Dicatat ${fmtDate((cur.created_at||'').slice(0,10))}. Perubahan tercatat di Log Aktivitas.` : 'Calon client yang belum booking — dari DM, WhatsApp, referral, dll.'}</p>
    <div style="text-align:left;margin-top:16px">
      <div class="fld"><label>Nama <span style="color:var(--primary)">*</span></label><input id="lfName" value="${esc(cur?.name||'')}" placeholder="mis. Rina & Dimas"></div>
      <div class="fgrid two" style="margin-top:11px">
        <div class="fld"><label>WhatsApp</label><input id="lfWa" inputmode="tel" value="${esc(cur?.whatsapp||'')}" placeholder="08123456789"></div>
        <div class="fld"><label>Email</label><input id="lfMail" type="email" value="${esc(cur?.email||'')}" placeholder="opsional"></div>
      </div>
      <div class="fgrid two" style="margin-top:11px">
        <div class="fld"><label>Kategori</label><select id="lfCat"><option value="">— Pilih —</option>
          ${[...new Set([...cats, cur?.category].filter(Boolean))].map(c => `<option ${c === cur?.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
        <div class="fld"><label>Sumber</label><input id="lfSrc" list="lfSrcs" value="${esc(cur?.source||'')}" placeholder="mis. Instagram">
          <datalist id="lfSrcs">${SOURCES.map(s => `<option value="${s}">`).join('')}</datalist></div>
      </div>
      <div class="mlabel" style="margin-top:16px">Status</div>
      <div class="ld-status">${LEAD_STATUS.map(s => `<button type="button" class="${(cur?.status || 'NEW') === s.id ? 'on' : ''}" data-lfst="${s.id}">${s.label}</button>`).join('')}</div>
      <div class="fgrid two" style="margin-top:14px">
        <div class="fld"><label>Follow-up berikutnya</label><input type="date" id="lfDue" value="${cur?.follow_up_date||''}"></div>
        <div class="fld money"><label>Estimasi nilai</label><input id="lfVal" inputmode="numeric" placeholder="Rp0"></div>
      </div>
      <div class="chips" style="margin-top:8px">${quick.map(([l, n]) => `<button type="button" class="chip alt" data-lfq="${n}">${l}</button>`).join('')}
        <button type="button" class="chip alt" data-lfq="">Kosongkan</button></div>
      <div class="fld" style="margin-top:12px"><label>Catatan</label><textarea id="lfNotes" rows="3" placeholder="mis. tanya paket wedding Juni, minta pricelist">${esc(cur?.notes||'')}</textarea></div>
      <div id="lfErr" class="fl-err"></div>
    </div>
    <div class="acts">
      ${cur ? '<button class="btn soft" id="lfDel" style="flex:0 0 auto;color:var(--err)">Hapus</button>' : ''}
      <button class="btn soft" data-mclose>Batal</button><button class="btn" id="lfSave">${cur ? 'Simpan' : 'Tambah lead'}</button>
    </div>`);

  let status = cur?.status || 'NEW';
  const val = money($('#lfVal'), cur?.estimated_value || 0);
  $$('[data-lfst]').forEach(b => b.onclick = () => {
    status = b.dataset.lfst;
    $$('[data-lfst]').forEach(x => x.classList.toggle('on', x === b));
  });
  $$('[data-lfq]').forEach(b => b.onclick = () => { $('#lfDue').value = b.dataset.lfq ? plusDays(Number(b.dataset.lfq)) : ''; });
  if(cur) $('#lfDel').onclick = () => removeLead(cur.id);

  $('#lfSave').onclick = async () => {
    const name = $('#lfName').value.trim();
    const err = m => { const e = $('#lfErr'); e.textContent = m; e.style.display = m ? 'block' : 'none'; };
    if(!name) return err('Nama wajib diisi.');
    const row = {
      name, whatsapp: $('#lfWa').value.trim() || null, email: $('#lfMail').value.trim() || null,
      category: $('#lfCat').value || null, source: $('#lfSrc').value.trim() || null, status,
      follow_up_date: $('#lfDue').value || null, estimated_value: moneyVal(val), notes: $('#lfNotes').value.trim() || null
    };
    // nomor WA yang sama sudah tercatat sebagai lead lain?
    const wa = waNumber(row.whatsapp);
    const dup = wa && S.data.leads.find(l => l.id !== cur?.id && waNumber(l.whatsapp) === wa);
    if(dup && !cur && !$('#lfSave').dataset.confirm){
      $('#lfSave').dataset.confirm = '1'; $('#lfSave').textContent = 'Tetap tambah';
      return err(`Nomor ini sudah tercatat atas nama ${dup.name} (${statusOf(dup.status).label}). Klik "Tetap tambah" kalau memang lead berbeda.`);
    }
    const btn = $('#lfSave'); btn.disabled = true;
    try{
      if(cur){
        await api('leads?id=eq.' + cur.id, {method:'PATCH', body:row, prefer:'return=minimal'});
        const detail = describe({...cur, status: statusOf(cur.status).label}, {...row, status: statusOf(row.status).label});
        await reloadLeads();
        if(detail) await logAct(row.status !== cur.status ? 'status' : 'update', 'Lead', name, detail);
        toast('Lead diperbarui');
      } else {
        await api('leads', {method:'POST', body:row, prefer:'return=minimal'});
        await reloadLeads();
        await logAct('create', 'Lead', name, [row.source, row.category, statusOf(status).label].filter(Boolean).join(' · '));
        toast(name + ' ditambahkan');
      }
    }catch(e){ btn.disabled = false; return err('Gagal menyimpan: ' + e.message); }
    closeModal(); RENDER.lead();
  };
}

async function removeLead(id){
  const l = S.data.leads.find(x => x.id === id);
  if(!await confirmBox('Hapus lead?', `${l.name} akan dihapus permanen dari daftar lead.`)) return;
  try{
    await api('leads?id=eq.' + id, {method:'DELETE', prefer:'return=minimal'});
    S.data.leads = S.data.leads.filter(x => x.id !== id);
    await logAct('delete', 'Lead', l.name, statusOf(l.status).label);
    toast('Lead dihapus');
  }catch(e){ toast('Gagal menghapus: ' + e.message); }
  RENDER.lead();
}
