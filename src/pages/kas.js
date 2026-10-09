/* KEUANGAN / KAS (brief #1C, #9)
   Pembayaran yang dicatat di detail booking otomatis masuk ke kas. */
import { $, $$, S, F, RENDER, rp, esc, today, inRange, fmtDate, toast, money, moneyVal,
         openModal, closeModal, saveRow, insertRow, deleteRow, empty, searchBox, bindSearch, matchQuery } from '../core.js';
import { catGroups, catGroup, stageOf } from '../stages.js';
import { calLabel, dateButton, bindDateButton, MON_FULL, dISO } from '../datepicker.js';
import { renderDebts } from './debts.js';
import { renderSheet } from './kas-sheet.js';

const VIEW_KEY = 'kalaatma-kas-view';
const getView = () => { try{ return localStorage.getItem(VIEW_KEY) === 'sheet' ? 'sheet' : 'list'; }catch(_){ return 'list'; } };

RENDER.kas = () => {
  const f = F.kas;
  const open = (S.data.debts || []).filter(d => d.amount > (S.data.debtPayments || []).filter(p => p.debt_id === d.id).reduce((n, p) => n + p.amount, 0)).length;
  const tabs = `<div class="fl-tabs">
      <button class="${f.tab === 'kas' ? 'on' : ''}" data-kastab="kas">Kas</button>
      <button class="${f.tab === 'debt' ? 'on' : ''}" data-kastab="debt">Hutang Piutang${open ? ` <span class="fl-n2">${open}</span>` : ''}</button>
    </div>`;
  const bindTabs = () => $$('[data-kastab]').forEach(b => b.onclick = () => { f.tab = b.dataset.kastab; RENDER.kas(); });
  if(f.tab === 'debt'){ renderDebts(tabs); bindTabs(); return; }
  if(!f.init){
    f.init = true;
    const d = new Date();
    f.from = dISO(new Date(d.getFullYear(), d.getMonth(), 1));
    f.to   = dISO(new Date(d.getFullYear(), d.getMonth()+1, 0));
    f.monthLabel = MON_FULL[d.getMonth()] + ' ' + d.getFullYear();
  }

  /* Kategori transaksi diambil dari booking yang ditautkan.
     Transaksi tanpa tautan booking (operasional, peralatan) tidak punya
     kategori, jadi ikut tersaring keluar saat filter kategori aktif. */
  const bookingOf = t => t.booking_id ? S.data.bookings.find(b => b.id === t.booking_id) : null;
  const cat = catGroup(f.cat); f.cat = cat.id;

  const byDate = S.data.transactions.filter(t => inRange(t.occurred_on, {from: f.from, to: f.to}));
  const tanpaProject = byDate.filter(t => !bookingOf(t)).length;
  let rows = cat.services
    ? byDate.filter(t => { const b = bookingOf(t); return b && cat.services.includes(b.service); })
    : byDate;
  if(f.q) rows = rows.filter(t => { const b = bookingOf(t);
    return matchQuery(f.q, [t.description, t.category, t.kind === 'IN' ? 'pemasukan' : 'pengeluaran', String(t.amount),
      b?.client_display, b?.service, b?.booking_id, b?.invoice_number]); });
  rows = [...rows].sort((a,b) => b.occurred_on.localeCompare(a.occurred_on));

  const masuk  = rows.filter(t=>t.kind==='IN').reduce((n,t)=>n+t.amount,0);
  const keluar = rows.filter(t=>t.kind==='OUT').reduce((n,t)=>n+t.amount,0);

  const periode = calLabel(f.from, f.to, f.monthLabel);
  const view = f.view || (f.view = getView());
  const bits = [`${rows.length} transaksi`, periode];
  if(f.cat !== 'ALL') bits.push(cat.label);
  $('#pgSub').textContent = bits.join(' · ');

  $('#page').innerHTML = `${tabs}
    <div class="grid g4" style="margin-bottom:14px">
      <div class="card kpi accent"><div class="lbl">Saldo periode</div><div class="val">${rp(masuk-keluar)}</div><div class="cap">pemasukan − pengeluaran</div></div>
      <div class="card kpi"><div class="lbl">Pemasukan</div><div class="val" style="color:var(--ok)">${rp(masuk)}</div><div class="cap">${rows.filter(t=>t.kind==='IN').length} transaksi</div></div>
      <div class="card kpi"><div class="lbl">Pengeluaran</div><div class="val" style="color:var(--err)">${rp(keluar)}</div><div class="cap">${rows.filter(t=>t.kind==='OUT').length} transaksi</div></div>
      <div class="card kpi"><div class="lbl">Total Transaksi</div><div class="val">${rows.length}</div><div class="cap">mengikuti filter</div></div>
    </div>

    <div class="jb-bar">
      ${searchBox('kasQ', f, 'Cari deskripsi, client, kategori, nominal…')}
      <div class="kas-view" role="group" aria-label="Tampilan">
        <button class="${view === 'list' ? 'on' : ''}" data-kview="list" title="Tampilan daftar">☰ Daftar</button>
        <button class="${view === 'sheet' ? 'on' : ''}" data-kview="sheet" title="Tampilan tabel seperti Excel">▦ Tabel</button>
      </div>
      <label class="selchip"><span>Kategori</span><select id="kasCat" aria-label="Kategori">
          ${catGroups().map(c => `<option value="${esc(c.id)}" ${f.cat===c.id?'selected':''}>${esc(c.label)}</option>`).join('')}
        </select></label>
      <div class="chips" style="margin-left:auto">
        ${dateButton('kasDate', f)}
        <button class="btn sm" id="addTx">+ Catat transaksi</button>
      </div>
    </div>

    ${f.cat !== 'ALL' && tanpaProject
      ? `<div class="banner" style="margin-bottom:14px">${tanpaProject} transaksi tanpa tautan booking tidak ikut ditampilkan, karena kategorinya tidak diketahui.</div>`
      : ''}

    ${view === 'sheet' ? '<div id="kasSheet"></div>' : rows.length ? `<div class="card"><div class="tablewrap"><table class="kas-t">
      <thead><tr>
        <th>Tanggal</th><th>Deskripsi</th><th>Kategori</th><th>Project</th>
        <th class="r">Pemasukan</th><th class="r">Pengeluaran</th><th class="r"></th>
      </tr></thead>
      <tbody>${rows.map(t => {
        const b = bookingOf(t);
        return `<tr>
        <td style="white-space:nowrap">${fmtDate(t.occurred_on)}</td>
        <td><div class="tname">${esc(t.description||'—')}</div>${t.payment_id ? '<div class="tsub">otomatis dari pembayaran</div>' : ''}</td>
        <td><span class="badge b-grey">${esc(t.category||'—')}</span></td>
        <td>${b ? `<div class="tsub">${esc(b.client_display)}</div><div class="tsub" style="color:var(--primary)">${esc(b.service)}</div>` : '<span class="tsub">—</span>'}</td>
        <td class="r num kas-in">${t.kind==='IN'  ? rp(t.amount) : '<span class="kas-0">—</span>'}</td>
        <td class="r num kas-out">${t.kind==='OUT' ? rp(t.amount) : '<span class="kas-0">—</span>'}</td>
        <td class="r"><div class="rowacts">
          <button class="ibtn" data-txedit="${t.id}" title="Ubah transaksi" aria-label="Ubah transaksi">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
          </button>
          <button class="ibtn del" data-txdel="${t.id}" title="Hapus transaksi" aria-label="Hapus transaksi">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>
        </div></td>
      </tr>`;}).join('')}</tbody>
      <tfoot><tr>
        <td colspan="4" class="kas-tot-l">Total ${periode}</td>
        <td class="r num kas-in">${rp(masuk)}</td>
        <td class="r num kas-out">${rp(keluar)}</td>
        <td></td>
      </tr></tfoot>
    </table></div></div>` : empty('Belum ada transaksi','Tidak ada transaksi yang cocok dengan filter ini.')}`;

  bindTabs();
  if(view === 'sheet') renderSheet($('#kasSheet'), rows, bookingOf, RENDER.kas, periode);
  $$('[data-kview]').forEach(b => b.onclick = () => { f.view = b.dataset.kview; try{ localStorage.setItem(VIEW_KEY, f.view); }catch(_){} RENDER.kas(); });
  bindSearch('kasQ', f, RENDER.kas);
  $('#kasCat').onchange = e => { f.cat = e.target.value; RENDER.kas(); };
  bindDateButton('kasDate', f, RENDER.kas);
  $('#addTx').onclick = () => txForm(null);
  $$('[data-txedit]').forEach(b => b.onclick = () => txForm(S.data.transactions.find(t => t.id === b.dataset.txedit)));
  $$('[data-txdel]').forEach(b => b.onclick = () => txDelete(S.data.transactions.find(t => t.id === b.dataset.txdel)));
};

/* ---------- form transaksi: dipakai untuk tambah maupun ubah ---------- */
function txForm(existing){
  const ed = !!existing;
  const linkable = S.data.bookings.filter(b => stageOf(b))
    .sort((a,b) => (b.session_date||'').localeCompare(a.session_date||''));
  openModal(`<h3>${ed ? 'Ubah transaksi' : 'Catat transaksi'}</h3>
    <p>${ed ? 'Perubahan langsung memengaruhi saldo dan laporan periode ini.' : 'Ketik angka saja — kolom Jumlah otomatis diformat Rupiah.'}</p>
    <div class="fgrid two" style="margin-top:16px">
      <div class="fld"><label>Jenis</label>
        <select id="txKind">
          <option value="IN">Pemasukan</option>
          <option value="OUT">Pengeluaran</option>
        </select></div>
      <div class="fld money"><label>Jumlah</label><input id="txAmt" inputmode="numeric" placeholder="Rp0"></div>
    </div>
    <div class="fld" style="margin-top:11px"><label>Kategori</label>
      <input id="txCat" placeholder="DP Booking / Fee Crew / Operasional" value="${esc(existing?.category||'')}"></div>
    <div class="fld" style="margin-top:11px"><label>Deskripsi</label>
      <input id="txDesc" placeholder="Keterangan singkat" value="${esc(existing?.description||'')}"></div>
    <div class="fgrid two" style="margin-top:11px">
      <div class="fld"><label>Tanggal</label><input id="txDate" type="date" value="${existing?.occurred_on || today()}"></div>
      <div class="fld"><label>Tautkan ke project</label>
        <select id="txBooking"><option value="">— Tanpa project —</option>
        ${linkable.map(b=>`<option value="${b.id}">${esc(b.client_display)} · ${esc(b.service)}</option>`).join('')}</select></div>
    </div>
    <div class="tsub" style="margin-top:8px">Transaksi yang ditautkan ke project ikut terbaca saat memfilter kategori.</div>
    <div class="acts">
      <button class="btn soft" data-mclose>Batal</button>
      <button class="btn" id="txSave">${ed ? 'Simpan perubahan' : 'Simpan'}</button>
    </div>`);

  const amt = money($('#txAmt'), existing?.amount || 0);
  $('#txKind').value = existing?.kind || 'IN';
  if(existing?.booking_id) $('#txBooking').value = existing.booking_id;

  $('#txSave').onclick = async () => {
    if(moneyVal(amt) <= 0) return toast('Jumlah belum diisi');
    const data = {
      kind: $('#txKind').value, amount: moneyVal(amt),
      category: $('#txCat').value.trim() || null,
      description: $('#txDesc').value.trim() || null,
      occurred_on: $('#txDate').value,
      booking_id: $('#txBooking').value || null
    };
    try{
      if(ed) await saveRow('transactions', existing.id, data, 'transactions');
      else   await insertRow('transactions', data, 'transactions');
      closeModal(); RENDER.kas(); toast(ed ? 'Transaksi diperbarui' : 'Transaksi tercatat');
    }catch(e){ toast('Gagal menyimpan: ' + e.message); }
  };
}

/* ---------- hapus transaksi, selalu lewat konfirmasi ---------- */
function txDelete(t){
  if(!t) return;
  openModal(`<div class="warnicon" style="background:var(--err-bg);color:var(--err)">🗑</div>
    <h3>Hapus transaksi?</h3>
    <p>Baris ini akan hilang dari kas dan saldo periode ikut berubah. Tindakan ini tidak bisa dibatalkan.</p>
    <div style="margin-top:15px">
      <div class="rowline"><span class="k">Tanggal</span><span class="v">${fmtDate(t.occurred_on)}</span></div>
      <div class="rowline"><span class="k">Deskripsi</span><span class="v">${esc(t.description||'—')}</span></div>
      <div class="rowline"><span class="k">Jenis</span><span class="v">${t.kind==='IN'?'Pemasukan':'Pengeluaran'}</span></div>
      <div class="rowline"><span class="k">Jumlah</span><span class="v" style="color:${t.kind==='IN'?'var(--ok)':'var(--err)'}">${rp(t.amount)}</span></div>
    </div>
    <div class="acts">
      <button class="btn soft" data-mclose>Batal</button>
      <button class="btn danger" id="txDelYes">Ya, hapus</button>
    </div>`);
  $('#txDelYes').onclick = async () => {
    try{
      await deleteRow('transactions', t.id, 'transactions');
      closeModal(); RENDER.kas(); toast('Transaksi dihapus');
    }catch(e){ toast('Gagal menghapus: ' + e.message); }
  };
}
