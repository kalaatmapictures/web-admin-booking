/* LOG AKTIVITAS ADMIN — setiap perubahan di BMS tercatat:
   booking, pembayaran, kas, freelancer, paket, dan menu landing page.
   Di Supabase log bersifat append-only (tidak bisa diubah/dihapus). */
import { $, S, F, RENDER, esc, empty } from '../core.js';

export const ACT = {
  create:['Tambah','b-ok'], update:['Ubah','b-neutral'], status:['Status','b-neutral'], delete:['Hapus','b-err'],
  hide:['Sembunyi','b-grey'], show:['Tampil','b-grey'], reorder:['Urutan','b-grey'], system:['Data','b-warn']
};
const actBadge = a => { const [t, c] = ACT[a] || [a, 'b-grey']; return `<span class="badge ${c} act-b">${esc(t)}</span>`; };

export function ago(isoStr){
  const s = (Date.now() - new Date(isoStr)) / 1000;
  if(s < 60) return 'baru saja';
  if(s < 3600) return `${Math.floor(s / 60)} menit lalu`;
  if(s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  if(s < 172800) return 'kemarin';
  return new Date(isoStr).toLocaleDateString('id-ID', {day:'numeric', month:'short', year:'numeric'});
}
const hm = isoStr => new Date(isoStr).toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'});
const dayLabel = isoStr => {
  const d = new Date(isoStr), t = new Date();
  const k = x => x.toDateString();
  if(k(d) === k(t)) return 'Hari ini';
  t.setDate(t.getDate() - 1);
  if(k(d) === k(t)) return 'Kemarin';
  return d.toLocaleDateString('id-ID', {weekday:'long', day:'numeric', month:'long', year:'numeric'});
};

/* daftar ringkas — dipakai juga di Dashboard */
export function activityFeed(list){
  if(!list.length) return `<div class="empty" style="padding:22px"><span>Belum ada aktivitas. Setiap perubahan admin akan tercatat di sini.</span></div>`;
  return `<div class="feed">${list.map(a => `<div class="feed-i">
      ${actBadge(a.action)}
      <div class="feed-t"><b>${esc(a.entity)} · ${esc(a.target)}</b>${a.detail ? `<span>${esc(a.detail)}</span>` : ''}
        <small>${esc(a.actor)} · ${ago(a.at)}</small></div>
    </div>`).join('')}</div>`;
}

function filtered(){
  const f = F.activity, q = f.q.toLowerCase();
  return S.data.activity.filter(a =>
    (!f.action || a.action === f.action) &&
    (!f.entity || a.entity === f.entity) &&
    (!q || `${a.entity} ${a.target} ${a.detail || ''} ${a.actor}`.toLowerCase().includes(q)));
}

RENDER.activity = () => {
  const f = F.activity;
  const all = S.data.activity;
  const list = filtered();
  const entities = [...new Set(all.map(a => a.entity))].sort();
  const admins = new Set(all.map(a => a.actor)).size;
  const week = all.filter(a => Date.now() - new Date(a.at) < 7 * 864e5).length;
  $('#pgSub').textContent = `${list.length} aktivitas${all.length !== list.length ? ` dari ${all.length}` : ''}`;

  let lastDay = '';
  const rows = list.map(a => {
    const d = dayLabel(a.at);
    const head = d !== lastDay ? `<tr class="day-row"><td colspan="5">${d}</td></tr>` : '';
    lastDay = d;
    return head + `<tr>
      <td class="num" style="white-space:nowrap">${hm(a.at)}</td>
      <td>${actBadge(a.action)}</td>
      <td><div class="tname">${esc(a.target)}</div><div class="tsub">${esc(a.entity)}</div></td>
      <td style="color:var(--ink-2)">${esc(a.detail || '—')}</td>
      <td>${esc(a.actor)}</td></tr>`;
  }).join('');

  $('#page').innerHTML = `
    <div class="grid g3" style="margin-bottom:14px">
      <div class="card kpi accent"><div class="lbl">Aktivitas 7 hari</div><div class="val">${week}</div><div class="cap">perubahan oleh admin</div></div>
      <div class="card kpi"><div class="lbl">Total tercatat</div><div class="val">${all.length}</div><div class="cap">${S.mode === 'live' ? '500 catatan terakhir' : 'sesi demo'}</div></div>
      <div class="card kpi"><div class="lbl">Admin aktif</div><div class="val">${admins}</div><div class="cap">orang</div></div>
    </div>
    <div class="card" style="margin-bottom:14px">
      <div class="act-filters">
        <div class="fld"><input type="search" id="actQ" placeholder="Cari booking, paket, detail…" value="${esc(f.q)}" aria-label="Cari log"></div>
        <div class="fld"><select id="actAction" aria-label="Filter aksi"><option value="">Semua aksi</option>
          ${Object.entries(ACT).map(([k, [t]]) => `<option value="${k}" ${f.action === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="fld"><select id="actEntity" aria-label="Filter objek"><option value="">Semua objek</option>
          ${entities.map(e => `<option ${f.entity === e ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select></div>
        <button class="btn soft sm" id="actCsv">Ekspor CSV</button>
      </div>
    </div>
    ${list.length ? `<div class="card"><div class="tablewrap"><table>
      <thead><tr><th>Waktu</th><th>Aksi</th><th>Objek</th><th>Detail</th><th>Admin</th></tr></thead>
      <tbody>${rows}</tbody></table></div></div>`
      : empty(all.length ? 'Tidak ada yang cocok' : 'Belum ada aktivitas', all.length ? 'Coba ubah filter atau kata kunci.' : 'Setiap perubahan admin akan tercatat di sini.')}`;

  const q = $('#actQ');
  q.oninput = () => {
    f.q = q.value;
    const pos = q.selectionStart;
    RENDER.activity();
    const n = $('#actQ'); n.focus(); n.setSelectionRange(pos, pos);
  };
  $('#actAction').onchange = e => { f.action = e.target.value; RENDER.activity(); };
  $('#actEntity').onchange = e => { f.entity = e.target.value; RENDER.activity(); };
  $('#actCsv').onclick = exportCsv;
};

function exportCsv(){
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Waktu','Admin','Aksi','Objek','Target','Detail'].join(',')]
    .concat(filtered().map(a => [new Date(a.at).toLocaleString('id-ID'), a.actor, (ACT[a.action]||[a.action])[0], a.entity, a.target, a.detail].map(cell).join(',')));
  const blob = new Blob(['﻿' + lines.join('\n')], {type:'text/csv'});
  const a = Object.assign(document.createElement('a'), {href:URL.createObjectURL(blob), download:`kalaatma-aktivitas-${new Date().toISOString().slice(0, 10)}.csv`});
  a.click(); URL.revokeObjectURL(a.href);
}
