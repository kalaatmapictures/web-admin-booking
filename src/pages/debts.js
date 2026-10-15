/* =====================================================================
   HUTANG PIUTANG — tab di halaman Keuangan.
   Hutang  = uang yang harus dibayar perusahaan (vendor, alat, pinjaman).
   Piutang = uang yang harus diterima perusahaan (di luar booking).
   Bisa dicicil; setiap pembayaran bisa langsung tercatat di Kas.
   Sisa pembayaran client dari booking ikut ditampilkan sebagai piutang.
   ===================================================================== */
import { $, $$, S, RENDER, rp, esc, today, fmtDate, toast, money, moneyVal, empty,
         openModal, closeModal, confirmBox, api, logAct, describe, searchBox, bindSearch, matchQuery } from '../core.js';
import { bookingDrawer } from './detail.js';

const KIND = {
  PAYABLE:    {label:'Hutang',  cls:'b-err', act:'Bayar',  txKind:'OUT', txCat:'Bayar Hutang',   verb:'dibayar'},
  RECEIVABLE: {label:'Piutang', cls:'b-ok',  act:'Terima', txKind:'IN',  txCat:'Terima Piutang', verb:'diterima'}
};
const ICON = {
  edit:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  del:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>'
};
const D = { kind:'ALL', status:'OPEN', q:'' };

const debts = () => S.data.debts || [];
const paymentsOf = id => (S.data.debtPayments || []).filter(p => p.debt_id === id).sort((a, b) => b.paid_on.localeCompare(a.paid_on));
const daysTo = d => Math.round((new Date(d + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 864e5);

/* angka turunan: terbayar, sisa, status */
function calc(d){
  const paid = paymentsOf(d.id).reduce((n, p) => n + p.amount, 0);
  const left = Math.max(0, d.amount - paid);
  const state = left <= 0 ? 'PAID' : !d.due_date ? 'OPEN' : daysTo(d.due_date) < 0 ? 'LATE' : daysTo(d.due_date) <= 7 ? 'SOON' : 'OPEN';
  return {...d, paid, left, state};
}
const stateBadge = r => ({
  PAID:'<span class="badge b-ok"><span class="d"></span>Lunas</span>',
  LATE:`<span class="badge b-err"><span class="d"></span>Terlambat ${-daysTo(r.due_date)} hari</span>`,
  SOON:`<span class="badge b-warn"><span class="d"></span>${daysTo(r.due_date) === 0 ? 'Jatuh tempo hari ini' : daysTo(r.due_date) + ' hari lagi'}</span>`,
  OPEN:'<span class="badge b-grey">Berjalan</span>'
}[r.state]);
const bar = r => `<div class="db-bar"><i style="width:${r.amount ? Math.min(100, r.paid / r.amount * 100).toFixed(1) : 0}%"></i></div>`;

/* sisa pembayaran client dari booking = piutang otomatis */
const bookingReceivables = () => S.data.bookings
  .filter(b => b.status !== 'CANCELLED' && b.remaining_payment > 0 && !['NEW','CONTACTED'].includes(b.status))
  .sort((a, b) => (a.payment_due_date || a.session_date || '9999').localeCompare(b.payment_due_date || b.session_date || '9999'));

export function renderDebts(tabs){
  const all = debts().map(calc);
  const open = all.filter(r => r.left > 0);
  const hutang = open.filter(r => r.kind === 'PAYABLE').reduce((n, r) => n + r.left, 0);
  const piutangManual = open.filter(r => r.kind === 'RECEIVABLE').reduce((n, r) => n + r.left, 0);
  const fromBookings = bookingReceivables();
  const piutangBooking = fromBookings.reduce((n, b) => n + b.remaining_payment, 0);
  const urgent = open.filter(r => ['LATE','SOON'].includes(r.state));

  let rows = all;
  if(D.kind !== 'ALL') rows = rows.filter(r => r.kind === D.kind);
  if(D.status === 'OPEN') rows = rows.filter(r => r.left > 0);
  else if(D.status === 'PAID') rows = rows.filter(r => r.left <= 0);
  if(D.q) rows = rows.filter(r => matchQuery(D.q, [r.party, r.description, r.notes, KIND[r.kind].label, String(r.amount)]));
  const rank = {LATE:0, SOON:1, OPEN:2, PAID:3};
  rows = [...rows].sort((a, b) => rank[a.state] - rank[b.state] || (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  $('#pgSub').textContent = `${open.length} belum lunas · ${urgent.length} jatuh tempo ≤7 hari / terlambat`;

  $('#page').innerHTML = `${tabs}
    ${S.data.debtsSchemaMissing ? `<div class="banner"><b>Database belum diperbarui.</b> Jalankan ulang <code>supabase/schema.sql</code> di Supabase supaya hutang piutang bisa disimpan.</div>` : ''}
    <div class="grid g4" style="margin-bottom:14px">
      <div class="card kpi accent"><div class="lbl">Posisi bersih</div><div class="val">${rp(piutangManual + piutangBooking - hutang)}</div><div class="cap">piutang − hutang</div></div>
      <div class="card kpi"><div class="lbl">Sisa hutang</div><div class="val" style="color:var(--err)">${rp(hutang)}</div><div class="cap">${open.filter(r => r.kind === 'PAYABLE').length} belum lunas</div></div>
      <div class="card kpi"><div class="lbl">Sisa piutang</div><div class="val" style="color:var(--ok)">${rp(piutangManual + piutangBooking)}</div><div class="cap">${rp(piutangBooking)} dari booking</div></div>
      <div class="card kpi"><div class="lbl">Perlu perhatian</div><div class="val" style="${urgent.length ? 'color:var(--err)' : ''}">${urgent.length}</div><div class="cap">jatuh tempo ≤7 hari / terlambat</div></div>
    </div>

    <div class="bk-bar">
      ${searchBox('dbQ', D, 'Cari nama pihak, keterangan, nominal…')}
      <div class="fl-tabs db-kind">
        ${[['ALL','Semua'],['PAYABLE','Hutang'],['RECEIVABLE','Piutang']].map(([k, l]) => `<button class="${D.kind === k ? 'on' : ''}" data-dbkind="${k}">${l}</button>`).join('')}
      </div>
      <label class="selchip"><span>Status</span><select id="dbStatus" aria-label="Status">
        <option value="OPEN" ${D.status === 'OPEN' ? 'selected' : ''}>Belum lunas</option>
        <option value="PAID" ${D.status === 'PAID' ? 'selected' : ''}>Lunas</option>
        <option value="ALL" ${D.status === 'ALL' ? 'selected' : ''}>Semua</option>
      </select></label>
      <button class="btn sm" id="dbAdd" style="margin-left:auto">+ Catat hutang / piutang</button>
    </div>

    ${rows.length ? `<div class="card"><div class="tablewrap"><table>
      <thead><tr><th>Pihak</th><th>Jenis</th><th>Jatuh tempo</th><th class="r">Total</th><th>Terbayar</th><th class="r">Sisa</th><th class="r"></th></tr></thead>
      <tbody>${rows.map(r => `<tr class="click" data-db="${r.id}">
        <td><div class="tname">${esc(r.party)}</div><div class="tsub">${esc(r.description || '—')}</div></td>
        <td><span class="badge ${KIND[r.kind].cls}">${KIND[r.kind].label}</span></td>
        <td>${stateBadge(r)}<div class="tsub">${r.due_date ? fmtDate(r.due_date) : 'tanpa jatuh tempo'}</div></td>
        <td class="r num">${rp(r.amount)}</td>
        <td><div class="tsub">${rp(r.paid)} ${KIND[r.kind].verb}</div>${bar(r)}</td>
        <td class="r num" style="font-weight:700;color:${r.left ? (r.kind === 'PAYABLE' ? 'var(--err)' : 'var(--ok)') : 'var(--muted)'}">${rp(r.left)}</td>
        <td class="r"><div class="rowacts">
          ${r.left ? `<button class="btn sm ${r.kind === 'PAYABLE' ? '' : 'wa'}" data-dbpay="${r.id}">${KIND[r.kind].act}</button>` : ''}
          <button class="ibtn" data-dbedit="${r.id}" title="Ubah" aria-label="Ubah">${ICON.edit}</button>
          <button class="ibtn del" data-dbdel="${r.id}" title="Hapus" aria-label="Hapus">${ICON.del}</button>
        </div></td>
      </tr>`).join('')}</tbody></table></div></div>`
    : empty(all.length ? 'Tidak ada yang cocok' : 'Belum ada hutang / piutang',
        all.length ? 'Coba ubah filter jenis, status, atau kata kunci.' : 'Catat hutang ke vendor, cicilan alat, pinjaman, atau piutang di luar booking lewat tombol di atas.')}

    ${D.kind !== 'PAYABLE' && fromBookings.length ? `<div class="sec-h"><h3>Piutang dari booking</h3>
      <span class="tsub">otomatis dari sisa pembayaran client · total ${rp(piutangBooking)}</span></div>
    <div class="card"><div class="tablewrap"><table>
      <thead><tr><th>Client</th><th>Status bayar</th><th>Jatuh tempo</th><th class="r">Total invoice</th><th class="r">Sudah dibayar</th><th class="r">Sisa</th></tr></thead>
      <tbody>${fromBookings.map(b => `<tr class="click" data-dbbook="${b.id}">
        <td><div class="tname">${esc(b.client_display)}</div><div class="tsub">${esc(b.service)} · event ${fmtDate(b.session_date)}</div></td>
        <td>${b.payment_overdue ? '<span class="badge b-err"><span class="d"></span>Terlambat</span>' : `<span class="badge b-grey">${b.payment_status === 'UNPAID' ? 'Belum bayar' : 'Sebagian'}</span>`}</td>
        <td>${b.payment_due_date ? fmtDate(b.payment_due_date) : '<span class="tsub">—</span>'}</td>
        <td class="r num">${rp(b.total_invoice)}</td>
        <td class="r num">${rp(b.paid_amount)}</td>
        <td class="r num" style="font-weight:700;color:var(--ok)">${rp(b.remaining_payment)}</td>
      </tr>`).join('')}</tbody></table></div></div>` : ''}`;

  bindSearch('dbQ', D, RENDER.kas);
  $$('[data-dbkind]').forEach(b => b.onclick = () => { D.kind = b.dataset.dbkind; RENDER.kas(); });
  $('#dbStatus').onchange = e => { D.status = e.target.value; RENDER.kas(); };
  $('#dbAdd').onclick = () => debtForm(null);
  $$('[data-db]').forEach(tr => tr.onclick = () => debtDetail(tr.dataset.db));
  $$('[data-dbpay]').forEach(b => b.onclick = e => { e.stopPropagation(); payForm(b.dataset.dbpay); });
  $$('[data-dbedit]').forEach(b => b.onclick = e => { e.stopPropagation(); debtForm(debts().find(d => d.id === b.dataset.dbedit)); });
  $$('[data-dbdel]').forEach(b => b.onclick = e => { e.stopPropagation(); removeDebt(b.dataset.dbdel); });
  $$('[data-dbbook]').forEach(tr => tr.onclick = () => bookingDrawer(tr.dataset.dbbook));
}

/* ---------- data ---------- */
async function reload(){
  const [d, p] = await Promise.all([api('debts?select=*&order=created_at.desc'), api('debt_payments?select=*&order=paid_on.desc')]);
  Object.assign(S.data, {debts: d, debtPayments: p});
}
const errBox = id => m => { const e = $('#' + id); e.textContent = m; e.style.display = m ? 'block' : 'none'; };
const needSchema = show => { if(!S.data.debtsSchemaMissing) return false; show('Jalankan schema.sql terbaru di Supabase dulu.'); return true; };

/* ---------- tambah / ubah ---------- */
function debtForm(cur, presetKind){
  let kind = cur?.kind || presetKind || 'PAYABLE';
  openModal(`<h3>${cur ? 'Ubah' : 'Catat'} hutang / piutang</h3>
    <p>${cur ? 'Perubahan tercatat di Log Aktivitas.' : 'Pembayaran / cicilan dicatat setelahnya lewat tombol Bayar / Terima.'}</p>
    <div style="text-align:left;margin-top:16px">
      <div class="db-kindpick">
        <button type="button" data-fk="PAYABLE" class="${kind === 'PAYABLE' ? 'on' : ''}"><b>Hutang</b><small>perusahaan harus membayar</small></button>
        <button type="button" data-fk="RECEIVABLE" class="${kind === 'RECEIVABLE' ? 'on' : ''}"><b>Piutang</b><small>perusahaan akan menerima</small></button>
      </div>
      <div class="fld" style="margin-top:12px"><label id="dfPartyL">${kind === 'PAYABLE' ? 'Kepada' : 'Dari'} (nama pihak) <span style="color:var(--primary)">*</span></label>
        <input id="dfParty" value="${esc(cur?.party || '')}" placeholder="mis. Toko Kamera Jaya, Bank, Pak Budi"></div>
      <div class="fld" style="margin-top:11px"><label>Keterangan</label>
        <input id="dfDesc" value="${esc(cur?.description || '')}" placeholder="mis. Cicilan lensa 70-200mm"></div>
      <div class="fgrid two" style="margin-top:11px">
        <div class="fld money"><label>Jumlah <span style="color:var(--primary)">*</span></label><input id="dfAmt" inputmode="numeric" placeholder="Rp0"></div>
        <div class="fld"><label>Tanggal</label><input type="date" id="dfDate" value="${cur?.issued_on || today()}"></div>
      </div>
      <div class="fld" style="margin-top:11px"><label>Jatuh tempo</label><input type="date" id="dfDue" value="${cur?.due_date || ''}"></div>
      <div class="fld" style="margin-top:11px"><label>Catatan</label><textarea id="dfNotes" rows="2" placeholder="opsional">${esc(cur?.notes || '')}</textarea></div>
      <div id="dfErr" class="fl-err"></div>
    </div>
    <div class="acts"><button class="btn soft" data-mclose>Batal</button><button class="btn" id="dfSave">${cur ? 'Simpan' : 'Catat'}</button></div>`);
  const amt = money($('#dfAmt'), cur?.amount || 0);
  const err = errBox('dfErr');
  $$('[data-fk]').forEach(b => b.onclick = () => {
    kind = b.dataset.fk;
    $$('[data-fk]').forEach(x => x.classList.toggle('on', x === b));
    $('#dfPartyL').firstChild.textContent = (kind === 'PAYABLE' ? 'Kepada' : 'Dari') + ' (nama pihak) ';
  });
  $('#dfSave').onclick = async () => {
    if(needSchema(err)) return;
    const row = {kind, party: $('#dfParty').value.trim(), description: $('#dfDesc').value.trim() || null, amount: moneyVal(amt),
                 issued_on: $('#dfDate').value || today(), due_date: $('#dfDue').value || null, notes: $('#dfNotes').value.trim() || null};
    if(!row.party) return err('Nama pihak wajib diisi.');
    if(row.amount <= 0) return err('Jumlah belum diisi.');
    if(cur && row.amount < calc(cur).paid) return err(`Jumlah tidak boleh lebih kecil dari yang sudah ${KIND[kind].verb} (${rp(calc(cur).paid)}).`);
    const btn = $('#dfSave'); btn.disabled = true;
    try{
      if(cur){
        await api('debts?id=eq.' + cur.id, {method:'PATCH', body:row, prefer:'return=minimal'});
        const detail = describe(cur, row);
        await reload();
        if(detail) await logAct('update', KIND[kind].label, row.party, detail);
        toast('Diperbarui');
      } else {
        await api('debts', {method:'POST', body:row, prefer:'return=minimal'});
        await reload();
        await logAct('create', KIND[kind].label, row.party, [rp(row.amount), row.description, row.due_date && 'jatuh tempo ' + fmtDate(row.due_date)].filter(Boolean).join(' · '));
        toast(`${KIND[kind].label} ${row.party} tercatat`);
      }
    }catch(e){ btn.disabled = false; return err('Gagal menyimpan: ' + e.message); }
    closeModal(); RENDER.kas();
  };
}

/* ---------- pembayaran / cicilan ---------- */
function payForm(id){
  const d = calc(debts().find(x => x.id === id)), k = KIND[d.kind];
  openModal(`<h3>${k.act} ${k.label.toLowerCase()} — ${esc(d.party)}</h3>
    <p>${esc(d.description || '')}${d.description ? ' · ' : ''}sisa <b>${rp(d.left)}</b> dari ${rp(d.amount)}</p>
    <div style="text-align:left;margin-top:16px">
      <div class="fgrid two">
        <div class="fld money"><label>Jumlah ${d.kind === 'PAYABLE' ? 'dibayar' : 'diterima'}</label><input id="pfAmt" inputmode="numeric"></div>
        <div class="fld"><label>Tanggal</label><input type="date" id="pfDate" value="${today()}"></div>
      </div>
      <div class="chips" style="margin-top:8px"><button type="button" class="chip alt" id="pfFull">Lunasi ${rp(d.left)}</button></div>
      <div class="fld" style="margin-top:11px"><label>Metode</label><input id="pfMethod" placeholder="Transfer BCA / Cash / QRIS"></div>
      <label class="mn-check" style="margin-top:12px"><input type="checkbox" id="pfKas" checked>
        <span><b>Catat juga di Kas</b><small>sebagai ${k.txKind === 'OUT' ? 'pengeluaran' : 'pemasukan'} "${k.txCat}" supaya saldo kas ikut berubah</small></span></label>
      <div id="pfErr" class="fl-err"></div>
    </div>
    <div class="acts"><button class="btn soft" data-mclose>Batal</button><button class="btn ${d.kind === 'RECEIVABLE' ? 'wa' : ''}" id="pfSave">Simpan</button></div>`);
  const amt = money($('#pfAmt'), d.left);
  const err = errBox('pfErr');
  $('#pfFull').onclick = () => { amt.dataset.num = d.left; amt.value = rp(d.left); };
  $('#pfSave').onclick = async () => {
    const amount = moneyVal(amt), paid_on = $('#pfDate').value || today(), method = $('#pfMethod').value.trim() || null;
    if(amount <= 0) return err('Jumlah belum diisi.');
    if(amount > d.left) return err(`Melebihi sisa ${rp(d.left)}.`);
    const btn = $('#pfSave'); btn.disabled = true;
    try{
      let transaction_id = null;
      if($('#pfKas').checked){
        const [tx] = await api('transactions', {method:'POST', prefer:'return=representation', body:{
          kind:k.txKind, amount, category:k.txCat, occurred_on:paid_on,
          description:`${k.txCat} — ${d.party}${d.description ? ' (' + d.description + ')' : ''}${method ? ' · ' + method : ''}`}});
        S.data.transactions.unshift(tx); transaction_id = tx.id;
      }
      await api('debt_payments', {method:'POST', prefer:'return=minimal', body:{debt_id:d.id, amount, paid_on, method, transaction_id}});
      await reload();
      const left = d.left - amount;
      await logAct('create', `Pembayaran ${k.label}`, d.party, `${rp(amount)}${method ? ' · ' + method : ''}${left ? ' · sisa ' + rp(left) : ' · LUNAS'}${transaction_id ? ' · masuk kas' : ''}`);
      toast(left ? `${rp(amount)} tercatat · sisa ${rp(left)}` : `${d.party} lunas`);
    }catch(e){ btn.disabled = false; return err('Gagal menyimpan: ' + e.message); }
    closeModal(); RENDER.kas();
  };
}

/* ---------- detail + riwayat pembayaran ---------- */
function debtDetail(id){
  const d = calc(debts().find(x => x.id === id)), k = KIND[d.kind], pays = paymentsOf(id);
  openModal(`<div style="display:flex;align-items:center;gap:8px"><span class="badge ${k.cls}">${k.label}</span>${stateBadge(d)}</div>
    <h3 style="margin-top:10px">${esc(d.party)}</h3>
    <p>${esc(d.description || '—')}</p>
    <div style="text-align:left;margin-top:14px">
      <div class="rowline"><span class="k">Total</span><span class="v">${rp(d.amount)}</span></div>
      <div class="rowline"><span class="k">Sudah ${k.verb}</span><span class="v">${rp(d.paid)}</span></div>
      <div class="rowline"><span class="k">Sisa</span><span class="v" style="color:${d.left ? (d.kind === 'PAYABLE' ? 'var(--err)' : 'var(--ok)') : 'var(--muted)'}">${rp(d.left)}</span></div>
      <div class="rowline"><span class="k">Tanggal</span><span class="v">${fmtDate(d.issued_on)}</span></div>
      <div class="rowline"><span class="k">Jatuh tempo</span><span class="v">${d.due_date ? fmtDate(d.due_date) : '—'}</span></div>
      ${d.notes ? `<div class="rowline"><span class="k">Catatan</span><span class="v" style="font-weight:400">${esc(d.notes)}</span></div>` : ''}
      ${bar(d)}
      <div class="mlabel" style="margin-top:18px">Riwayat pembayaran (${pays.length})</div>
      <div style="margin-top:8px">${pays.length ? pays.map(p => `<div class="deleg">
          <div style="min-width:0"><div class="dn">${rp(p.amount)}</div>
            <div class="tsub">${fmtDate(p.paid_on)}${p.method ? ' · ' + esc(p.method) : ''}${p.transaction_id ? ' · tercatat di kas' : ''}</div></div>
          <button class="ibtn del" data-pdel="${p.id}" title="Hapus pembayaran" aria-label="Hapus pembayaran">${ICON.del}</button>
        </div>`).join('') : '<div class="tsub">Belum ada pembayaran.</div>'}</div>
    </div>
    <div class="acts">
      <button class="btn soft" id="ddEdit">Ubah</button>
      ${d.left ? `<button class="btn ${d.kind === 'RECEIVABLE' ? 'wa' : ''}" id="ddPay">${k.act}</button>` : '<button class="btn soft" data-mclose>Tutup</button>'}
    </div>`);
  $('#ddEdit').onclick = () => debtForm(debts().find(x => x.id === id));
  $('#ddPay') && ($('#ddPay').onclick = () => payForm(id));
  $$('[data-pdel]').forEach(b => b.onclick = async () => {
    const p = pays.find(x => x.id === b.dataset.pdel);
    const ok = await confirmBox('Hapus pembayaran?', `${rp(p.amount)} tanggal ${fmtDate(p.paid_on)} akan dihapus${p.transaction_id ? ', termasuk catatan kas-nya' : ''}. Sisa ${k.label.toLowerCase()} bertambah lagi.`);
    if(!ok) return debtDetail(id);
    try{
      await api('debt_payments?id=eq.' + p.id, {method:'DELETE', prefer:'return=minimal'});
      if(p.transaction_id){
        await api('transactions?id=eq.' + p.transaction_id, {method:'DELETE', prefer:'return=minimal'});
        S.data.transactions = S.data.transactions.filter(t => t.id !== p.transaction_id);
      }
      await reload();
      await logAct('delete', `Pembayaran ${k.label}`, d.party, rp(p.amount));
      toast('Pembayaran dihapus');
    }catch(e){ toast('Gagal menghapus: ' + e.message); }
    debtDetail(id); RENDER.kas();
  });
}

async function removeDebt(id){
  const d = calc(debts().find(x => x.id === id)), pays = paymentsOf(id);
  const ok = await confirmBox(`Hapus ${KIND[d.kind].label.toLowerCase()} ${d.party}?`,
    `${rp(d.amount)}${pays.length ? ` beserta ${pays.length} riwayat pembayaran` : ''} akan dihapus. Catatan di Kas (bila ada) tetap tersimpan.`);
  if(!ok) return;
  try{
    await api('debts?id=eq.' + id, {method:'DELETE', prefer:'return=minimal'});
    await reload();
    await logAct('delete', KIND[d.kind].label, d.party, rp(d.amount));
    toast('Dihapus');
  }catch(e){ toast('Gagal menghapus: ' + e.message); }
  RENDER.kas();
}
