/* =====================================================================
   TASK BOARD — papan tugas ala Trello: board → kolom → kartu.
   Sinkron dengan Joblist lewat database (supabase/schema.sql):
   • booking masuk tahap baru → tugas SOP tahap itu dibuat otomatis
     di board "Produksi Project" (trigger bookings_tasks + Template SOP)
   • crew booking diganti → tugas photographer/videographer ikut pindah PIC
   • kartu Joblist & detail booking menampilkan progres tugas tahapnya
   ===================================================================== */
import { $, $$, S, RENDER, esc, today, iso, fmtDate, initials, toast, api, logAct, describe,
         openModal, closeModal, go, rerender, refreshBell, confirmBox } from '../core.js';
import { STAGES, stageOf } from '../stages.js';
import { bookingDrawer, DRAWER_SECTIONS } from './detail.js';
import { ago } from './activity.js';

const TB = { board:null, q:'', who:'', project:'', due:'', hideDone:false, drag:null, adding:null };

export const PRIORITY = {
  LOW:    {text:'Rendah', cls:'lb-grey'},
  NORMAL: {text:'Normal', cls:'lb-grey'},
  HIGH:   {text:'Tinggi', cls:'lb-orange'},
  URGENT: {text:'Urgent', cls:'lb-red'}
};
const LABEL_COLORS = ['red','orange','green','teal','blue','grey'];
const BOARD_COLORS = ['#4A46E0','#E8951F','#137285','#1FB98A','#E4585E','#6F76AC','#1B1D3A'];
const ROLE_TEXT = {PHOTOGRAPHER:'Photographer', VIDEOGRAPHER:'Videographer'};

const IC = {
  cal:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 11h18"/></svg>',
  chk:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  msg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  txt:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  tick:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>'
};

/* ---------- baca data ---------- */
const byPos = (a, b) => a.position - b.position;
const boards = () => [...S.data.taskBoards].sort(byPos);
const boardOf = id => S.data.taskBoards.find(b => b.id === id);
const listsOf = boardId => S.data.taskLists.filter(l => l.board_id === boardId).sort(byPos);
const listOf = id => S.data.taskLists.find(l => l.id === id);
const taskOf = id => S.data.tasks.find(t => t.id === id);
const bookingOf = id => id ? S.data.bookings.find(b => b.id === id) : null;
const commentsOf = id => S.data.taskComments.filter(c => c.task_id === id);
const stageInfo = id => STAGES.find(s => s.id === id);
const projectBoard = () => S.data.taskBoards.find(b => b.is_project) || null;

/* tugas booking yang dibatalkan disembunyikan, tidak dihapus */
const isLive = t => bookingOf(t.booking_id)?.status !== 'CANCELLED';

export function dueState(t){
  if(t.done || !t.due_date) return null;
  const now = today();
  if(t.due_date < now) return 'late';
  if(t.due_date === now) return 'today';
  const soon = new Date(); soon.setDate(soon.getDate() + 2);
  return t.due_date <= iso(soon) ? 'soon' : null;
}
const dueText = t => {
  const st = dueState(t);
  const d = new Date(t.due_date + 'T00:00:00').toLocaleDateString('id-ID', {day:'numeric', month:'short'});
  return st === 'late' ? `${d} · telat` : st === 'today' ? 'Hari ini' : d;
};
export function assignee(t){
  if(t.assignee_admin_id) return S.data.admins.find(a => a.user_id === t.assignee_admin_id)?.name || null;
  if(t.assignee_freelancer_id) return S.data.freelancers.find(f => f.id === t.assignee_freelancer_id)?.name || null;
  return null;
}

/* progres tugas tahap Joblist saat ini — dipakai Joblist & detail booking */
export function stageProgress(b){
  const st = stageOf(b);
  const list = (S.data.tasks || []).filter(t => t.booking_id === b.id && t.stage === st);
  return { stage:st, total:list.length, done:list.filter(t => t.done).length,
           late:list.filter(t => dueState(t) === 'late').length };
}

/* ---------- tulis data (tercatat di Log Aktivitas) ---------- */
async function safely(fn){
  try{ await fn(); return true; }
  catch(e){ toast('Gagal menyimpan: ' + e.message); return false; }
}
async function saveTask(id, patch){
  const t = taskOf(id), before = {...t};
  await api('tasks?id=eq.' + id, {method:'PATCH', body:patch, prefer:'return=minimal'});
  Object.assign(t, patch);
  const detail = describe(before, patch);
  if(detail) await logAct('update', 'Tugas', t.title, detail);
  refreshBell();
}
async function createTask(row){
  const [saved] = await api('tasks', {method:'POST', body:row, prefer:'return=representation'});
  S.data.tasks.push(saved);
  const b = bookingOf(saved.booking_id);
  await logAct('create', 'Tugas', saved.title, b ? 'Project ' + b.client_display : boardOf(saved.board_id)?.name);
  refreshBell();
  return saved;
}
async function deleteTask(id){
  const t = taskOf(id);
  await api('tasks?id=eq.' + id, {method:'DELETE', prefer:'return=minimal'});
  S.data.tasks = S.data.tasks.filter(x => x.id !== id);
  S.data.taskComments = S.data.taskComments.filter(c => c.task_id !== id);
  await logAct('delete', 'Tugas', t?.title, null);
  refreshBell();
}
const endOf = listId => Math.max(0, ...S.data.tasks.filter(t => t.list_id === listId).map(t => t.position)) + 1;

/* centang selesai ⇄ kolom "selesai" board ikut berpindah, seperti Trello */
export async function setDone(id, done){
  const t = taskOf(id);
  const lists = listsOf(t.board_id);
  const patch = {done};
  const cur = listOf(t.list_id);
  if(done && !cur?.is_done){
    const fin = lists.find(l => l.is_done);
    if(fin) Object.assign(patch, {list_id:fin.id, position:endOf(fin.id)});
  } else if(!done && cur?.is_done){
    const open = lists.find(l => !l.is_done);
    if(open) Object.assign(patch, {list_id:open.id, position:endOf(open.id)});
  }
  await saveTask(id, patch);
  if(done) announceStage(t);
}
async function moveTask(id, listId, position){
  const l = listOf(listId);
  await saveTask(id, {list_id:listId, position, board_id:l.board_id, done:!!l.is_done});
  if(l.is_done) announceStage(taskOf(id));
}
/* Task → Joblist: beri tahu bila semua tugas tahap ini sudah beres */
function announceStage(t){
  const b = bookingOf(t?.booking_id);
  if(!b || t.stage !== stageOf(b)) return;
  const p = stageProgress(b);
  if(p.total && p.done === p.total){
    const i = STAGES.findIndex(s => s.id === p.stage);
    const next = STAGES[i + 1];
    toast(next ? `Semua tugas ${stageInfo(p.stage).label} ${b.client_display} selesai — siap dipindah ke ${next.label} di Joblist`
               : `Semua tugas project ${b.client_display} selesai`);
  }
}

/* buka Task Board dengan filter satu project — dari Joblist / detail booking */
export function openProjectTasks(bookingId){
  const pb = projectBoard();
  if(pb) TB.board = pb.id;
  Object.assign(TB, {project:bookingId, q:'', who:'', due:''});
  closeModal();
  $('#drawer').classList.remove('open');
  go('task');
}

/* ---------- filter ---------- */
function matches(t){
  if(!isLive(t)) return false;
  if(TB.hideDone && t.done) return false;
  if(TB.project && t.booking_id !== TB.project) return false;
  if(TB.who === 'me' && t.assignee_admin_id !== S.admin.id) return false;
  if(TB.who === 'none' && (t.assignee_admin_id || t.assignee_freelancer_id)) return false;
  if(TB.who.startsWith('A:') && t.assignee_admin_id !== TB.who.slice(2)) return false;
  if(TB.who.startsWith('F:') && t.assignee_freelancer_id !== TB.who.slice(2)) return false;
  if(TB.due){
    const st = dueState(t);
    if(TB.due === 'late' && st !== 'late') return false;
    if(TB.due === 'today' && st !== 'today') return false;
    if(TB.due === 'week'){
      const w = new Date(); w.setDate(w.getDate() + 7);
      if(t.done || !t.due_date || t.due_date > iso(w)) return false;
    }
    if(TB.due === 'none' && t.due_date) return false;
  }
  if(TB.q){
    const b = bookingOf(t.booking_id);
    const hay = `${t.title} ${t.description||''} ${b?.client_display||''} ${assignee(t)||''}`.toLowerCase();
    if(!hay.includes(TB.q.toLowerCase())) return false;
  }
  return true;
}

/* ---------- kartu ---------- */
const labelChip = (board, id) => {
  const L = (board?.labels || []).find(x => x.id === id);
  return L ? `<span class="lb lb-${esc(L.color)}">${esc(L.name)}</span>` : '';
};
function card(t, board){
  const b = bookingOf(t.booking_id);
  const st = b ? stageInfo(t.stage || stageOf(b)) : null;
  const cl = t.checklist || [];
  const clDone = cl.filter(c => c.done).length;
  const nc = commentsOf(t.id).length;
  const who = assignee(t);
  const ds = dueState(t);
  const pri = ['HIGH','URGENT'].includes(t.priority) ? `<span class="lb ${PRIORITY[t.priority].cls}">${PRIORITY[t.priority].text}</span>` : '';
  return `<div class="tk-card ${t.done?'done':''}" draggable="true" data-tk="${t.id}">
    <div class="lbs">${pri}${(t.labels||[]).map(id => labelChip(board, id)).join('')}</div>
    <div class="tk-t">
      <button class="tk-chk ${t.done?'on':''}" data-tkdone="${t.id}" aria-label="${t.done?'Tandai belum selesai':'Tandai selesai'}">${IC.tick}</button>
      <span>${esc(t.title)}</span>
    </div>
    ${b ? `<button class="tk-proj" data-tkproj="${b.id}" title="Buka detail booking">
      <span class="dot" style="background:${st?.color||'#8A90BC'}"></span>${esc(b.client_display)}${st ? ` · ${st.label}` : ''}</button>` : ''}
    <div class="tk-meta">
      ${t.due_date ? `<span class="tk-due ${t.done?'ok':ds||''}">${IC.cal}${dueText(t)}</span>` : ''}
      ${cl.length ? `<span class="mi ${clDone===cl.length?'ok':''}">${IC.chk}${clDone}/${cl.length}</span>` : ''}
      ${nc ? `<span class="mi">${IC.msg}${nc}</span>` : ''}
      ${t.description ? `<span class="mi" title="Ada deskripsi">${IC.txt}</span>` : ''}
      ${who ? `<span class="tk-av" title="PIC: ${esc(who)}">${initials(who)}</span>` : t.role ? `<span class="tk-av none" title="${ROLE_TEXT[t.role]} belum ditugaskan">${t.role[0]}?</span>` : ''}
    </div>
  </div>`;
}

/* ---------- halaman ---------- */
RENDER.task = () => {
  if(!S.data.tasksReady){
    $('#pgSub').textContent = 'Belum aktif';
    $('#page').innerHTML = `<div class="card"><div class="empty">
      <div class="ic">${IC.chk}</div><b>Task Board belum diaktifkan di database</b>
      <span>Buka Supabase → SQL Editor, jalankan ulang <code>supabase/schema.sql</code> terbaru, lalu muat ulang halaman ini.
      Board, kolom, dan Template SOP bawaan akan dibuat otomatis, dan booking yang sedang berjalan langsung mendapat tugasnya.</span>
    </div></div>`;
    return;
  }
  const bs = boards();
  if(!bs.find(b => b.id === TB.board)) TB.board = (projectBoard() || bs[0])?.id || null;
  const board = boardOf(TB.board);

  const live = S.data.tasks.filter(isLive);
  const open = live.filter(t => !t.done);
  const late = open.filter(t => dueState(t) === 'late').length;
  const dueToday = open.filter(t => dueState(t) === 'today').length;
  const weekAgo = Date.now() - 7 * 864e5;
  const doneWeek = live.filter(t => t.done && t.done_at && new Date(t.done_at) > weekAgo).length;
  const mine = open.filter(t => t.assignee_admin_id === S.admin.id).length;
  $('#pgSub').textContent = `${open.length} tugas aktif${late ? ` · ${late} lewat deadline` : ''}`;

  const kpis = `<div class="grid g4" style="margin-bottom:14px">
    <div class="card kpi accent tk-kpi" data-tkdue=""><div class="lbl">Tugas aktif</div><div class="val">${open.length}</div><div class="cap">${mine} ditugaskan ke kamu</div></div>
    <div class="card kpi tk-kpi" data-tkdue="late"><div class="lbl">Lewat deadline</div><div class="val" style="${late?'color:var(--err)':''}">${late}</div><div class="cap">perlu dikejar</div></div>
    <div class="card kpi tk-kpi" data-tkdue="today"><div class="lbl">Deadline hari ini</div><div class="val">${dueToday}</div><div class="cap">tugas</div></div>
    <div class="card kpi"><div class="lbl">Selesai 7 hari</div><div class="val" style="color:var(--ok)">${doneWeek}</div><div class="cap">tugas</div></div>
  </div>`;

  const boardBar = `<div class="jb-bar">
    <div class="chips">
      ${bs.map(b => `<button class="chip ${b.id===TB.board?'on':''}" data-tkboard="${b.id}"><span class="tk-bdot" style="background:${esc(b.color)}"></span>${esc(b.name)}</button>`).join('')}
      <button class="chip alt" id="tkNewBoard">+ Board</button>
    </div>
    <div class="chips" style="margin-left:auto">
      ${board ? `<button class="btn soft sm" id="tkBoardSet">Atur board</button>` : ''}
      <button class="btn soft sm" id="tkTpl">Template SOP</button>
    </div>
  </div>`;

  if(!board){
    $('#page').innerHTML = kpis + boardBar + `<div class="card"><div class="empty"><b>Belum ada board</b><span>Buat board pertama lewat tombol + Board.</span></div></div>`;
    bindTop(); return;
  }

  const boardTasks = S.data.tasks.filter(t => t.board_id === board.id && isLive(t));
  const projects = [...new Set(boardTasks.map(t => t.booking_id).filter(Boolean))]
    .map(bookingOf).filter(Boolean).sort((a, b) => (a.session_date||'').localeCompare(b.session_date||''));
  if(TB.project && !bookingOf(TB.project)) TB.project = '';
  const projectOpts = TB.project && !projects.find(p => p.id === TB.project) ? [bookingOf(TB.project), ...projects] : projects;
  const activeFl = S.data.freelancers.filter(f => f.is_active);

  const filters = `<div class="card tk-filters">
    <div class="fld"><input type="search" id="tkQ" placeholder="Cari tugas, client, PIC…" value="${esc(TB.q)}" aria-label="Cari tugas"></div>
    <div class="fld"><select id="tkWho" aria-label="Filter PIC">
      <option value="">Semua PIC</option>
      <option value="me" ${TB.who==='me'?'selected':''}>Tugas saya</option>
      <option value="none" ${TB.who==='none'?'selected':''}>Belum ada PIC</option>
      <optgroup label="Admin">${S.data.admins.map(a => `<option value="A:${a.user_id}" ${TB.who==='A:'+a.user_id?'selected':''}>${esc(a.name)}</option>`).join('')}</optgroup>
      <optgroup label="Freelancer">${activeFl.map(f => `<option value="F:${f.id}" ${TB.who==='F:'+f.id?'selected':''}>${esc(f.name)}</option>`).join('')}</optgroup>
    </select></div>
    <div class="fld"><select id="tkProject" aria-label="Filter project">
      <option value="">Semua project</option>
      ${projectOpts.map(b => `<option value="${b.id}" ${TB.project===b.id?'selected':''}>${esc(b.client_display)} — ${fmtDate(b.session_date)}</option>`).join('')}
    </select></div>
    <div class="fld"><select id="tkDue" aria-label="Filter deadline">
      ${[['','Semua deadline'],['late','Lewat deadline'],['today','Hari ini'],['week','7 hari ke depan'],['none','Tanpa deadline']]
        .map(([v, l]) => `<option value="${v}" ${TB.due===v?'selected':''}>${l}</option>`).join('')}
    </select></div>
    <label class="tk-toggle"><input type="checkbox" id="tkHide" ${TB.hideDone?'checked':''}> Sembunyikan selesai</label>
  </div>`;

  const lists = listsOf(board.id);
  const cols = lists.map(l => {
    const rows = S.data.tasks.filter(t => t.list_id === l.id && matches(t)).sort(byPos);
    const adding = TB.adding === l.id;
    return `<section class="tk-col" data-tklist="${l.id}">
      <div class="tk-h">
        <span class="t">${esc(l.name)}</span>${l.is_done ? '<span class="lb lb-green" title="Kartu di sini dihitung selesai">Selesai</span>' : ''}
        <span class="c">${rows.length}</span>
        <button class="tk-more" data-tklistset="${l.id}" aria-label="Atur kolom ${esc(l.name)}">⋯</button>
      </div>
      <div class="tk-list">${rows.map(t => card(t, board)).join('') || '<div class="jb-empty">Belum ada kartu</div>'}</div>
      ${adding ? `<div class="tk-new">
          <textarea id="tkNewTitle" rows="2" placeholder="Judul tugas… (Enter untuk simpan)"></textarea>
          <div class="tk-new-a"><button class="btn sm" id="tkNewSave">Tambah</button><button class="btn ghost sm" id="tkNewCancel">Batal</button></div>
        </div>`
        : `<button class="tk-add" data-tkadd="${l.id}">+ Tambah kartu</button>`}
    </section>`;
  }).join('');

  $('#page').innerHTML = kpis + boardBar + filters +
    (TB.project ? `<div class="banner info">Menampilkan tugas project <b>${esc(bookingOf(TB.project)?.client_display || '')}</b>
       <button class="linkbtn" id="tkClearProject" style="margin-left:auto">Tampilkan semua</button></div>` : '') +
    `<div class="tk-wrap">${cols}
      <section class="tk-col tk-col-add"><button class="tk-add" id="tkAddList">+ Tambah kolom</button></section>
    </div>`;

  bindTop();
  bindBoard(board);
};

function bindTop(){
  $$('[data-tkboard]').forEach(b => b.onclick = () => { TB.board = b.dataset.tkboard; TB.project = ''; RENDER.task(); });
  $$('[data-tkdue]').forEach(b => b.onclick = () => { TB.due = b.dataset.tkdue; RENDER.task(); });
  $('#tkNewBoard').onclick = () => boardEditor(null);
  const bset = $('#tkBoardSet'); if(bset) bset.onclick = () => boardEditor(TB.board);
  $('#tkTpl').onclick = templateManager;
}

function bindBoard(board){
  const q = $('#tkQ');
  q.oninput = () => {
    TB.q = q.value;
    const pos = q.selectionStart;
    RENDER.task();
    const n = $('#tkQ'); n.focus(); n.setSelectionRange(pos, pos);
  };
  $('#tkWho').onchange = e => { TB.who = e.target.value; RENDER.task(); };
  $('#tkProject').onchange = e => { TB.project = e.target.value; RENDER.task(); };
  $('#tkDue').onchange = e => { TB.due = e.target.value; RENDER.task(); };
  $('#tkHide').onchange = e => { TB.hideDone = e.target.checked; RENDER.task(); };
  const clr = $('#tkClearProject'); if(clr) clr.onclick = () => { TB.project = ''; RENDER.task(); };

  $$('[data-tk]').forEach(c => c.onclick = () => openTask(c.dataset.tk));
  $$('[data-tkdone]').forEach(b => b.onclick = async e => {
    e.stopPropagation();
    const t = taskOf(b.dataset.tkdone);
    await safely(() => setDone(t.id, !t.done));
    RENDER.task();
  });
  $$('[data-tkproj]').forEach(b => b.onclick = e => { e.stopPropagation(); bookingDrawer(b.dataset.tkproj); });
  $$('[data-tklistset]').forEach(b => b.onclick = () => listEditor(b.dataset.tklistset));

  // tambah kartu cepat di bawah kolom
  $$('[data-tkadd]').forEach(b => b.onclick = () => { TB.adding = b.dataset.tkadd; RENDER.task(); $('#tkNewTitle')?.focus(); });
  const ta = $('#tkNewTitle');
  if(ta){
    const save = async () => {
      const title = ta.value.trim();
      if(!title){ TB.adding = null; RENDER.task(); return; }
      const listId = TB.adding, l = listOf(listId);
      const ok = await safely(() => createTask({
        board_id:board.id, list_id:listId, position:endOf(listId), title, done:!!l.is_done,
        booking_id:TB.project || null, stage:TB.project ? stageOf(bookingOf(TB.project)) : null
      }));
      RENDER.task();
      if(ok) $('#tkNewTitle')?.focus();   // tetap terbuka untuk kartu berikutnya
    };
    ta.onkeydown = e => {
      if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); save(); }
      if(e.key === 'Escape'){ e.stopPropagation(); TB.adding = null; RENDER.task(); }
    };
    $('#tkNewSave').onclick = save;
    $('#tkNewCancel').onclick = () => { TB.adding = null; RENDER.task(); };
  }
  $('#tkAddList').onclick = () => {
    openModal(`<h3>Kolom baru</h3><p>Di board ${esc(board.name)}.</p>
      <div class="fld" style="margin-top:16px"><label>Nama kolom</label><input id="nlName" placeholder="mis. Menunggu Client"></div>
      <label class="mn-check" style="margin-top:11px"><input type="checkbox" id="nlDone"><div><b>Kolom selesai</b><small>Kartu yang dipindah ke sini otomatis tercentang selesai.</small></div></label>
      <div class="acts"><button class="btn soft" data-mclose>Batal</button><button class="btn" id="nlSave">Tambah</button></div>`);
    $('#nlName').focus();
    $('#nlSave').onclick = async () => {
      const name = $('#nlName').value.trim();
      if(!name) return toast('Nama kolom belum diisi');
      const pos = Math.max(0, ...listsOf(board.id).map(l => l.position)) + 1;
      const ok = await safely(async () => {
        const [row] = await api('task_lists', {method:'POST', body:{board_id:board.id, name, position:pos, is_done:$('#nlDone').checked}, prefer:'return=representation'});
        S.data.taskLists.push(row);
        await logAct('create', 'Kolom Task', name, board.name);
      });
      if(ok){ closeModal(); RENDER.task(); }
    };
  };

  // drag & drop antar kolom dan urutan dalam kolom
  $$('.tk-card').forEach(c => {
    c.addEventListener('dragstart', e => { TB.drag = c.dataset.tk; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try{ e.dataTransfer.setData('text/plain', c.dataset.tk); }catch(_){} });
    c.addEventListener('dragend', () => { c.classList.remove('dragging'); TB.drag = null; $$('.tk-col').forEach(x => x.classList.remove('over')); });
  });
  $$('.tk-col[data-tklist]').forEach(col => {
    col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', e => { if(!col.contains(e.relatedTarget)) col.classList.remove('over'); });
    col.addEventListener('drop', async e => {
      e.preventDefault(); col.classList.remove('over');
      const id = TB.drag || (() => { try{ return e.dataTransfer.getData('text/plain'); }catch(_){ return null; } })();
      if(!id || !taskOf(id)) return;
      const listId = col.dataset.tklist;
      const cards = $$(`.tk-col[data-tklist="${listId}"] .tk-card`).filter(c => c.dataset.tk !== id);
      const before = cards.find(c => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      const pos = dropPosition(listId, id, before?.dataset.tk || null);
      const t = taskOf(id);
      if(t.list_id === listId && t.position === pos) return;
      await safely(() => moveTask(id, listId, pos));
      RENDER.task();
    });
  });
}

function dropPosition(listId, dragId, beforeId){
  const arr = S.data.tasks.filter(t => t.list_id === listId && t.id !== dragId).sort(byPos);
  if(!arr.length) return 1;
  if(!beforeId) return arr[arr.length - 1].position + 1;
  const i = arr.findIndex(t => t.id === beforeId);
  if(i <= 0) return arr[0].position - 1;
  return (arr[i - 1].position + arr[i].position) / 2;
}

/* ---------- detail kartu ---------- */
export function openTask(id){
  const t = taskOf(id);
  if(!t) return;
  const board = boardOf(t.board_id);
  const b = bookingOf(t.booking_id);
  const cl = t.checklist || [];
  const clDone = cl.filter(c => c.done).length;
  const comments = commentsOf(id);
  const st = t.stage ? stageInfo(t.stage) : null;
  const bookingsOpt = S.data.bookings.filter(x => x.status !== 'CANCELLED' || x.id === t.booking_id)
    .sort((x, y) => (x.session_date||'').localeCompare(y.session_date||''));
  const who = t.assignee_admin_id ? 'A:' + t.assignee_admin_id : t.assignee_freelancer_id ? 'F:' + t.assignee_freelancer_id : '';
  const fls = S.data.freelancers.filter(f => f.is_active || f.id === t.assignee_freelancer_id);

  openModal(`<div class="tk-detail">
    <div class="tk-dh">
      <button class="tk-chk big ${t.done?'on':''}" id="tdDone" aria-label="${t.done?'Tandai belum selesai':'Tandai selesai'}">${IC.tick}</button>
      <div style="flex:1;min-width:0">
        <textarea id="tdTitle" class="tk-title-in" rows="1" aria-label="Judul tugas">${esc(t.title)}</textarea>
        <div class="tsub">di kolom <b>${esc(listOf(t.list_id)?.name || '—')}</b> · ${esc(board?.name || '')}
          ${t.template_id ? ` · otomatis dari SOP tahap ${esc(st?.label || t.stage)}` : ''}</div>
      </div>
      <button class="x tk-x" data-mclose aria-label="Tutup">✕</button>
    </div>

    <div class="tk-dgrid">
      <div class="tk-dmain">
        ${b ? `<div class="tk-projbox">
            <span class="dot" style="background:${stageInfo(stageOf(b))?.color||'#8A90BC'}"></span>
            <div style="min-width:0"><b>${esc(b.client_display)}</b>
              <div class="tsub">${esc(b.service)} · ${fmtDate(b.session_date)} · tahap Joblist ${esc(stageInfo(stageOf(b))?.label || b.status)}</div></div>
            <button class="btn soft sm" id="tdOpenBooking" style="margin-left:auto">Detail booking</button>
          </div>` : ''}

        <div class="mlabel">Deskripsi</div>
        <div class="fld" style="margin-top:8px"><textarea id="tdDesc" rows="3" placeholder="Tambahkan detail, link brief, catatan…">${esc(t.description||'')}</textarea></div>
        <button class="btn soft sm hide" id="tdDescSave" style="margin-top:7px">Simpan deskripsi</button>

        <div class="mlabel" style="margin-top:18px;display:flex;align-items:center">Checklist
          <span style="margin-left:auto;color:var(--muted);letter-spacing:0">${cl.length ? `${clDone}/${cl.length}` : ''}</span></div>
        ${cl.length ? `<div class="bar" style="margin-top:8px"><div class="track"><div class="fill" style="width:${Math.round(clDone/cl.length*100)}%;${clDone===cl.length?'background:var(--ok)':''}"></div></div></div>` : ''}
        <div class="tk-cl">${cl.map(c => `<div class="tk-cli ${c.done?'on':''}">
            <input type="checkbox" data-clt="${esc(c.id)}" ${c.done?'checked':''} aria-label="${esc(c.text)}">
            <span>${esc(c.text)}</span>
            <button class="ibtn sm del" data-cld="${esc(c.id)}" aria-label="Hapus item">✕</button>
          </div>`).join('')}</div>
        <div style="display:flex;gap:7px;margin-top:8px" class="fld">
          <input id="tdClNew" placeholder="Tambah item checklist…">
          <button class="btn soft sm" id="tdClAdd" style="flex:0 0 auto">Tambah</button>
        </div>

        <div class="mlabel" style="margin-top:18px">Komentar</div>
        <div class="fld" style="margin-top:8px"><textarea id="tdCm" rows="2" placeholder="Tulis update atau catatan untuk tim…"></textarea></div>
        <button class="btn sm" id="tdCmSend" style="margin-top:7px">Kirim komentar</button>
        <div class="feed" style="margin-top:12px">${comments.slice().reverse().map(c => `<div class="feed-i">
            <span class="tk-av">${initials(c.author)}</span>
            <div class="feed-t" style="flex:1"><b>${esc(c.author)} <small style="display:inline;font-weight:300">· ${ago(c.at)}</small></b>
              <span style="white-space:pre-wrap">${esc(c.body)}</span></div>
            ${c.author_id === S.admin.id ? `<button class="ibtn sm del" data-cmd="${c.id}" aria-label="Hapus komentar">✕</button>` : ''}
          </div>`).join('') || '<div class="tsub">Belum ada komentar.</div>'}</div>
      </div>

      <div class="tk-dside">
        <div class="fld"><label>Kolom</label><select id="tdList">
          ${boards().map(bd => `<optgroup label="${esc(bd.name)}">${listsOf(bd.id).map(l => `<option value="${l.id}" ${l.id===t.list_id?'selected':''}>${esc(l.name)}</option>`).join('')}</optgroup>`).join('')}
        </select></div>
        <div class="fld"><label>Project / booking</label><select id="tdBooking">
          <option value="">— Bukan tugas project —</option>
          ${bookingsOpt.map(x => `<option value="${x.id}" ${x.id===t.booking_id?'selected':''}>${esc(x.client_display)} — ${fmtDate(x.session_date)}</option>`).join('')}
        </select></div>
        <div class="fld"><label>PIC</label><select id="tdWho">
          <option value="">— Belum ada —</option>
          <optgroup label="Admin">${S.data.admins.map(a => `<option value="A:${a.user_id}" ${who==='A:'+a.user_id?'selected':''}>${esc(a.name)}</option>`).join('')}</optgroup>
          <optgroup label="Freelancer">${fls.map(f => `<option value="F:${f.id}" ${who==='F:'+f.id?'selected':''}>${esc(f.name)}</option>`).join('')}</optgroup>
        </select>${t.role ? `<div class="hint">Tugas ${ROLE_TEXT[t.role]} — ikut berganti saat crew booking diganti.</div>` : ''}</div>
        <div class="fld"><label>Deadline</label><input type="date" id="tdDue" value="${t.due_date||''}"></div>
        <div class="fld"><label>Prioritas</label><select id="tdPri">
          ${Object.entries(PRIORITY).map(([k, p]) => `<option value="${k}" ${t.priority===k?'selected':''}>${p.text}</option>`).join('')}
        </select></div>
        <div class="fld"><label>Label</label>
          <div class="lbs" style="display:flex;gap:6px;flex-wrap:wrap">
            ${(board?.labels||[]).map(L => `<span class="lb lb-${esc(L.color)} pick ${(t.labels||[]).includes(L.id)?'on':''}" data-tdlb="${esc(L.id)}">${esc(L.name)}</span>`).join('') || '<span class="tsub">Belum ada label — atur di "Atur board".</span>'}
          </div>
        </div>
        <button class="btn soft sm block danger-soft" id="tdDel">Hapus tugas</button>
        <div class="tsub" style="margin-top:8px">Dibuat ${ago(t.created_at)}${t.done_at ? ` · selesai ${ago(t.done_at)}` : ''}</div>
      </div>
    </div>
  </div>`);
  $('#modal .box').classList.add('wide');

  const refresh = () => { openTask(id); rerender(); };
  const patch = async p => { if(await safely(() => saveTask(id, p))) refresh(); };

  const title = $('#tdTitle');
  const fit = () => { title.style.height = 'auto'; title.style.height = title.scrollHeight + 'px'; };
  fit(); title.oninput = fit;
  title.onkeydown = e => { if(e.key === 'Enter'){ e.preventDefault(); title.blur(); } };
  title.onchange = () => {
    const v = title.value.trim();
    if(!v){ title.value = t.title; return; }
    if(v !== t.title) patch({title:v});
  };
  $('#tdDone').onclick = async () => { if(await safely(() => setDone(id, !t.done))) refresh(); };
  const desc = $('#tdDesc');
  desc.oninput = () => $('#tdDescSave').classList.toggle('hide', desc.value === (t.description || ''));
  $('#tdDescSave').onclick = () => patch({description: desc.value.trim() || null});

  // checklist
  const setCl = list => patch({checklist:list});
  $$('[data-clt]').forEach(c => c.onchange = () => setCl(cl.map(x => x.id === c.dataset.clt ? {...x, done:c.checked} : x)));
  $$('[data-cld]').forEach(c => c.onclick = () => setCl(cl.filter(x => x.id !== c.dataset.cld)));
  const addCl = () => {
    const v = $('#tdClNew').value.trim();
    if(v) setCl([...cl, {id:crypto.randomUUID(), text:v, done:false}]);
  };
  $('#tdClAdd').onclick = addCl;
  $('#tdClNew').onkeydown = e => { if(e.key === 'Enter'){ e.preventDefault(); addCl(); } };

  // komentar
  $('#tdCmSend').onclick = async () => {
    const body = $('#tdCm').value.trim();
    if(!body) return;
    const ok = await safely(async () => {
      const [row] = await api('task_comments', {method:'POST', body:{task_id:id, author:S.admin.name, body}, prefer:'return=representation'});
      S.data.taskComments.push(row);
    });
    if(ok) refresh();
  };
  $$('[data-cmd]').forEach(b => b.onclick = async () => {
    const ok = await safely(async () => {
      await api('task_comments?id=eq.' + b.dataset.cmd, {method:'DELETE', prefer:'return=minimal'});
      S.data.taskComments = S.data.taskComments.filter(c => c.id !== b.dataset.cmd);
    });
    if(ok) refresh();
  });

  // atribut
  $('#tdList').onchange = async e => {
    const ok = await safely(() => moveTask(id, e.target.value, endOf(e.target.value)));
    if(ok){ TB.board = taskOf(id).board_id; refresh(); }
  };
  $('#tdBooking').onchange = e => {
    const bk = bookingOf(e.target.value);
    patch({booking_id:bk?.id || null, stage:bk ? (t.booking_id === bk.id ? t.stage : stageOf(bk)) : null});
  };
  $('#tdWho').onchange = e => {
    const v = e.target.value;
    patch({assignee_admin_id: v.startsWith('A:') ? v.slice(2) : null, assignee_freelancer_id: v.startsWith('F:') ? v.slice(2) : null});
  };
  $('#tdDue').onchange = e => patch({due_date:e.target.value || null});
  $('#tdPri').onchange = e => patch({priority:e.target.value});
  $$('[data-tdlb]').forEach(el => el.onclick = () => {
    const cur = new Set(t.labels || []);
    cur.has(el.dataset.tdlb) ? cur.delete(el.dataset.tdlb) : cur.add(el.dataset.tdlb);
    patch({labels:[...cur]});
  });
  const ob = $('#tdOpenBooking'); if(ob) ob.onclick = () => { closeModal(); bookingDrawer(t.booking_id); };
  $('#tdDel').onclick = async () => {
    if(!await confirmBox('Hapus tugas?', `"${t.title}" beserta checklist dan komentarnya akan dihapus.`)) return openTask(id);
    if(await safely(() => deleteTask(id))){ toast('Tugas dihapus'); rerender(); }
  };
}

/* ---------- kolom ---------- */
function listEditor(listId){
  const l = listOf(listId), board = boardOf(l.board_id);
  const lists = listsOf(board.id), i = lists.findIndex(x => x.id === listId);
  const count = S.data.tasks.filter(t => t.list_id === listId).length;
  openModal(`<h3>Atur kolom</h3><p>${esc(board.name)}</p>
    <div class="fld" style="margin-top:16px"><label>Nama kolom</label><input id="leName" value="${esc(l.name)}"></div>
    <label class="mn-check" style="margin-top:11px"><input type="checkbox" id="leDone" ${l.is_done?'checked':''}><div><b>Kolom selesai</b><small>Kartu di kolom ini dihitung selesai (dan kartu yang dicentang selesai pindah ke sini).</small></div></label>
    <div style="display:flex;gap:7px;margin-top:12px">
      <button class="btn soft sm" id="leLeft" ${i<=0?'disabled':''}>‹ Geser kiri</button>
      <button class="btn soft sm" id="leRight" ${i>=lists.length-1?'disabled':''}>Geser kanan ›</button>
      <button class="btn soft sm danger-soft" id="leDel" style="margin-left:auto">Hapus</button>
    </div>
    <div class="acts"><button class="btn soft" data-mclose>Batal</button><button class="btn" id="leSave">Simpan</button></div>`);

  const save = async patch => {
    const ok = await safely(async () => {
      await api('task_lists?id=eq.' + listId, {method:'PATCH', body:patch, prefer:'return=minimal'});
      const before = {...l};
      Object.assign(l, patch);
      const detail = describe(before, patch);
      if(detail) await logAct('update', 'Kolom Task', l.name, detail);
    });
    return ok;
  };
  $('#leSave').onclick = async () => {
    const name = $('#leName').value.trim();
    if(!name) return toast('Nama kolom belum diisi');
    const isDone = $('#leDone').checked;
    if(await save({name, is_done:isDone})){
      // status selesai kartu mengikuti kolomnya
      const flip = S.data.tasks.filter(t => t.list_id === listId && t.done !== isDone);
      if(flip.length){
        await safely(async () => {
          await api('tasks?list_id=eq.' + listId, {method:'PATCH', body:{done:isDone}, prefer:'return=minimal'});
          flip.forEach(t => t.done = isDone);
        });
        refreshBell();
      }
      closeModal(); RENDER.task();
    }
  };
  const swap = async dir => {
    const other = lists[i + dir];
    const a = l.position, b = other.position;
    const ok = await safely(async () => {
      await api('task_lists?id=eq.' + l.id, {method:'PATCH', body:{position:b}, prefer:'return=minimal'});
      await api('task_lists?id=eq.' + other.id, {method:'PATCH', body:{position:a}, prefer:'return=minimal'});
      l.position = b; other.position = a;
      await logAct('reorder', 'Kolom Task', l.name, board.name);
    });
    if(ok){ closeModal(); RENDER.task(); }
  };
  $('#leLeft').onclick = () => swap(-1);
  $('#leRight').onclick = () => swap(1);
  $('#leDel').onclick = async () => {
    if(count){ toast(`Kolom masih berisi ${count} kartu — pindahkan atau hapus dulu`); return; }
    if(lists.length <= 1){ toast('Board harus punya minimal satu kolom'); return; }
    if(!await confirmBox('Hapus kolom?', `Kolom "${l.name}" akan dihapus.`)) return;
    const ok = await safely(async () => {
      await api('task_lists?id=eq.' + listId, {method:'DELETE', prefer:'return=minimal'});
      S.data.taskLists = S.data.taskLists.filter(x => x.id !== listId);
      await logAct('delete', 'Kolom Task', l.name, board.name);
    });
    if(ok) RENDER.task();
  };
}

/* ---------- board ---------- */
function boardEditor(boardId){
  const bd = boardId ? boardOf(boardId) : null;
  let labels = (bd?.labels || []).map(L => ({...L}));
  let color = bd?.color || BOARD_COLORS[0];

  const draw = () => {
    openModal(`<h3>${bd ? 'Atur board' : 'Board baru'}</h3>
      <p>${bd?.is_project ? 'Board project — tugas SOP dari Joblist otomatis masuk ke kolom pertama board ini.' : 'Mis. Marketing, Konten Instagram, Operasional, Rekrut Freelancer.'}</p>
      <div class="fld" style="margin-top:16px"><label>Nama board</label><input id="beName" value="${esc(bd?.name || '')}" placeholder="Nama board"></div>
      <div class="fld" style="margin-top:11px"><label>Warna</label>
        <div class="tk-swatches">${BOARD_COLORS.map(c => `<button class="tk-sw ${c===color?'on':''}" data-bec="${c}" style="background:${c}" aria-label="Warna ${c}"></button>`).join('')}</div></div>
      <div class="fld" style="margin-top:11px"><label>Label</label>
        <div class="tk-lbl-ed">${labels.map((L, i) => `<div class="tk-lbl-row">
            <input data-beln="${i}" value="${esc(L.name)}" placeholder="Nama label">
            <select data-belc="${i}">${LABEL_COLORS.map(c => `<option value="${c}" ${L.color===c?'selected':''}>${c}</option>`).join('')}</select>
            <span class="lb lb-${esc(L.color)}">Aa</span>
            <button class="ibtn sm del" data-beld="${i}" aria-label="Hapus label">✕</button>
          </div>`).join('')}</div>
        <button class="btn soft sm" id="beAddLbl" style="margin-top:8px">+ Label</button></div>
      ${bd && !bd.is_project ? `<button class="btn soft sm danger-soft" id="beDel" style="margin-top:14px">Hapus board ini</button>` : ''}
      ${!bd ? `<div class="hint" style="font-size:11px;color:var(--muted);margin-top:10px">Kolom awal: To Do · Dikerjakan · Selesai (bisa diubah nanti).</div>` : ''}
      <div class="acts"><button class="btn soft" data-mclose>Batal</button><button class="btn" id="beSave">${bd ? 'Simpan' : 'Buat board'}</button></div>`);

    const keep = () => {
      $$('[data-beln]').forEach(el => labels[el.dataset.beln].name = el.value);
      $$('[data-belc]').forEach(el => labels[el.dataset.belc].color = el.value);
    };
    $$('[data-bec]').forEach(b => b.onclick = () => { keep(); color = b.dataset.bec; const n = $('#beName').value; draw(); $('#beName').value = n; });
    $$('[data-belc]').forEach(s => s.onchange = () => { keep(); const n = $('#beName').value; draw(); $('#beName').value = n; });
    $$('[data-beld]').forEach(b => b.onclick = () => { keep(); labels.splice(Number(b.dataset.beld), 1); const n = $('#beName').value; draw(); $('#beName').value = n; });
    $('#beAddLbl').onclick = () => { keep(); labels.push({id:crypto.randomUUID().slice(0, 8), name:'', color:'blue'}); const n = $('#beName').value; draw(); $('#beName').value = n; };
    const del = $('#beDel');
    if(del) del.onclick = async () => {
      const n = S.data.tasks.filter(t => t.board_id === bd.id).length;
      if(!await confirmBox('Hapus board?', `Board "${bd.name}" beserta ${n} kartunya akan dihapus permanen.`)) return;
      const ok = await safely(async () => {
        await api('task_boards?id=eq.' + bd.id, {method:'DELETE', prefer:'return=minimal'});
        S.data.taskBoards = S.data.taskBoards.filter(x => x.id !== bd.id);
        const gone = new Set(S.data.taskLists.filter(l => l.board_id === bd.id).map(l => l.id));
        S.data.taskLists = S.data.taskLists.filter(l => !gone.has(l.id));
        S.data.tasks = S.data.tasks.filter(t => t.board_id !== bd.id);
        await logAct('delete', 'Board', bd.name, `${n} kartu`);
      });
      if(ok){ TB.board = null; RENDER.task(); refreshBell(); }
    };
    $('#beSave').onclick = async () => {
      keep();
      const name = $('#beName').value.trim();
      if(!name) return toast('Nama board belum diisi');
      const clean = labels.filter(L => L.name.trim()).map(L => ({...L, name:L.name.trim()}));
      const ok = await safely(async () => {
        if(bd){
          await api('task_boards?id=eq.' + bd.id, {method:'PATCH', body:{name, color, labels:clean}, prefer:'return=minimal'});
          const before = {...bd};
          Object.assign(bd, {name, color, labels:clean});
          await logAct('update', 'Board', name, describe(before, {name}) || 'Warna / label diperbarui');
        } else {
          const pos = Math.max(0, ...S.data.taskBoards.map(b => b.position)) + 1;
          const [row] = await api('task_boards', {method:'POST', body:{name, color, labels:clean, position:pos}, prefer:'return=representation'});
          const lists = await api('task_lists', {method:'POST', prefer:'return=representation', body:[
            {board_id:row.id, name:'To Do', position:1}, {board_id:row.id, name:'Dikerjakan', position:2},
            {board_id:row.id, name:'Selesai', position:3, is_done:true}]});
          S.data.taskBoards.push(row); S.data.taskLists.push(...lists);
          TB.board = row.id; TB.project = '';
          await logAct('create', 'Board', name, null);
        }
      });
      if(ok){ closeModal(); RENDER.task(); toast(bd ? 'Board tersimpan' : 'Board dibuat'); }
    };
  };
  draw();
}

/* ---------- Template SOP per tahap Joblist ---------- */
const offsetText = tp => {
  if(tp.due_offset === null || tp.due_offset === undefined) return 'Tanpa deadline';
  const n = tp.due_offset;
  if(tp.due_anchor === 'SESSION') return n === 0 ? 'Hari-H sesi' : n < 0 ? `H${n} sesi` : `H+${n} sesi`;
  return n === 0 ? 'Hari masuk tahap' : `${n} hari setelah masuk tahap`;
};
function templateManager(){
  const tps = [...S.data.taskTemplates].sort(byPos);
  openModal(`<h3>Template SOP</h3>
    <p>Tugas yang otomatis dibuat setiap kali booking masuk ke tahap Joblist. Perubahan berlaku untuk booking yang masuk tahap berikutnya;
      booking yang sudah berjalan bisa memakai tombol <b>Terapkan SOP</b> di detail booking.</p>
    ${STAGES.map(s => {
      const rows = tps.filter(t => t.stage === s.id);
      return `<div class="tk-tpl-sec">
        <div class="tk-tpl-h"><span class="dot" style="background:${s.color}"></span><b>${s.label}</b><span class="c">${rows.length}</span>
          <button class="linkbtn" data-tpadd="${s.id}" style="margin-left:auto;font-size:12px">+ Tambah</button></div>
        ${rows.map(t => `<div class="tk-tpl ${t.is_active?'':'off'}">
            <div style="min-width:0;flex:1"><div class="tname" style="font-size:13px">${esc(t.title)}</div>
              <div class="tsub">${offsetText(t)}${t.role ? ' · ' + ROLE_TEXT[t.role] : ''}${(t.checklist||[]).length ? ` · ${t.checklist.length} checklist` : ''}${t.is_active ? '' : ' · nonaktif'}</div></div>
            <button class="btn soft sm" data-tpedit="${t.id}">Ubah</button>
          </div>`).join('') || '<div class="tsub" style="padding:6px 0">Belum ada tugas otomatis di tahap ini.</div>'}
      </div>`;
    }).join('')}
    <div class="acts"><button class="btn" data-mclose>Selesai</button></div>`);
  $('#modal .box').classList.add('wide');
  $$('[data-tpadd]').forEach(b => b.onclick = () => templateEditor(null, b.dataset.tpadd));
  $$('[data-tpedit]').forEach(b => b.onclick = () => templateEditor(b.dataset.tpedit));
}
function templateEditor(id, stage){
  const tp = id ? S.data.taskTemplates.find(t => t.id === id) : {stage, title:'', description:'', checklist:[], role:null, due_anchor:'STAGE', due_offset:1, priority:'NORMAL', is_active:true};
  openModal(`<h3>${id ? 'Ubah' : 'Tambah'} tugas SOP</h3>
    <div class="mn-form" style="margin-top:14px;text-align:left">
      <div class="fld"><label>Judul tugas</label><input id="tpTitle" value="${esc(tp.title)}" placeholder="mis. Kirim moodboard ke client"></div>
      <div class="fgrid two">
        <div class="fld"><label>Tahap Joblist</label><select id="tpStage">${STAGES.map(s => `<option value="${s.id}" ${tp.stage===s.id?'selected':''}>${s.label}</option>`).join('')}</select></div>
        <div class="fld"><label>PIC otomatis</label><select id="tpRole">
          <option value="">Admin (pilih manual)</option>
          <option value="PHOTOGRAPHER" ${tp.role==='PHOTOGRAPHER'?'selected':''}>Photographer booking</option>
          <option value="VIDEOGRAPHER" ${tp.role==='VIDEOGRAPHER'?'selected':''}>Videographer booking</option></select></div>
      </div>
      <div class="fgrid two">
        <div class="fld"><label>Deadline dihitung dari</label><select id="tpAnchor">
          <option value="STAGE" ${tp.due_anchor==='STAGE'?'selected':''}>Hari masuk tahap</option>
          <option value="SESSION" ${tp.due_anchor==='SESSION'?'selected':''}>Tanggal sesi foto</option>
          <option value="NONE" ${tp.due_offset===null?'selected':''}>Tanpa deadline</option></select></div>
        <div class="fld"><label>Selisih hari</label><input id="tpOffset" type="number" value="${tp.due_offset ?? 0}" step="1">
          <div class="hint">Negatif = sebelum (mis. -1 = H-1 sesi).</div></div>
      </div>
      <div class="fgrid two">
        <div class="fld"><label>Prioritas</label><select id="tpPri">${Object.entries(PRIORITY).map(([k, p]) => `<option value="${k}" ${tp.priority===k?'selected':''}>${p.text}</option>`).join('')}</select></div>
        <label class="mn-check"><input type="checkbox" id="tpActive" ${tp.is_active?'checked':''}><div><b>Aktif</b><small>Nonaktif = tidak dibuat otomatis.</small></div></label>
      </div>
      <div class="fld"><label>Checklist (satu per baris)</label><textarea id="tpCl" rows="4" placeholder="Charge baterai&#10;Format memory card">${esc((tp.checklist||[]).join('\n'))}</textarea></div>
      <div class="fld"><label>Deskripsi (opsional)</label><textarea id="tpDesc" rows="2">${esc(tp.description||'')}</textarea></div>
    </div>
    <div class="acts">
      ${id ? '<button class="btn soft danger-soft" id="tpDel">Hapus</button>' : ''}
      <button class="btn soft" id="tpBack">Kembali</button><button class="btn" id="tpSave">Simpan</button>
    </div>`);
  const syncAnchor = () => { $('#tpOffset').disabled = $('#tpAnchor').value === 'NONE'; };
  syncAnchor(); $('#tpAnchor').onchange = syncAnchor;
  $('#tpBack').onclick = templateManager;
  $('#tpSave').onclick = async () => {
    const title = $('#tpTitle').value.trim();
    if(!title) return toast('Judul tugas belum diisi');
    const anchor = $('#tpAnchor').value;
    const row = {
      title, stage:$('#tpStage').value, role:$('#tpRole').value || null,
      due_anchor: anchor === 'NONE' ? 'STAGE' : anchor,
      due_offset: anchor === 'NONE' ? null : Math.round(Number($('#tpOffset').value) || 0),
      priority:$('#tpPri').value, is_active:$('#tpActive').checked,
      checklist: $('#tpCl').value.split('\n').map(s => s.trim()).filter(Boolean),
      description: $('#tpDesc').value.trim() || null
    };
    const ok = await safely(async () => {
      if(id){
        await api('task_templates?id=eq.' + id, {method:'PATCH', body:row, prefer:'return=minimal'});
        Object.assign(tp, row);
        await logAct('update', 'Template SOP', title, stageInfo(row.stage).label);
      } else {
        row.position = Math.max(0, ...S.data.taskTemplates.filter(t => t.stage === row.stage).map(t => t.position)) + 1;
        const [saved] = await api('task_templates', {method:'POST', body:row, prefer:'return=representation'});
        S.data.taskTemplates.push(saved);
        await logAct('create', 'Template SOP', title, stageInfo(row.stage).label);
      }
    });
    if(ok){ toast('Template SOP tersimpan'); templateManager(); }
  };
  const del = $('#tpDel');
  if(del) del.onclick = async () => {
    if(!await confirmBox('Hapus template?', `"${tp.title}" tidak akan dibuat lagi untuk booking baru. Tugas yang sudah ada tidak terhapus.`)) return templateEditor(id);
    const ok = await safely(async () => {
      await api('task_templates?id=eq.' + id, {method:'DELETE', prefer:'return=minimal'});
      S.data.taskTemplates = S.data.taskTemplates.filter(t => t.id !== id);
      await logAct('delete', 'Template SOP', tp.title, stageInfo(tp.stage).label);
    });
    if(ok) templateManager();
  };
}

/* =====================================================================
   BAGIAN TUGAS DI DETAIL BOOKING (drawer)
   ===================================================================== */
DRAWER_SECTIONS.push({html:bookingTasksCard, bind:bindBookingTasks});
function bookingTasksCard(b){
  if(!S.data.tasksReady) return '';
  const list = S.data.tasks.filter(t => t.booking_id === b.id);
  const cur = stageOf(b);
  const order = s => s === cur ? -1 : STAGES.findIndex(x => x.id === s);
  const groups = [...new Set(list.map(t => t.stage || ''))].sort((a, c) => order(a) - order(c));
  const p = stageProgress(b);
  return `<div class="card" style="margin-bottom:13px">
    <div style="display:flex;align-items:center;gap:8px"><b style="font-size:13px">Tugas project</b>
      ${p.total ? `<span class="badge ${p.done===p.total?'b-ok':'b-neutral'}">${p.done}/${p.total} tahap ${esc(stageInfo(cur)?.label||'')}</span>` : ''}
      <button class="btn soft sm" id="btOpen" style="margin-left:auto">Buka di Task Board</button></div>
    <div class="tsub" style="margin:4px 0 10px">Tugas SOP dibuat otomatis setiap booking pindah tahap di Joblist.</div>
    ${groups.map(g => {
      const rows = list.filter(t => (t.stage || '') === g).sort((x, y) => (x.done - y.done) || (x.due_date||'9999').localeCompare(y.due_date||'9999'));
      const st = stageInfo(g);
      return `<div class="tk-dgroup"><div class="flabel" style="margin:10px 0 4px">${st ? st.label : 'Lainnya'}${g === cur ? ' · tahap sekarang' : ''}</div>
        ${rows.map(t => {
          const ds = dueState(t), who = assignee(t);
          return `<div class="tk-row ${t.done?'done':''}">
            <button class="tk-chk ${t.done?'on':''}" data-btdone="${t.id}" aria-label="Selesai">${IC.tick}</button>
            <button class="tk-row-t" data-btopen="${t.id}">${esc(t.title)}</button>
            ${t.due_date ? `<span class="tk-due ${t.done?'ok':ds||''}">${dueText(t)}</span>` : ''}
            ${who ? `<span class="tk-av" title="${esc(who)}">${initials(who)}</span>` : ''}
          </div>`;
        }).join('')}</div>`;
    }).join('') || '<div class="tsub">Belum ada tugas untuk booking ini.</div>'}
    <div style="display:flex;gap:7px;margin-top:12px;flex-wrap:wrap">
      <button class="btn soft sm" id="btAdd">+ Tugas</button>
      <button class="btn soft sm" id="btSeed">Terapkan SOP tahap ${esc(stageInfo(cur)?.label || '')}</button>
    </div>
  </div>`;
}
function bindBookingTasks(b, refresh){
  if(!S.data.tasksReady) return;
  $('#btOpen').onclick = () => openProjectTasks(b.id);
  $$('[data-btdone]').forEach(x => x.onclick = async () => {
    const t = taskOf(x.dataset.btdone);
    if(await safely(() => setDone(t.id, !t.done))) refresh();
  });
  $$('[data-btopen]').forEach(x => x.onclick = () => openTask(x.dataset.btopen));
  $('#btAdd').onclick = () => {
    const pb = projectBoard();
    const first = pb && listsOf(pb.id).find(l => !l.is_done);
    if(!first) return toast('Board project belum punya kolom');
    openModal(`<h3>Tugas baru</h3><p>${esc(b.client_display)}</p>
      <div class="fld" style="margin-top:16px"><label>Judul tugas</label><input id="btTitle" placeholder="mis. Kirim preview 10 foto"></div>
      <div class="fld" style="margin-top:11px"><label>Deadline</label><input id="btDue" type="date"></div>
      <div class="acts"><button class="btn soft" data-mclose>Batal</button><button class="btn" id="btSave">Tambah</button></div>`);
    $('#btTitle').focus();
    $('#btSave').onclick = async () => {
      const title = $('#btTitle').value.trim();
      if(!title) return toast('Judul tugas belum diisi');
      const ok = await safely(() => createTask({board_id:pb.id, list_id:first.id, position:endOf(first.id), title,
        booking_id:b.id, stage:stageOf(b), due_date:$('#btDue').value || null}));
      closeModal(); if(ok) refresh();
    };
  };
  $('#btSeed').onclick = async () => {
    const n = S.data.tasks.length;
    const ok = await safely(async () => {
      await api('rpc/apply_stage_tasks', {method:'POST', body:{p_booking:b.id}});
      S.data.tasks = S.data.tasks.filter(t => t.booking_id !== b.id)
        .concat(await api('tasks?select=*&order=position&booking_id=eq.' + b.id));
    });
    if(ok){
      const added = S.data.tasks.length - n;
      toast(added ? `${added} tugas SOP ditambahkan` : 'Semua tugas SOP tahap ini sudah ada');
      if(added) await logAct('create', 'Tugas', b.client_display, `${added} tugas SOP tahap ${stageInfo(stageOf(b))?.label}`);
      refreshBell(); refresh();
    }
  };
}
