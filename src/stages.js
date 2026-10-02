/* =====================================================================
   TAHAP JOBLIST, KATEGORI PROJECT, LABEL KARTU
   Stage tidak disimpan terpisah. Stage = turunan dari bookings.status,
   jadi kartu tidak pernah bisa berbeda dari status sebenarnya.
   Booking baru dari website berstatus NEW → otomatis muncul di BOOKING.
   ===================================================================== */
import { categories } from './core.js';

export const STAGES = [
  {id:'BOOKING',    label:'Booking',    color:'#6F76AC', bg:'#ECEEF7', fg:'#4E5590', primary:'NEW',        statuses:['NEW','CONTACTED','WAITING_DP']},
  {id:'ONBOARDING', label:'Onboarding', color:'#4A46E0', bg:'#E5E4FE', fg:'#3733C4', primary:'CONFIRMED',  statuses:['CONFIRMED']},
  {id:'EVENT',      label:'Event',      color:'#E8951F', bg:'#FDEED6', fg:'#9A6210', primary:'BOOKED',     statuses:['BOOKED']},
  {id:'DELIVERY',   label:'Delivery',   color:'#137285', bg:'#D7EFF5', fg:'#0F6274', primary:'EVENT_DONE', statuses:['EVENT_DONE','DELIVERED']},
  {id:'DONE',       label:'Done',       color:'#1FB98A', bg:'#D6F5E9', fg:'#0C6E51', primary:'COMPLETED',  statuses:['COMPLETED']}
];
export const stageOf = b => STAGES.find(s => s.statuses.includes(b.status))?.id || null;
export const stageIx = id => STAGES.findIndex(s => s.id === id);

/* Kategori project — beberapa layanan digabung jadi satu kategori.
   Layanan baru dari menu landing page yang belum masuk grup mana pun
   otomatis mendapat kategorinya sendiri. */
const BASE_GROUPS = [
  {id:'WEDDING',    label:'Wedding',    services:['Wedding','Prewedding','Engagement']},
  {id:'GRADUATION', label:'Graduation', services:['Graduation']},
  {id:'FAMILY',     label:'Family',     services:['Family','Maternity']}
];
export function catGroups(){
  const covered = new Set(BASE_GROUPS.flatMap(g => g.services));
  const extra = categories().filter(c => !covered.has(c)).map(c => ({id:'SVC:' + c, label:c, services:[c]}));
  return [{id:'ALL', label:'Semua Kategori', services:null}, ...BASE_GROUPS, ...extra];
}
export const catGroup = id => catGroups().find(c => c.id === id) || catGroups()[0];

/* Label pembayaran selalu mengikuti data pembayaran — tidak bisa ditimpa
   manual, supaya kartu tidak pernah bilang "Lunas" kalau uangnya belum masuk. */
export const PAY_LABELS = [
  {id:'PAY_UNPAID', text:'Belum Bayar', cls:'lb-red',   from:['UNPAID']},
  {id:'PAY_DP',     text:'DP Paid',     cls:'lb-blue',  from:['DP_PAID','PARTIALLY_PAID']},
  {id:'PAY_PAID',   text:'Lunas',       cls:'lb-green', from:['FULLY_PAID']}
];
export const payLabel = b => PAY_LABELS.find(p => p.from.includes(b.payment_status)) || null;
export const MANUAL_LABELS = [
  {id:'EDITING', text:'Editing', cls:'lb-orange'},
  {id:'DONE',    text:'Done',    cls:'lb-teal'}
];
export const labelChips = b => {
  const p = payLabel(b);
  const pay = p ? `<span class="lb ${p.cls}">${p.text}</span>` : '';
  const man = MANUAL_LABELS.filter(L => (b.labels||[]).includes(L.id))
    .map(L => `<span class="lb ${L.cls}">${L.text}</span>`).join('');
  return pay + man;
};
