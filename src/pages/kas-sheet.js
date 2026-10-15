/* =====================================================================
   KEUANGAN → TAMPILAN TABEL (seperti Excel)
   • Kisi rapat dengan nomor baris, garis sel, header lengket, saldo berjalan.
   • Klik sel (Tanggal / Deskripsi / Kategori / Pemasukan / Pengeluaran)
     untuk mengedit langsung; Enter = simpan & turun, Tab = simpan & kanan,
     Esc = batal. Baris otomatis dari pembayaran booking: nominal & tanggal
     dikunci (ubah lewat detail booking) supaya tetap sinkron.
   • Baris kosong di bawah untuk mencatat transaksi baru.
   • Unduh .xlsx (SheetJS dari CDN resmi, saat dibutuhkan) atau CSV.
   ===================================================================== */
import { $, $$, S, rp, esc, today, toast, parseNum, saveRow, insertRow, fmtDate } from '../core.js';

const COLS = [
  {k:'occurred_on', l:'Tanggal', w:112, edit:'date'},
  {k:'kind', l:'Jenis', w:84},
  {k:'description', l:'Deskripsi', w:0, edit:'text'},          // lebar fleksibel
  {k:'category', l:'Kategori', w:128, edit:'text'},
  {k:'project', l:'Project', w:170},
  {k:'in', l:'Pemasukan', w:122, edit:'money', num:true},
  {k:'out', l:'Pengeluaran', w:122, edit:'money', num:true},
  {k:'bal', l:'Saldo', w:128, num:true}
];
const LETTER = i => String.fromCharCode(65 + i);

export function renderSheet(host, rows, bookingOf, rerender, periodLabel){
  // urutan buku kas: tanggal lama → baru, agar saldo berjalan terbaca seperti Excel
  const list = [...rows].sort((a, b) => a.occurred_on.localeCompare(b.occurred_on) || (a.created_at || '').localeCompare(b.created_at || ''));
  let bal = 0;
  const data = list.map(t => {
    bal += t.kind === 'IN' ? t.amount : -t.amount;
    const b = bookingOf(t);
    return {t, bal, project: b ? `${b.client_display} · ${b.service}` : ''};
  });
  const masuk = list.filter(t => t.kind === 'IN').reduce((n, t) => n + t.amount, 0);
  const keluar = list.filter(t => t.kind === 'OUT').reduce((n, t) => n + t.amount, 0);
  const cell = (d, c) => {
    const t = d.t, locked = t.payment_id && (c.k === 'occurred_on' || c.k === 'in' || c.k === 'out');
    let v = '';
    if(c.k === 'occurred_on') v = fmtDate(t.occurred_on);
    else if(c.k === 'kind') v = t.kind === 'IN' ? '<span class="xl-in">Masuk</span>' : '<span class="xl-out">Keluar</span>';
    else if(c.k === 'description') v = esc(t.description || '');
    else if(c.k === 'category') v = esc(t.category || '');
    else if(c.k === 'project') v = esc(d.project);
    else if(c.k === 'in') v = t.kind === 'IN' ? rp(t.amount) : '';
    else if(c.k === 'out') v = t.kind === 'OUT' ? rp(t.amount) : '';
    else if(c.k === 'bal') v = `<span class="${d.bal < 0 ? 'xl-out' : ''}">${rp(d.bal)}</span>`;
    const editable = c.edit && !locked;
    return `<td class="${c.num ? 'n' : ''} ${editable ? 'ed' : ''} ${locked ? 'lk' : ''}" ${editable ? `data-ed="${c.k}" data-id="${t.id}"` : ''}
      ${locked ? 'title="Otomatis dari pembayaran booking — ubah lewat detail booking"' : ''}>${v}</td>`;
  };

  host.innerHTML = `
    <div class="xl-tools">
      <span class="tsub">Klik sel untuk mengedit · <b>Enter</b> simpan & turun · <b>Tab</b> ke kanan · <b>Esc</b> batal</span>
      <button class="btn soft sm" id="xlDl">⇩ Unduh Excel</button>
    </div>
    <div class="xl-wrap"><table class="xl">
      <colgroup><col style="width:46px">${COLS.map(c => c.w ? `<col style="width:${c.w}px">` : '<col>').join('')}</colgroup>
      <thead>
        <tr class="xl-letters"><th></th>${COLS.map((c, i) => `<th>${LETTER(i)}</th>`).join('')}</tr>
        <tr><th class="rn">#</th>${COLS.map(c => `<th class="${c.num ? 'n' : ''}">${c.l}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${data.map((d, i) => `<tr><th class="rn">${i + 1}</th>${COLS.map(c => cell(d, c)).join('')}</tr>`).join('')}
        <tr class="xl-new"><th class="rn">+</th>
          <td><input type="date" id="xnDate" value="${today()}"></td>
          <td><select id="xnKind"><option value="OUT">Keluar</option><option value="IN">Masuk</option></select></td>
          <td><input id="xnDesc" placeholder="Ketik transaksi baru…"></td>
          <td><input id="xnCat" placeholder="Kategori"></td>
          <td class="tsub" style="padding-left:10px">—</td>
          <td colspan="2"><input id="xnAmt" inputmode="numeric" placeholder="Nominal, lalu Enter" class="n"></td>
          <td><button class="btn sm" id="xnAdd" style="width:100%">Tambah</button></td>
        </tr>
      </tbody>
      <tfoot><tr><th class="rn"></th><td colspan="5" class="xl-tl">Total ${esc(periodLabel)}</td>
        <td class="n xl-in">${rp(masuk)}</td><td class="n xl-out">${rp(keluar)}</td><td class="n"><b>${rp(masuk - keluar)}</b></td></tr></tfoot>
    </table></div>`;

  /* ---------- edit sel ---------- */
  const startEdit = td => {
    if(td.querySelector('input')) return;
    const id = td.dataset.id, k = td.dataset.ed, t = rows.find(x => x.id === id);
    if(!t) return;
    const val = k === 'occurred_on' ? t.occurred_on : k === 'in' || k === 'out' ? ((k === 'in') === (t.kind === 'IN') ? t.amount : '') : (t[k] || '');
    const prev = td.innerHTML;
    td.classList.add('on');
    td.innerHTML = `<input ${k === 'occurred_on' ? 'type="date"' : ''} ${k === 'in' || k === 'out' ? 'inputmode="numeric" class="n"' : ''} value="${esc(val)}">`;
    const inp = td.querySelector('input'); inp.focus(); inp.select?.();
    let done = false;
    const spec = el => el ? {id:el.dataset.id, ed:el.dataset.ed} : null;
    const go = sp => { if(!sp) return; const el = $(`.xl td.ed[data-id="${sp.id}"][data-ed="${sp.ed}"]`); el && startEdit(el); };
    const finish = async (save, nextSp) => {
      if(done) return; done = true;
      td.classList.remove('on');
      if(!save){ td.innerHTML = prev; return; }
      let patch = null;
      if(k === 'occurred_on'){ if(inp.value && inp.value !== t.occurred_on) patch = {occurred_on:inp.value}; }
      else if(k === 'in' || k === 'out'){
        const n = parseNum(inp.value), kind = k === 'in' ? 'IN' : 'OUT';
        if(n > 0 && (n !== t.amount || kind !== t.kind)) patch = {amount:n, kind};
        else if(!n && t.kind === kind) toast('Nominal tidak boleh kosong — hapus transaksi lewat tampilan Daftar');
      } else {
        const v = inp.value.trim() || null;
        if(v !== (t[k] || null)) patch = {[k]: v};
      }
      if(patch){
        try{ await saveRow('transactions', id, patch, 'transactions'); toast('Tersimpan'); }
        catch(e){ toast('Gagal menyimpan: ' + e.message); }
        rerender();
      } else td.innerHTML = prev;
      go(nextSp);
    };
    inp.addEventListener('keydown', e => {
      const all = $$('.xl td.ed');
      if(e.key === 'Enter'){
        e.preventDefault();
        const col = all.filter(x => x.dataset.ed === k);
        finish(true, spec(col[col.indexOf(td) + 1]));
      } else if(e.key === 'Tab'){
        e.preventDefault();
        finish(true, spec(all[all.indexOf(td) + (e.shiftKey ? -1 : 1)]));
      } else if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    inp.addEventListener('blur', () => finish(true));
  };
  $$('.xl td.ed').forEach(td => td.addEventListener('click', () => startEdit(td)));

  /* ---------- baris baru ---------- */
  const add = async () => {
    const amount = parseNum($('#xnAmt').value);
    if(amount <= 0){ $('#xnAmt').focus(); return toast('Isi nominal dulu'); }
    const row = {kind:$('#xnKind').value, amount, occurred_on:$('#xnDate').value || today(),
      description:$('#xnDesc').value.trim() || null, category:$('#xnCat').value.trim() || null, booking_id:null};
    $('#xnAdd').disabled = true;
    try{ await insertRow('transactions', row, 'transactions'); toast('Transaksi tercatat'); rerender(); setTimeout(() => $('#xnDesc')?.focus(), 0); }
    catch(e){ $('#xnAdd').disabled = false; toast('Gagal menyimpan: ' + e.message); }
  };
  $('#xnAdd').onclick = add;
  $$('.xl-new input').forEach(i => i.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); add(); } }));
  $('#xnAmt').addEventListener('input', e => { const n = parseNum(e.target.value); e.target.value = n ? rp(n) : ''; });

  /* ---------- unduh ---------- */
  $('#xlDl').onclick = () => download(data, masuk, keluar, periodLabel);
}

async function download(data, masuk, keluar, periodLabel){
  const head = ['No', 'Tanggal', 'Jenis', 'Deskripsi', 'Kategori', 'Project', 'Pemasukan', 'Pengeluaran', 'Saldo'];
  const body = data.map((d, i) => [i + 1, d.t.occurred_on, d.t.kind === 'IN' ? 'Masuk' : 'Keluar', d.t.description || '', d.t.category || '', d.project,
    d.t.kind === 'IN' ? d.t.amount : '', d.t.kind === 'OUT' ? d.t.amount : '', d.bal]);
  const foot = ['', '', '', `Total ${periodLabel}`, '', '', masuk, keluar, masuk - keluar];
  const name = `kas-kalaatma-${periodLabel.replace(/[^\w-]+/g, '-').toLowerCase()}`;
  try{
    const XLSX = await import(/* @vite-ignore */ 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
    const ws = XLSX.utils.aoa_to_sheet([head, ...body, foot]);
    ws['!cols'] = [6, 12, 9, 40, 18, 30, 15, 15, 15].map(w => ({wch:w}));
    for(let r = 2; r <= body.length + 2; r++) ['G', 'H', 'I'].forEach(c => { const x = ws[c + r]; if(x && typeof x.v === 'number') x.z = '#,##0'; });
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Kas');
    XLSX.writeFile(wb, name + '.xlsx');
  }catch(_){
    // cadangan: CSV titik-koma (cocok dengan Excel berbahasa Indonesia)
    const q = v => `"${String(v).replace(/"/g, '""')}"`;
    const csv = '﻿sep=;\n' + [head, ...body, foot].map(r => r.map(q).join(';')).join('\n');
    const a = Object.assign(document.createElement('a'), {href:URL.createObjectURL(new Blob([csv], {type:'text/csv'})), download:name + '.csv'});
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Diunduh sebagai CSV (bisa dibuka di Excel)');
  }
}
