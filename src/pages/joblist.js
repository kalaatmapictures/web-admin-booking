/* =====================================================================
   JOBLIST — papan kanban 5 kolom. Booking baru dari landing page
   (status NEW) otomatis muncul di kolom BOOKING.
   ===================================================================== */
import { $, $$, S, F, RENDER, rp, esc, today, inRange, fmtDate, initials, toast,
         openModal, closeModal, saveBooking, crewBadge, searchBox, bindSearch, bookingMatch } from '../core.js';
import { STAGES, stageOf, stageIx, catGroups, catGroup, PAY_LABELS, payLabel, MANUAL_LABELS, labelChips } from '../stages.js';
import { calLabel, dateButton, bindDateButton } from '../datepicker.js';
import { bookingDrawer } from './detail.js';
import { renderTasks, tasksOf } from './tasks.js';

const JB = { view:'card', drag:null, sort:'nearest', cat:'ALL', from:null, to:null, monthLabel:null };

async function moveStage(id, target){
  const b = S.data.bookings.find(x => x.id === id);
  if(!b || stageOf(b) === target) return;
  const st = STAGES.find(s => s.id === target);

  // pindah ke Onboarding = status CONFIRMED, jadi pengaman crew tetap berlaku
  if(st.primary === 'CONFIRMED' && b.crew_status !== 'COMPLETE'){
    openModal(`<div class="warnicon">⚠</div>
      <h3>Crew belum lengkap</h3>
      <p>Memindahkan ke <b>Onboarding</b> akan mengubah status jadi CONFIRMED, tapi booking ini belum punya crew lengkap.</p>
      <div style="margin-top:15px">
        <div class="rowline"><span class="k">Photographer</span><span class="v">${b.photographer_name?esc(b.photographer_name):'<span style="color:var(--err)">Belum ditugaskan</span>'}</span></div>
        <div class="rowline"><span class="k">Videographer</span><span class="v">${b.videographer_name?esc(b.videographer_name):'<span style="color:var(--err)">Belum ditugaskan</span>'}</span></div>
      </div>
      ${F.booking.requireCrew ? `<p style="margin-top:14px;color:var(--err)">Setting <b>Require Complete Crew Before Confirmation</b> aktif, jadi pemindahan diblokir.</p>` : ''}
      <div class="acts">
        <button class="btn soft" id="jbAssign">Assign Crew</button>
        ${F.booking.requireCrew ? '' : '<button class="btn" id="jbAnyway">Pindahkan Saja</button>'}
      </div>`);
    $('#jbAssign').onclick = () => { closeModal(); bookingDrawer(id); };
    const any = $('#jbAnyway');
    if(any) any.onclick = async () => {
      await saveBooking(id, {status:st.primary, crew_override_note:'Dipindahkan ke Onboarding tanpa crew lengkap pada '+today()});
      closeModal(); toast('Dipindahkan — ditandai crew belum lengkap'); RENDER.joblist();
    };
    return;
  }
  try{
    await saveBooking(id, {status: st.primary});
    toast(`Dipindahkan ke ${st.label}`);
  }catch(e){ toast('Gagal memindahkan: ' + e.message); }
  RENDER.joblist();
}

/* progres task after event di kartu booking, mis. "Task 1/3" */
const taskChip = b => {
  const list = tasksOf(b.id);
  if(!list.length) return '';
  const done = list.filter(t => t.status === 'DONE').length;
  return `<span class="tk-chip ${done === list.length ? 'ok' : ''}" title="Task after event selesai">Task ${done}/${list.length}</span>`;
};

function jbCard(b){
  const st = stageOf(b), i = stageIx(st);
  const crew = [
    b.photographer_name ? `<span class="jb-av" title="Photographer: ${esc(b.photographer_name)}">${initials(b.photographer_name)}</span>`
      : (b.needs_photographer ? '<span class="jb-av none" title="Photographer belum ditugaskan">P?</span>' : ''),
    b.videographer_name ? `<span class="jb-av" title="Videographer: ${esc(b.videographer_name)}">${initials(b.videographer_name)}</span>`
      : (b.needs_videographer ? '<span class="jb-av none" title="Videographer belum ditugaskan">V?</span>' : '')
  ].join('');
  return `<div class="jb-card" draggable="true" data-jb="${b.id}">
    <div class="lbs">${b.status==='NEW' && b.source==='website' ? '<span class="lb lb-grey">Baru · Website</span>' : ''}${labelChips(b)}</div>
    <div class="nm" data-jbopen="${b.id}">${esc(b.client_display)}</div>
    <div class="sub">${esc(b.service)} · ${esc(b.package_name)}</div>
    <div class="jb-meta">
      <span class="mi">${fmtDate(b.session_date)}</span>
      ${b.needs_attention ? '<span class="mi" style="color:var(--err)">⚠</span>' : ''}
      <span class="tot">${rp(b.total_invoice)}</span>
    </div>
    <div class="jb-crew">${crew}${taskChip(b)}</div>
    <div class="jb-foot">
      <button data-jbmove="${b.id}" data-dir="-1" ${i<=0?'disabled':''} title="Pindah ke kiri">‹</button>
      <button data-jbmove="${b.id}" data-dir="1" ${i>=STAGES.length-1?'disabled':''} title="Pindah ke kanan">›</button>
      <button class="lbbtn" data-jbopen="${b.id}">Detail</button>
      <button class="lbbtn alt" data-jblabel="${b.id}">Label</button>
    </div>
  </div>`;
}

RENDER.joblist = () => {
  const tab = F.joblist.tab;
  const tabs = `<div class="fl-tabs">
      <button class="${tab === 'board' ? 'on' : ''}" data-jbtab="board">Papan Booking</button>
      <button class="${tab === 'tasks' ? 'on' : ''}" data-jbtab="tasks">Task After Event${(S.data.postTasks || []).filter(t => t.status !== 'DONE').length
        ? ` <span class="fl-n2">${S.data.postTasks.filter(t => t.status !== 'DONE').length}</span>` : ''}</button>
    </div>`;
  const bindTabs = () => $$('[data-jbtab]').forEach(b => b.onclick = () => { F.joblist.tab = b.dataset.jbtab; RENDER.joblist(); });
  if(tab === 'tasks'){ renderTasks(tabs); bindTabs(); return; }

  const cat = catGroup(JB.cat); JB.cat = cat.id;
  const all = S.data.bookings.filter(b =>
    stageOf(b) &&
    (!cat.services || cat.services.includes(b.service)) &&
    inRange(b.session_date, {from: JB.from, to: JB.to}) &&
    (!JB.q || bookingMatch(b, JB.q)));

  const cancelled = S.data.bookings.filter(b => b.status === 'CANCELLED').length;
  const bits = [`${all.length} kartu di papan`];
  if(JB.cat !== 'ALL') bits.push(cat.label);
  if(JB.q) bits.push(`cari "${JB.q}"`);
  if(JB.from || JB.to) bits.push(calLabel(JB.from, JB.to, JB.monthLabel));
  if(cancelled) bits.push(`${cancelled} dibatalkan (tidak ditampilkan)`);
  $('#pgSub').textContent = bits.join(' · ');

  const sorters = {
    nearest:  (a,b) => (a.session_date||'9999').localeCompare(b.session_date||'9999'),
    farthest: (a,b) => (b.session_date||'0000').localeCompare(a.session_date||'0000'),
    newest:   (a,b) => (b.created_at||'').localeCompare(a.created_at||''),
    oldest:   (a,b) => (a.created_at||'').localeCompare(b.created_at||'')
  };
  const byStage = Object.fromEntries(STAGES.map(s =>
    [s.id, all.filter(b => stageOf(b) === s.id).sort(sorters[JB.sort])]));

  // ---- overview ----
  const stageCards = STAGES.map(s => `<div class="card kpi jb-ov" data-jbjump="${s.id}">
      <div class="lbl">${s.label}</div><div class="val">${byStage[s.id].length}</div><div class="cap">kartu</div>
    </div>`).join('');
  const payCards = PAY_LABELS.map(p => `<div class="card kpi jb-ov">
      <div class="lbl">${p.text}</div><div class="val">${all.filter(b => payLabel(b)?.id === p.id).length}</div><div class="cap">kartu</div>
    </div>`).join('');
  const overview = `${tabs}
    <div class="grid jb-ov-grid">${stageCards}</div>
    <div class="grid g3" style="margin-top:12px">${payCards}</div>
    <div class="sec-h"><h3>Papan</h3></div>`;

  const toggle = `<div class="jb-bar">
      ${searchBox('jbQ', JB, 'Cari client, paket, crew, WA…')}
      <div class="chips">
        <button class="chip ${JB.view==='card'?'on':''}" data-jbview="card">Papan Kartu</button>
        <button class="chip ${JB.view==='list'?'on':''}" data-jbview="list">Daftar</button>
      </div>
      <label class="selchip"><span>Kategori</span><select id="jbCat" aria-label="Kategori">
          ${catGroups().map(c => `<option value="${esc(c.id)}" ${JB.cat===c.id?'selected':''}>${esc(c.label)}</option>`).join('')}
        </select></label>
      <div class="chips">${dateButton('jbDate', JB)}</div>
      <label class="selchip"><span>Urutkan</span><select id="jbSort" aria-label="Urutkan">
        <option value="nearest" ${JB.sort==='nearest'?'selected':''}>Terdekat</option>
        <option value="farthest" ${JB.sort==='farthest'?'selected':''}>Terjauh</option>
      </select></label>
    </div>`;

  if(JB.view === 'card'){
    $('#page').innerHTML = overview + toggle + `<div class="jb-wrap">${STAGES.map(s => {
      const rows = byStage[s.id];
      return `<section class="jb-col" data-stage="${s.id}">
        <div class="jb-h">
          <span class="dot" style="background:${s.color}"></span>
          <span class="t">${s.label}</span>
          <span class="c">${rows.length}</span>
        </div>
        <div class="jb-list">${rows.map(jbCard).join('') || '<div class="jb-empty">Belum ada kartu</div>'}</div>
      </section>`;
    }).join('')}</div>`;
  } else {
    $('#page').innerHTML = overview + toggle + STAGES.map(s => {
      const rows = byStage[s.id];
      return `<section class="jb-sec" data-stage="${s.id}">
        <div class="jb-sec-h">
          <span class="dot" style="background:${s.color}"></span>
          <span class="t">${s.label}</span><span class="c">${rows.length}</span>
        </div>
        ${rows.length ? `<div class="card"><div class="tablewrap"><table>
          <thead><tr><th>Client</th><th>Label</th><th>Tanggal</th><th>Crew</th><th class="r">Total</th><th class="r">Pindah</th></tr></thead>
          <tbody>${rows.map(b => `<tr>
            <td><div class="tname" data-jbopen="${b.id}" style="cursor:pointer">${esc(b.client_display)}</div>
                <div class="tsub">${esc(b.service)} · ${esc(b.package_name)}</div></td>
            <td><div class="lbs">${labelChips(b)}</div></td>
            <td>${fmtDate(b.session_date)}</td>
            <td>${crewBadge(b.crew_status)}</td>
            <td class="r num" style="font-weight:600">${rp(b.total_invoice)}</td>
            <td class="r"><div style="display:inline-flex;gap:5px">
              <button class="btn soft sm" data-jbmove="${b.id}" data-dir="-1" ${stageIx(s.id)<=0?'disabled':''}>‹</button>
              <button class="btn soft sm" data-jbmove="${b.id}" data-dir="1" ${stageIx(s.id)>=STAGES.length-1?'disabled':''}>›</button>
              <button class="btn soft sm" data-jbopen="${b.id}">Detail</button>
              <button class="btn soft sm" data-jblabel="${b.id}">Label</button>
            </div></td>
          </tr>`).join('')}</tbody></table></div></div>`
        : `<div class="card"><div class="jb-empty" style="border:0">Belum ada kartu di tahap ini</div></div>`}
      </section>`;
    }).join('');
  }

  bindTabs();
  bindSearch('jbQ', JB, RENDER.joblist);
  $$('[data-jbview]').forEach(b => b.onclick = () => { JB.view = b.dataset.jbview; RENDER.joblist(); });
  $('#jbSort').onchange = e => { JB.sort = e.target.value; RENDER.joblist(); };
  $('#jbCat').onchange = e => { JB.cat = e.target.value; RENDER.joblist(); };
  bindDateButton('jbDate', JB, RENDER.joblist);
  $$('[data-jbjump]').forEach(b => b.onclick = () => {
    document.querySelector(`[data-stage="${b.dataset.jbjump}"]`)?.scrollIntoView({behavior:'smooth', block:'nearest', inline:'start'});
  });
  $$('[data-jbopen]').forEach(b => b.onclick = e => { e.stopPropagation(); bookingDrawer(b.dataset.jbopen); });
  $$('[data-jbmove]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    const bk = S.data.bookings.find(x => x.id === b.dataset.jbmove);
    const next = STAGES[stageIx(stageOf(bk)) + Number(b.dataset.dir)];
    if(next) moveStage(b.dataset.jbmove, next.id);
  });
  $$('[data-jblabel]').forEach(b => b.onclick = e => { e.stopPropagation(); labelEditor(b.dataset.jblabel); });

  // drag & drop untuk desktop; tombol ‹ › menangani layar sentuh
  $$('.jb-card').forEach(c => {
    c.addEventListener('dragstart', e => { JB.drag = c.dataset.jb; c.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; try{e.dataTransfer.setData('text/plain', c.dataset.jb);}catch(_){} });
    c.addEventListener('dragend', () => { c.classList.remove('dragging'); JB.drag = null; });
  });
  $$('.jb-col').forEach(col => {
    col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', () => col.classList.remove('over'));
    col.addEventListener('drop', e => {
      e.preventDefault(); col.classList.remove('over');
      const id = JB.drag || (() => { try{ return e.dataTransfer.getData('text/plain'); }catch(_){ return null; } })();
      if(id) moveStage(id, col.dataset.stage);
    });
  });
};

function labelEditor(id){
  const b = S.data.bookings.find(x => x.id === id);
  const auto = payLabel(b);
  const cur = new Set((b.labels || []).filter(l => !l.startsWith('PAY_')));

  openModal(`<h3>Label kartu</h3>
    <p>${esc(b.client_display)}</p>
    <div style="margin-top:18px;text-align:left">
      <div class="mlabel">Pembayaran</div>
      <div class="lbs" style="display:flex;gap:6px;margin:9px 0 0">
        ${auto ? `<span class="lb ${auto.cls}">${auto.text}</span>` : '<span class="lb lb-grey">—</span>'}
      </div>
      <div class="tsub" style="margin-top:8px">
        Otomatis dari data pembayaran. Terbayar ${rp(b.paid_amount)} dari ${rp(b.total_invoice)}, sisa ${rp(b.remaining_payment)}.
        Untuk mengubahnya, catat pembayaran lewat tombol Detail.
      </div>

      <div class="mlabel" style="margin-top:20px">Progres</div>
      <div class="lbs" style="display:flex;gap:6px;margin-top:9px;flex-wrap:wrap">
        ${MANUAL_LABELS.map(L => `<span class="lb ${L.cls} pick ${cur.has(L.id)?'on':''}" data-lb="${L.id}">${L.text}</span>`).join('')}
      </div>
      <div class="tsub" style="margin-top:8px">Ketuk untuk menyalakan atau mematikan.</div>
    </div>
    <div class="acts"><button class="btn soft" data-mclose>Batal</button><button class="btn" id="lbSave">Simpan</button></div>`);

  $$('[data-lb]').forEach(el => el.onclick = () => {
    const k = el.dataset.lb;
    cur.has(k) ? cur.delete(k) : cur.add(k);
    el.classList.toggle('on', cur.has(k));
  });
  $('#lbSave').onclick = async () => {
    await saveBooking(id, {labels: Array.from(cur)});
    closeModal(); RENDER.joblist(); toast('Label diperbarui');
  };
}
