/* =====================================================================
   KALAATMA BMS — titik masuk
   Mendaftarkan semua halaman lalu menjalankan login.
   ===================================================================== */
import { initAuth, initShell, $, S } from './core.js';
import './pages/dashboard.js';
import './pages/booking.js';
import './pages/joblist.js';
import './pages/lead.js';
import './pages/client.js';
import './pages/freelancer.js';
import './pages/paket.js';
import './pages/menu.js';
import './pages/kas.js';
import './pages/calendar.js';
import './pages/activity.js';
import { initInvoice } from './pages/detail.js';

initShell();
initInvoice();
initAuth();

/* avatar sidebar mengikuti nama admin */
new MutationObserver(() => {
  $('.whobox .av').textContent = (S.admin.name.trim()[0] || 'A').toUpperCase();
}).observe($('#whoName'), {childList:true});
