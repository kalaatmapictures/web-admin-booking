/* =====================================================================
   DATE PICKER — kalender ala Skyscanner
   Dua mode: rentang tanggal, atau satu bulan penuh.
   ===================================================================== */
import { $, $$, today, openModal, closeModal } from './core.js';

const CAL = { mode:'range', view:new Date(), from:null, to:null, onApply:null, label:null };
const DAY_NAMES = ['Sen','Sel','Rab','Kam','Jum','Sab','Min'];
const MON_NAMES = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
export const MON_FULL = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
export const dISO = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const shortDate = v => { const d = new Date(v+'T00:00:00'); return `${d.getDate()} ${MON_NAMES[d.getMonth()]}`; };

export function calLabel(from, to, monthLabel){
  if(monthLabel) return monthLabel;
  if(!from && !to) return 'Semua tanggal';
  if(from && to && from === to) return shortDate(from) + ' ' + new Date(from+'T00:00:00').getFullYear();
  if(from && to) return `${shortDate(from)} – ${shortDate(to)} ${new Date(to+'T00:00:00').getFullYear()}`;
  return `Mulai ${shortDate(from)}`;
}

function calGrid(){
  const y = CAL.view.getFullYear(), m = CAL.view.getMonth();
  const first = new Date(y, m, 1), last = new Date(y, m+1, 0);
  const lead = (first.getDay() + 6) % 7;                 // Senin sebagai kolom pertama
  const prevLast = new Date(y, m, 0).getDate();
  const cells = [];
  for(let i = lead - 1; i >= 0; i--) cells.push({d: new Date(y, m-1, prevLast - i), out:true});
  for(let d = 1; d <= last.getDate(); d++) cells.push({d: new Date(y, m, d), out:false});
  while(cells.length % 7) cells.push({d: new Date(y, m+1, cells.length - lead - last.getDate() + 1), out:true});
  return cells.map(c => {
    const v = dISO(c.d);
    const isFrom = CAL.from === v, isTo = CAL.to === v;
    const inSpan = CAL.from && CAL.to && v > CAL.from && v < CAL.to;
    const cls = ['cal-d', c.out?'out':'', (isFrom||isTo)?'sel':'', inSpan?'span':'', v===today()?'now':''].filter(Boolean).join(' ');
    return `<button type="button" class="${cls}" data-cal="${v}">${c.d.getDate()}</button>`;
  }).join('');
}
function calMonths(){
  const y = CAL.view.getFullYear();
  return MON_FULL.map((n,i) =>
    `<button type="button" class="cal-m ${CAL.label===n+' '+y?'sel':''}" data-calmon="${i}">${n}</button>`).join('');
}
function calRender(){
  const y = CAL.view.getFullYear(), m = CAL.view.getMonth();
  $('#calBody').innerHTML = CAL.mode === 'range'
    ? `<div class="cal-nav">
         <button type="button" id="calPrev" aria-label="Bulan sebelumnya">‹</button>
         <span>${MON_FULL[m]} ${y}</span>
         <button type="button" id="calNext" aria-label="Bulan berikutnya">›</button>
       </div>
       <div class="cal-dow">${DAY_NAMES.map(d=>`<span>${d}</span>`).join('')}</div>
       <div class="cal-grid">${calGrid()}</div>
       <div class="cal-hint">${CAL.from && !CAL.to ? 'Pilih tanggal akhir, atau ketuk tanggal yang sama untuk satu hari.' : 'Ketuk tanggal awal lalu tanggal akhir.'}</div>`
    : `<div class="cal-nav">
         <button type="button" id="calPrev" aria-label="Tahun sebelumnya">‹</button>
         <span>${y}</span>
         <button type="button" id="calNext" aria-label="Tahun berikutnya">›</button>
       </div>
       <div class="cal-mgrid">${calMonths()}</div>
       <div class="cal-hint">Pilih satu bulan penuh.</div>`;

  $$('#calTabs [data-calmode]').forEach(b => b.classList.toggle('on', b.dataset.calmode === CAL.mode));
  $('#calSum').textContent = calLabel(CAL.from, CAL.to, CAL.label);

  $('#calPrev').onclick = () => { CAL.view = CAL.mode==='range' ? new Date(y, m-1, 1) : new Date(y-1, m, 1); calRender(); };
  $('#calNext').onclick = () => { CAL.view = CAL.mode==='range' ? new Date(y, m+1, 1) : new Date(y+1, m, 1); calRender(); };

  $$('[data-cal]').forEach(b => b.onclick = () => {
    const v = b.dataset.cal;
    CAL.label = null;
    if(!CAL.from || CAL.to){ CAL.from = v; CAL.to = null; }
    else if(v < CAL.from){ CAL.from = v; }
    else { CAL.to = v; }
    calRender();
  });
  $$('[data-calmon]').forEach(b => b.onclick = () => {
    const i = Number(b.dataset.calmon);
    CAL.from = dISO(new Date(y, i, 1));
    CAL.to   = dISO(new Date(y, i+1, 0));
    CAL.label = MON_FULL[i] + ' ' + y;
    calRender();
  });
}
export function openCalendar({from, to, label, onApply}){
  Object.assign(CAL, {from: from||null, to: to||null, label: label||null, onApply,
    mode: label ? 'month' : 'range',
    view: from ? new Date(from+'T00:00:00') : new Date()});
  openModal(`<div class="cal">
      <div class="cal-tabs" id="calTabs">
        <button type="button" data-calmode="range">Tanggal tertentu</button>
        <button type="button" data-calmode="month">Bulan penuh</button>
      </div>
      <div id="calBody"></div>
      <div class="cal-foot">
        <button type="button" class="btn ghost sm" id="calClear">Semua tanggal</button>
        <span class="cal-sum" id="calSum"></span>
        <button type="button" class="btn sm" id="calApply">Terapkan</button>
      </div>
    </div>`);
  $$('#calTabs [data-calmode]').forEach(b => b.onclick = () => {
    CAL.mode = b.dataset.calmode;
    if(CAL.mode === 'range') CAL.label = null;
    calRender();
  });
  $('#calClear').onclick = () => { CAL.from = CAL.to = CAL.label = null; calRender(); };
  $('#calApply').onclick = () => {
    const f = CAL.from, t = CAL.to || CAL.from;
    closeModal();
    CAL.onApply?.({from: f, to: t, label: CAL.label});
  };
  calRender();
}

/* tombol pemicu kalender yang dipakai di beberapa halaman */
export function dateButton(id, f){
  const active = !!(f.from || f.to);
  return `<button class="datebtn ${active?'on':''}" id="${id}">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 11h18"/></svg>
    ${calLabel(f.from, f.to, f.monthLabel)}
    ${active ? `<span class="x" data-clear>✕</span>` : ''}
  </button>`;
}
export function bindDateButton(id, f, rerender){
  $('#' + id).onclick = e => {
    if(e.target.hasAttribute('data-clear')){
      e.stopPropagation();
      f.from = f.to = f.monthLabel = null; rerender(); return;
    }
    openCalendar({from:f.from, to:f.to, label:f.monthLabel, onApply: r => {
      f.from = r.from; f.to = r.to; f.monthLabel = r.label; rerender();
    }});
  };
}
