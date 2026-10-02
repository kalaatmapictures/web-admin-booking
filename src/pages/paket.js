/* PAKET & HARGA (brief #4)
   Harga diambil dari menu landing page (satu sumber harga), jadi
   mengubah harga di sini langsung mengubah harga di halaman booking.
   HPP disimpan terpisah (tabel package_costs) karena tidak tampil ke pelanggan. */
import { $, $$, S, RENDER, rp, esc, toast, money, moneyVal, openModal, closeModal,
         commitCatalog, saveCost, logAct, go } from '../core.js';

RENDER.paket = () => {
  const rows = S.data.packages;
  $('#pgSub').textContent = `${rows.length} paket · harga sinkron dengan landing page`;
  $('#page').innerHTML = `
    <div class="banner info">Harga di sini adalah harga yang tampil di landing page. Isi, urutan, dan label paket diatur di
      <button class="linkbtn" id="toMenu">Menu Landing Page</button>.</div>
    <div class="card"><div class="tablewrap"><table>
      <thead><tr><th>Paket</th><th>Kategori</th><th class="r">Harga</th><th class="r">HPP Estimasi</th><th class="r">Margin</th><th class="r"></th></tr></thead>
      <tbody>${rows.map(p=>`<tr>
        <td><div class="tname">${esc(p.name)}</div>${p.hidden ? '<div class="tsub">Tidak tampil di landing page</div>' : ''}</td>
        <td>${esc(p.category)}</td>
        <td class="r num" style="font-weight:600">${rp(p.price)}${p.perPerson ? '<div class="tsub">per orang</div>' : ''}</td>
        <td class="r num">${p.hpp_estimate ? rp(p.hpp_estimate) : '<span class="tsub">belum diisi</span>'}</td>
        <td class="r num"><span style="color:${p.margin>0?'var(--ok)':'var(--err)'};font-weight:600">${rp(p.margin)}</span>
          <div class="tsub">${p.margin_pct}%</div></td>
        <td class="r"><button class="btn soft sm" data-pk="${esc(p.id)}">Ubah</button></td>
      </tr>`).join('')}</tbody></table></div></div>`;
  $('#toMenu').onclick = () => go('menu');
  $$('[data-pk]').forEach(b=>b.onclick=()=>editHpp(b.dataset.pk));
};

function findPackage(id){
  for(const s of S.catalog.services) for(const g of s.groups){
    const p = g.packages.find(x => x.id === id);
    if(p) return {s, g, p};
  }
  return null;
}

function editHpp(id){
  const row = S.data.packages.find(x=>x.id===id);
  openModal(`<h3>${esc(row.name)}</h3>
    <p>Ketik angka biasa, tampilannya otomatis jadi Rupiah. Harga baru langsung dipakai landing page.</p>
    <div class="fld money" style="margin-top:16px"><label>Harga paket${row.perPerson ? ' (per orang)' : ''}</label><input id="pkPrice" inputmode="numeric"></div>
    <div class="fld money" style="margin-top:11px"><label>HPP Estimasi</label><input id="pkHpp" inputmode="numeric"></div>
    <div class="rowline" style="margin-top:14px"><span class="k">Margin</span><span class="v" id="pkMargin">—</span></div>
    <div class="acts"><button class="btn soft" data-mclose>Batal</button><button class="btn" id="pkSave">Simpan</button></div>`);
  const a = money($('#pkPrice'), row.price), b = money($('#pkHpp'), row.hpp_estimate);
  const calc = () => { const m = moneyVal(a)-moneyVal(b);
    $('#pkMargin').innerHTML = `${rp(m)} <span class="tsub">(${moneyVal(a)?Math.round(m/moneyVal(a)*1000)/10:0}%)</span>`; };
  calc(); a.addEventListener('money',calc); b.addEventListener('money',calc);
  $('#pkSave').onclick = async () => {
    const price = moneyVal(a), hpp = moneyVal(b);
    if(price <= 0) return toast('Harga belum diisi');
    const btn = $('#pkSave'); btn.disabled = true;
    try{
      if(price !== row.price){
        const hit = findPackage(id);
        const old = hit.p.price;
        hit.p.price = price;
        const ok = await commitCatalog({action:'update', entity:'Paket', target:`${hit.s.label} › ${hit.p.name}`,
          detail:`Harga: ${rp(old)} → ${rp(price)}`}, 'Harga diperbarui — landing page ikut berubah');
        if(!ok){ closeModal(); RENDER.paket(); return; }
      }
      if(hpp !== row.hpp_estimate){
        await saveCost(id, hpp);
        await logAct('update', 'Paket', row.name, `HPP: ${rp(row.hpp_estimate)} → ${rp(hpp)}`);
        if(price === row.price) toast('HPP diperbarui');
      }
    }catch(e){ toast('Gagal menyimpan: ' + e.message); }
    closeModal(); RENDER.paket();
  };
}
