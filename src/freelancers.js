/* =====================================================================
   PERAN & RATE FREELANCER — helper bersama halaman Freelancer dan
   detail booking. Satu freelancer bisa memegang beberapa peran:
   peran utama (freelancers.role) + peran di rate-nya (freelancer_rates.role).
   Sengaja tidak memakai nilai core.js di level modul (import melingkar).
   ===================================================================== */
import { S } from './core.js';

export const ROLE_LABEL = {PHOTOGRAPHER:'Photographer', VIDEOGRAPHER:'Videographer', EDITOR:'Editor', ASSISTANT:'Assistant', WCC:'Wedding Content Creator', OTHER:'Lainnya'};
export const GENERAL_EVENT = 'Umum';
export const uniq = a => [...new Set(a.filter(Boolean))];
const roleOrder = Object.keys(ROLE_LABEL);

export const ratesOf = id => (S.data.freelancerRates || []).filter(r => r.freelancer_id === id)
  .sort((a, b) => roleOrder.indexOf(rateRole(a)) - roleOrder.indexOf(rateRole(b))
    || (a.event === GENERAL_EVENT) - (b.event === GENERAL_EVENT) || a.event.localeCompare(b.event));
/* rate lama tanpa peran dianggap memakai peran utama freelancer */
export const rateRole = r => r.role || S.data.freelancers.find(f => f.id === r.freelancer_id)?.role || 'OTHER';
export const roleName = r => ROLE_LABEL[r] || r;

export const rolesOf = f => f ? uniq([f.role, ...ratesOf(f.id).map(rateRole)])
  .sort((a, b) => roleOrder.indexOf(a) - roleOrder.indexOf(b)) : [];
export const hasRole = (f, role) => rolesOf(f).includes(role);
export const rolesText = f => rolesOf(f).map(roleName).join(' · ');

/* rate yang berlaku untuk sebuah booking: rate peran yang dipegang (kalau ada),
   lalu event = nama layanan, kalau tidak ada pakai "Umum" */
export const rateFor = (fid, service, role) => {
  const all = ratesOf(fid);
  const byRole = role ? all.filter(r => rateRole(r) === role) : all;
  const list = byRole.length ? byRole : all;
  const lc = s => String(s || '').trim().toLowerCase();
  return list.find(r => lc(r.event) === lc(service)) || list.find(r => r.event === GENERAL_EVENT) || null;
};
