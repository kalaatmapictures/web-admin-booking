/* =====================================================================
   TEMA TERANG / GELAP / OTOMATIS
   Pilihan disimpan per browser (localStorage). Tema awal sudah dipasang
   oleh skrip kecil di index.html sebelum halaman tampil (tanpa kedip).
   ===================================================================== */
const KEY = 'kalaatma-theme';
const mq = window.matchMedia('(prefers-color-scheme: dark)');
const ICON = {
  light:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  system:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>'
};
const LABEL = {light:'Terang', dark:'Gelap', system:'Otomatis'};

export function themePref(){
  try{ const v = localStorage.getItem(KEY); return LABEL[v] ? v : 'light'; }catch(_){ return 'light'; }
}
const resolve = p => p === 'system' ? (mq.matches ? 'dark' : 'light') : p;

export function applyTheme(){
  const pref = themePref(), t = resolve(pref);
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0E0F1D' : '#4A46E0');
  const btn = document.getElementById('themeBtn');
  if(btn){
    btn.innerHTML = t === 'dark' ? ICON.light : ICON.dark;
    btn.title = t === 'dark' ? 'Ganti ke mode terang' : 'Ganti ke mode gelap';
    btn.setAttribute('aria-label', btn.title);
  }
  document.querySelectorAll('[data-theme-set]').forEach(b => b.classList.toggle('on', b.dataset.themeSet === pref));
}
export function setTheme(pref){
  try{ localStorage.setItem(KEY, pref); }catch(_){}
  applyTheme();
}
/* segmen Terang | Gelap | Otomatis */
export const themeSeg = () => `<div class="theme-seg" role="group" aria-label="Tampilan">${
  ['light','dark','system'].map(k => `<button type="button" data-theme-set="${k}" class="${themePref() === k ? 'on' : ''}">${ICON[k]}${LABEL[k]}</button>`).join('')}</div>`;

document.addEventListener('click', e => {
  const seg = e.target.closest?.('[data-theme-set]');
  if(seg) return setTheme(seg.dataset.themeSet);
  if(e.target.closest?.('#themeBtn')) setTheme(resolve(themePref()) === 'dark' ? 'light' : 'dark');
});
mq.addEventListener?.('change', () => { if(themePref() === 'system') applyTheme(); });
