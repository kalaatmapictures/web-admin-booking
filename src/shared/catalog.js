/* =========================================================
   KONTRAK DATA KATALOG — file ini IDENTIK di kedua repo:
     • marselcerebrum-jpg/form-booking      (landing page)
     • marselcerebrum-jpg/web-admin-booking (web admin)
   Ubah di keduanya bila formatnya berubah.

   Katalog disimpan sebagai satu dokumen JSON di tabel
   Supabase `app_config` (key = 'catalog'):
   {
     services: [{ id, label, title, desc, couple, usesPeople, terms, hidden,
                  groups: [{ id, label, people, packages: [{ id, name, price,
                    perPerson, min, max, items[], recommended, bestSeller, hidden }] }],
                  addons: [{ id, name, price, unit, qty, group, hidden }] }],
     terms:    { [key]: { title, label, list[] } },
     settings: { dpPercent, holdMinutes, bank:{name,accountNo,accountName},
                 whatsapp:{general,paymentConfirm} }
   }
   ========================================================= */
import { SERVICES, TERMS, PACKAGE_HIGHLIGHTS, SETTINGS } from './catalog-default.js';

export const CATALOG_KEY = 'catalog';

const clone = v => JSON.parse(JSON.stringify(v));

/* Pricelist bawaan Kalaatma 2026 dalam format kontrak di atas. */
export function defaultCatalog(){
  const rec = new Set(PACKAGE_HIGHLIGHTS.recommendedIds);
  const best = new Set(PACKAGE_HIGHLIGHTS.bestSellerIds);
  return {
    services: Object.entries(clone(SERVICES)).map(([id, s]) => ({
      id, ...s, hidden:false,
      groups: s.groups.map(g => ({
        ...g,
        packages: g.packages.map(p => ({
          ...p, hidden:false,
          recommended: rec.has(p.id) || !!p.recommended,
          bestSeller:  best.has(p.id) || !!p.bestSeller
        }))
      })),
      addons: s.addons.map(a => ({...a, hidden:false}))
    })),
    terms: clone(TERMS),
    settings: clone(SETTINGS)
  };
}

/* Pemeriksaan bentuk dasar — dipakai sebelum menyimpan / setelah membaca. */
export function isCatalog(c){
  return !!c && Array.isArray(c.services) && !!c.terms && !!c.settings &&
    c.services.every(s => s && s.id && s.label && Array.isArray(s.groups) && Array.isArray(s.addons));
}

/* Versi yang dilihat pelanggan: item tersembunyi dibuang, layanan
   tanpa paket aktif tidak ditampilkan. Layanan dikunci per id. */
export function publicCatalog(catalog){
  const services = {};
  for(const s of catalog.services){
    if(s.hidden) continue;
    const groups = s.groups
      .map(g => ({...g, packages: g.packages.filter(p => !p.hidden)}))
      .filter(g => g.packages.length);
    if(!groups.length) continue;
    services[s.id] = {...s, groups, addons: s.addons.filter(a => !a.hidden)};
  }
  return { services, terms: catalog.terms, settings: catalog.settings };
}
