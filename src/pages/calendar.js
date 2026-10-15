/* KALENDER — jadwal sesi bulan berjalan */
import { $, $$, S, RENDER, esc, iso, today } from '../core.js';
import { bookingDrawer } from './detail.js';

let calMonth = new Date();
RENDER.calendar = () => {
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  const first = new Date(y,m,1), last = new Date(y,m+1,0);
  const pad = (first.getDay()+6)%7;
  const cells = [];
  for(let i=0;i<pad;i++) cells.push(null);
  for(let d=1; d<=last.getDate(); d++) cells.push(iso(new Date(y,m,d)));
  const byDay = {};
  S.data.bookings.filter(b=>b.status!=='CANCELLED').forEach(b=>{ (byDay[b.session_date] ||= []).push(b); });
  const title = calMonth.toLocaleDateString('id-ID',{month:'long',year:'numeric'});
  const ym = `${y}-${String(m+1).padStart(2,'0')}`;
  const agenda = S.data.bookings.filter(b => b.status!=='CANCELLED' && (b.session_date||'').startsWith(ym))
    .sort((a,b) => (a.session_date+a.session_time).localeCompare(b.session_date+b.session_time));
  $('#pgSub').textContent = title;

  $('#page').innerHTML = `
    <div class="mcal-nav">
      <button class="btn soft sm" id="prevM" aria-label="Bulan sebelumnya">‹<span class="hide-m"> Sebelumnya</span></button>
      <h3>${title}</h3>
      <button class="btn soft sm" id="nextM" aria-label="Bulan berikutnya"><span class="hide-m">Berikutnya </span>›</button>
    </div>
    <div class="card">
      <div class="mcal-dow">${['Sen','Sel','Rab','Kam','Jum','Sab','Min'].map(d=>`<div>${d}</div>`).join('')}</div>
      <div class="mcal">
        ${cells.map(c => {
          if(!c) return '<div></div>';
          const list = byDay[c]||[];
          const isToday = c===today();
          return `<div class="mcal-d ${isToday?'now':''}">
            <div class="n">${Number(c.slice(-2))}</div>
            ${list.length ? `<div class="mcal-dots">${list.slice(0,3).map(b => `<i class="${b.crew_status==='COMPLETE'?'ok':'bad'}"></i>`).join('')}</div>` : ''}
            ${list.slice(0,2).map(b=>`<button data-cb="${b.id}" class="mcal-ev ${b.crew_status==='COMPLETE'?'ok':'bad'}">${esc(b.client_display)}</button>`).join('')}
            ${list.length>2?`<div class="more">+${list.length-2} lagi</div>`:''}
          </div>`;
        }).join('')}
      </div>
      <div style="display:flex;gap:14px;margin-top:14px;font-size:11.5px;color:var(--muted)">
        <span><span class="sw-dot" style="background:var(--ok)"></span> Crew lengkap</span>
        <span><span class="sw-dot" style="background:var(--err)"></span> Crew belum lengkap</span>
      </div>
    </div>
    ${agenda.length ? `<div class="sec-h"><h3>Jadwal ${title}</h3></div>
    <div class="card cal-agenda">${agenda.map(b => `<button class="cal-item" data-cb="${b.id}">
        <span class="d"><b>${Number(b.session_date.slice(-2))}</b>${new Date(b.session_date+'T00:00:00').toLocaleDateString('id-ID',{weekday:'short'})}</span>
        <span class="i"><b>${esc(b.client_display)}</b><span class="tsub">${esc(b.service)} · ${esc(b.session_time||'')}${b.location ? ' · ' + esc(b.location) : ''}</span></span>
        <span class="badge ${b.crew_status==='COMPLETE'?'b-ok':'b-err'}">${b.crew_status==='COMPLETE'?'Crew lengkap':'Crew kurang'}</span>
      </button>`).join('')}</div>` : ''}`;
  $('#prevM').onclick = () => { calMonth = new Date(y,m-1,1); RENDER.calendar(); };
  $('#nextM').onclick = () => { calMonth = new Date(y,m+1,1); RENDER.calendar(); };
  $$('[data-cb]').forEach(b=>b.onclick=()=>bookingDrawer(b.dataset.cb));
};
