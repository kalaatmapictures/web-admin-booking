/* =====================================================================
   TASK AFTER EVENT — tab di halaman Joblist. Pekerjaan pasca-event per
   booking (edit foto, edit video, layout album, …) dengan papan status
   sendiri, terpisah dari papan tahap booking.
   ===================================================================== */
import { $, $$, S, RENDER, esc, today, fmtDate, initials, toast,
         openModal, closeModal, confirmBox, api, logAct, describe } from '../core.js';
import { bookingDrawer } from './detail.js';
import { uniq, rolesText } from '../freelancers.js';

export const TASK_STATUS = [
  {id:'TODO',        label:'Belum dikerjakan', color:'#6F76AC'},
  {id:'IN_PROGRESS', label:'Dikerjakan',       color:'#E8951F'},
  {id:'REVIEW',      label:'Review',           color:'#4A46E0'},
  {id:'DONE',        label:'Selesai',          color:'#1FB98A'}
];
const DEFAULT_TYPES = ['Edit Foto', 'Edit Video', 'Color Grading', 'Layout Album', 'Cetak Album', 'Kirim File ke Client'];
const STARTER = ['Edit Foto', 'Edit Video', 'Layout Album'];
const T = { assignee:'ALL', type:'ALL', drag:null };

const ICON_DEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';

const tasks = () => S.data.postTasks || [];
const bookingOf = t => S.data.bookings.find(b => b.id === t.booking_id);
const personOf = id => S.data.freelancers.find(f => f.id === id);
const taskTypes = () => uniq([...DEFAULT_TYPES, ...tasks().map(t => t.task_type)]);
const statusIx = id => TASK_STATUS.findIndex(s => s.id === id);
const isLate = t => t.status !== 'DONE' && t.due_date && t.due_date < today();
export const tasksOf = bookingId => tasks().filter(t => t.booking_id === bookingId);
const taskTarget = t => `${t.title} · ${bookingOf(t)?.client_display || '—'}`;
const showErr = (msg) => { const e = $('#tkErr'); e.textContent = msg; e.style.display = msg ? 'block' : 'none'; };

/* project yang event-nya sudah lewat tapi belum punya task sama sekali */
const needsTasks = () => S.data.bookings
  .filter(b => !['CANCELLED','COMPLETED','NEW','CONTACTED','WAITING_DP'].includes(b.status)
    && b.session_date && b.session_date <= today() && !tasksOf(b.id).length)
  .sort((a, b) => b.session_date.localeCompare(a.session_date));

export function renderTasks(tabs){
  const all = tasks();
  if(T.assignee !== 'ALL' && T.assignee !== 'NONE' && !personOf(T.assignee)) T.assignee = 'ALL';
  const rows = all.filter(t =>
    (T.assignee === 'ALL' || (T.assignee === 'NONE' ? !t.assignee_id : t.assignee_id === T.assignee)) &&
    (T.type === 'ALL' || t.task_type === T.type));
  const byStatus = Object.fromEntries(TASK_STATUS.map(s => [s.id, rows.filter(t => t.status === s.id)
    .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'))]));
  const late = rows.filter(isLate).length;
  const pending = needsTasks();
  $('#pgSub').textContent = `${rows.length} task · ${late} lewat deadline`;

  const kpis = TASK_STATUS.map(s => `<div class="card kpi jb-ov" data-tkjump="${s.id}">
      <div class="lbl">${s.label}</div><div class="val">${byStatus[s.id].length}</div><div class="cap">task</div></div>`).join('')
    + `<div class="card kpi"><div class="lbl">Lewat deadline</div><div class="val" style="${late ? 'color:var(--err)' : ''}">${late}</div><div class="cap">belum selesai</div></div>`;

  const people = S.data.freelancers.filter(f => f.is_active || all.some(t => t.assignee_id === f.id));
  const card = t => {
    const b = bookingOf(t), p = personOf(t.assignee_id), i = statusIx(t.status);
    return `<div class="jb-card tk-card" draggable="true" data-tk="${t.id}">
      <div class="lbs">${t.task_type ? `<span class="lb lb-blue">${esc(t.task_type)}</span>` : ''}${isLate(t) ? '<span class="lb lb-red">Lewat deadline</span>' : ''}</div>
      <div class="nm" data-tkedit="${t.id}">${esc(t.title)}</div>
      <div class="sub tk-client" data-tkbook="${t.booking_id}">${esc(b?.client_display || '—')}${b ? ` · ${esc(b.service)} · event ${fmtDate(b.session_date)}` : ''}</div>
      ${t.notes ? `<div class="tk-notes">${esc(t.notes)}</div>` : ''}
      <div class="jb-meta">
        <span class="mi" style="${isLate(t) ? 'color:var(--err);font-weight:600' : ''}">${t.due_date ? 'Deadline ' + fmtDate(t.due_date) : 'Tanpa deadline'}</span>
      </div>
      <div class="tk-who">${p
        ? `<span class="jb-av">${initials(p.name)}</span><span>${esc(p.name)}</span>`
        : '<span class="jb-av none">?</span><span class="tsub">Belum ada penanggung jawab</span>'}</div>
      <div class="jb-foot">
        <button data-tkmove="${t.id}" data-dir="-1" ${i <= 0 ? 'disabled' : ''} title="Mundur">‹</button>
        <button data-tkmove="${t.id}" data-dir="1" ${i >= TASK_STATUS.length - 1 ? 'disabled' : ''} title="Maju">›</button>
        <button class="lbbtn" data-tkedit="${t.id}">Ubah</button>
        <button class="lbbtn alt tk-del" data-tkdel="${t.id}" title="Hapus task" aria-label="Hapus task">${ICON_DEL}</button>
      </div>
    </div>`;
  };

  $('#page').innerHTML = `${tabs}
    ${S.data.tasksSchemaMissing ? `<div class="banner"><b>Database belum diperbarui.</b> Jalankan ulang <code>supabase/schema.sql</code> di Supabase supaya task bisa disimpan.</div>` : ''}
    <div class="grid tk-ov-grid">${kpis}</div>

    ${pending.length ? `<div class="card tk-pending">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <b style="font-size:13px">Event selesai, belum ada task (${pending.length})</b>
        <span class="tsub">Buat task supaya pekerjaan pasca-event tidak terlewat.</span>
      </div>
      <div class="tk-pend-list">${pending.slice(0, 6).map(b => `<div class="deleg">
        <div style="min-width:0"><div class="dn">${esc(b.client_display)}</div>
          <div class="tsub">${esc(b.service)} · event ${fmtDate(b.session_date)}</div></div>
        <button class="btn sm" data-tknew="${b.id}">Buat task</button></div>`).join('')}</div>
    </div>` : ''}

    <div class="bk-bar" style="margin-top:14px">
      <label class="selchip"><span>Penanggung jawab</span><select id="tkWho" aria-label="Penanggung jawab">
        <option value="ALL">Semua</option><option value="NONE" ${T.assignee === 'NONE' ? 'selected' : ''}>Belum ada</option>
        ${people.map(f => `<option value="${f.id}" ${T.assignee === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}
      </select></label>
      <label class="selchip"><span>Jenis</span><select id="tkType" aria-label="Jenis task">
        <option value="ALL">Semua jenis</option>
        ${taskTypes().map(x => `<option ${T.type === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}
      </select></label>
      <button class="btn sm" id="tkAdd" style="margin-left:auto">+ Tambah task</button>
    </div>

    <div class="jb-wrap tk-wrap">${TASK_STATUS.map(s => `<section class="jb-col" data-tkcol="${s.id}">
      <div class="jb-h"><span class="dot" style="background:${s.color}"></span>
        <span class="t">${s.label}</span><span class="c">${byStatus[s.id].length}</span></div>
      <div class="jb-list">${byStatus[s.id].map(card).join('') || '<div class="jb-empty">Belum ada task</div>'}</div>
    </section>`).join('')}</div>`;

  $('#tkWho').onchange = e => { T.assignee = e.target.value; RENDER.joblist(); };
  $('#tkType').onchange = e => { T.type = e.target.value; RENDER.joblist(); };
  $('#tkAdd').onclick = () => taskForm(null);
  $$('[data-tknew]').forEach(b => b.onclick = () => taskForm(null, b.dataset.tknew));
  $$('[data-tkedit]').forEach(b => b.onclick = e => { e.stopPropagation(); taskForm(all.find(t => t.id === b.dataset.tkedit)); });
  $$('[data-tkbook]').forEach(b => b.onclick = e => { e.stopPropagation(); bookingDrawer(b.dataset.tkbook); });
  $$('[data-tkdel]').forEach(b => b.onclick = e => { e.stopPropagation(); removeTask(b.dataset.tkdel); });
  $$('[data-tkmove]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    const t = all.find(x => x.id === b.dataset.tkmove);
    const next = TASK_STATUS[statusIx(t.status) + Number(b.dataset.dir)];
    if(next) moveTask(t, next.id);
  });
  $$('[data-tkjump]').forEach(b => b.onclick = () =>
    document.querySelector(`[data-tkcol="${b.dataset.tkjump}"]`)?.scrollIntoView({behavior:'smooth', block:'nearest', inline:'start'}));

  // drag & drop untuk desktop; tombol ‹ › untuk layar sentuh
  $$('.tk-card').forEach(c => {
    c.addEventListener('dragstart', e => { T.drag = c.dataset.tk; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try{ e.dataTransfer.setData('text/plain', c.dataset.tk); }catch(_){} });
    c.addEventListener('dragend', () => { c.classList.remove('dragging'); T.drag = null; });
  });
  $$('[data-tkcol]').forEach(col => {
    col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', () => col.classList.remove('over'));
    col.addEventListener('drop', e => {
      e.preventDefault(); col.classList.remove('over');
      const t = all.find(x => x.id === T.drag);
      if(t) moveTask(t, col.dataset.tkcol);
    });
  });
}

/* ---------- tulis data ---------- */
const doneAt = (status, prev) => status === 'DONE' ? (prev?.done_at || new Date().toISOString()) : null;

async function moveTask(t, status){
  if(t.status === status) return;
  const patch = {status, done_at: doneAt(status, t)};
  try{
    await api('post_tasks?id=eq.' + t.id, {method:'PATCH', body:patch, prefer:'return=minimal'});
    const before = {...t};
    Object.assign(t, patch);
    await logAct('status', 'Task', taskTarget(t), `Status: ${TASK_STATUS[statusIx(before.status)].label} → ${TASK_STATUS[statusIx(status)].label}`);
    toast(`${t.title} → ${TASK_STATUS[statusIx(status)].label}`);
  }catch(e){ toast('Gagal memindahkan: ' + e.message); }
  RENDER.joblist();
}

async function removeTask(id){
  const t = tasks().find(x => x.id === id);
  if(!await confirmBox('Hapus task?', `"${t.title}" untuk ${bookingOf(t)?.client_display || 'booking ini'} akan dihapus.`)) return;
  try{
    await api('post_tasks?id=eq.' + id, {method:'DELETE', prefer:'return=minimal'});
    S.data.postTasks = tasks().filter(x => x.id !== id);
    await logAct('delete', 'Task', taskTarget(t), null);
    toast('Task dihapus');
  }catch(e){ toast('Gagal menghapus: ' + e.message); }
  RENDER.joblist();
}

/* Tambah (bisa beberapa jenis sekaligus) atau ubah satu task */
export function taskForm(cur, presetBooking){
  const projects = S.data.bookings.filter(b => b.status !== 'CANCELLED' || b.id === cur?.booking_id)
    .sort((a, b) => (b.session_date || '').localeCompare(a.session_date || ''));
  const selBooking = cur?.booking_id || presetBooking || projects.find(b => b.session_date <= today())?.id || projects[0]?.id;
  const people = S.data.freelancers.filter(f => f.is_active || f.id === cur?.assignee_id);
  const personOpts = sel => `<option value="">— Belum ditentukan —</option>` + people.map(f =>
    `<option value="${f.id}" ${f.id === sel ? 'selected' : ''}>${esc(f.name)} · ${esc(rolesText(f))}</option>`).join('');

  openModal(`<h3>${cur ? 'Ubah task' : 'Tambah task after event'}</h3>
    <p>${cur ? 'Perubahan tercatat di Log Aktivitas.' : 'Pilih project lalu centang pekerjaan yang perlu dikerjakan — tiap jenis jadi satu task.'}</p>
    <div style="text-align:left;margin-top:16px">
      <div class="fld"><label>Project</label>
        <select id="tkBooking">${projects.map(b => `<option value="${b.id}" ${b.id === selBooking ? 'selected' : ''}>${esc(b.client_display)} · ${esc(b.service)} · ${fmtDate(b.session_date)}${b.session_date > today() ? ' (belum event)' : ''}</option>`).join('')}</select></div>

      ${cur ? `
        <div class="fld" style="margin-top:11px"><label>Judul task</label><input id="tkTitle" value="${esc(cur.title)}"></div>
        <div class="fgrid two" style="margin-top:11px">
          <div class="fld"><label>Jenis</label><input id="tkKind" list="tkKinds" value="${esc(cur.task_type || '')}" placeholder="mis. Edit Foto"></div>
          <div class="fld"><label>Status</label><select id="tkStatus">${TASK_STATUS.map(s => `<option value="${s.id}" ${s.id === cur.status ? 'selected' : ''}>${s.label}</option>`).join('')}</select></div>
        </div>
        <datalist id="tkKinds">${taskTypes().map(x => `<option value="${esc(x)}">`).join('')}</datalist>`
      : `
        <div class="mlabel" style="margin-top:16px">Pekerjaan</div>
        <div class="tk-types">${taskTypes().map(x => `<label class="tk-type"><input type="checkbox" value="${esc(x)}" ${STARTER.includes(x) ? 'checked' : ''}><span>${esc(x)}</span></label>`).join('')}</div>
        <div class="fld" style="margin-top:10px"><label>Pekerjaan lain (opsional)</label><input id="tkOther" placeholder="mis. Video Teaser, Retouch Cover"></div>`}

      <div class="fgrid two" style="margin-top:11px">
        <div class="fld"><label>Penanggung jawab</label><select id="tkWhoSel">${personOpts(cur?.assignee_id)}</select></div>
        <div class="fld"><label>Deadline</label><input type="date" id="tkDue" value="${cur?.due_date || ''}"></div>
      </div>
      <div class="tsub" id="tkDueHint" style="margin-top:6px"></div>
      <div class="fld" style="margin-top:11px"><label>Catatan (opsional)</label><textarea id="tkNotes" rows="3" placeholder="mis. pilih 50 foto terbaik, tone warm">${esc(cur?.notes || '')}</textarea></div>
      <div id="tkErr" class="fl-err"></div>
    </div>
    <div class="acts"><button class="btn soft" data-mclose>Batal</button><button class="btn" id="tkSave">${cur ? 'Simpan' : 'Buat task'}</button></div>`);

  // saran deadline: 14 hari setelah event, bila belum diisi
  const hint = () => {
    const b = S.data.bookings.find(x => x.id === $('#tkBooking').value);
    if(!b?.session_date || $('#tkDue').value){ $('#tkDueHint').innerHTML = ''; return; }
    const d = new Date(b.session_date + 'T00:00:00'); d.setDate(d.getDate() + 14);
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    $('#tkDueHint').innerHTML = `Saran: <button type="button" class="gear-edit" style="margin:0" id="tkDueSet">${fmtDate(v)} (14 hari setelah event)</button>`;
    $('#tkDueSet').onclick = () => { $('#tkDue').value = v; hint(); };
  };
  hint();
  $('#tkBooking').onchange = hint; $('#tkDue').onchange = hint;

  $('#tkSave').onclick = async () => {
    if(S.data.tasksSchemaMissing) return showErr('Jalankan schema.sql terbaru dulu supaya task bisa disimpan.');
    const booking_id = $('#tkBooking').value;
    if(!booking_id) return showErr('Pilih project dulu.');
    const common = {booking_id, assignee_id: $('#tkWhoSel').value || null, due_date: $('#tkDue').value || null,
                    notes: $('#tkNotes').value.trim() || null};
    const client = S.data.bookings.find(b => b.id === booking_id)?.client_display;
    const btn = $('#tkSave'); btn.disabled = true;
    try{
      if(cur){
        const title = $('#tkTitle').value.trim();
        if(!title){ btn.disabled = false; return showErr('Judul tidak boleh kosong.'); }
        const status = $('#tkStatus').value;
        const patch = {...common, title, task_type: $('#tkKind').value.trim() || null, status, done_at: doneAt(status, cur)};
        await api('post_tasks?id=eq.' + cur.id, {method:'PATCH', body:patch, prefer:'return=minimal'});
        const before = {...cur, status: TASK_STATUS[statusIx(cur.status)].label};
        Object.assign(cur, patch);
        const detail = describe(before, {...patch, status: TASK_STATUS[statusIx(status)].label});
        if(detail) await logAct('update', 'Task', taskTarget(cur), detail);
        toast('Task diperbarui');
      } else {
        const kinds = uniq([...$$('.tk-types input:checked').map(c => c.value), $('#tkOther').value.trim()]);
        if(!kinds.length){ btn.disabled = false; return showErr('Centang minimal satu pekerjaan.'); }
        const exist = new Set(tasksOf(booking_id).map(t => t.title.toLowerCase()));
        const fresh = kinds.filter(k => !exist.has(k.toLowerCase()));
        if(!fresh.length){ btn.disabled = false; return showErr('Semua pekerjaan itu sudah ada untuk project ini.'); }
        const saved = await api('post_tasks', {method:'POST', prefer:'return=representation',
          body: fresh.map(k => ({...common, title:k, task_type:k, status:'TODO'}))});
        S.data.postTasks.push(...saved);
        await logAct('create', 'Task', client, fresh.join(', '));
        toast(`${saved.length} task dibuat` + (fresh.length < kinds.length ? ` (${kinds.length - fresh.length} sudah ada)` : ''));
      }
    }catch(e){ btn.disabled = false; return showErr('Gagal menyimpan: ' + e.message); }
    closeModal(); RENDER[S.page]?.();
  };
}

/* ringkasan task untuk drawer detail booking */
export function taskSummary(bookingId){
  const list = tasksOf(bookingId);
  const done = list.filter(t => t.status === 'DONE').length;
  return {list, done, html: list.length ? list.map(t => {
    const s = TASK_STATUS[statusIx(t.status)], p = personOf(t.assignee_id);
    return `<div class="rowline"><span class="k">${esc(t.title)}${p ? ` · ${esc(p.name)}` : ''}${t.due_date ? ` · ${fmtDate(t.due_date)}` : ''}</span>
      <span class="v" style="color:${isLate(t) ? 'var(--err)' : s.color}">${s.label}</span></div>`;
  }).join('') : '<div class="tsub">Belum ada task.</div>'};
}
