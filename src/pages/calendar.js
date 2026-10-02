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
  $('#pgSub').textContent = title;

  $('#page').innerHTML = `
    <div class="sec-h" style="margin-top:0">
      <button class="btn soft sm" id="prevM">‹ Sebelumnya</button>
      <h3 style="margin:0 6px">${title}</h3>
      <button class="btn soft sm" id="nextM">Berikutnya ›</button>
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
            ${list.slice(0,2).map(b=>`<button data-cb="${b.id}" class="mcal-ev ${b.crew_status==='COMPLETE'?'ok':'bad'}">${esc(b.client_display)}</button>`).join('')}
            ${list.length>2?`<div class="more">+${list.length-2} lagi</div>`:''}
          </div>`;
        }).join('')}
      </div>
      <div style="display:flex;gap:14px;margin-top:14px;font-size:11.5px;color:var(--muted)">
        <span><span class="sw-dot" style="background:var(--ok)"></span> Crew lengkap</span>
        <span><span class="sw-dot" style="background:var(--err)"></span> Crew belum lengkap</span>
      </div>
    </div>`;
  $('#prevM').onclick = () => { calMonth = new Date(y,m-1,1); RENDER.calendar(); };
  $('#nextM').onclick = () => { calMonth = new Date(y,m+1,1); RENDER.calendar(); };
  $$('[data-cb]').forEach(b=>b.onclick=()=>bookingDrawer(b.dataset.cb));
};
