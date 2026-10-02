/* =========================================================
   STORE — satu antarmuka, dua penyimpanan:
   • 'supabase' : bila VITE_SUPABASE_URL & ANON_KEY diisi.
                  Katalog dibaca landing page dari database yang
                  sama, jadi admin & landing page terintegrasi.
   • 'local'    : tanpa Supabase. Disimpan di localStorage browser
                  ini saja — untuk mencoba tampilan admin.
   ========================================================= */
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, supabaseReady } from './config.js';
import { CATALOG_KEY, defaultCatalog, isCatalog } from '../shared/catalog.js';

export const mode = supabaseReady() ? 'supabase' : 'local';
const sb = mode === 'supabase' ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const LOCAL_CATALOG  = 'kalaatma.catalog.v1';
const LOCAL_ACTIVITY = 'kalaatma.activity.v1';
const ACTIVITY_MAX = 500;

const readLocal = key => { try{ const r = localStorage.getItem(key); return r ? JSON.parse(r) : null; }catch(_){ return null; } };
const writeLocal = (key, v) => { try{ localStorage.setItem(key, JSON.stringify(v)); return true; }catch(_){ return false; } };

/* ---------- auth (hanya mode supabase) ---------- */
export let admin = { name:'Admin', email:null };

/* null = sesi valid; selain itu pesan untuk layar login */
export async function checkSession(){
  if(mode === 'local') return null;
  const { data:{ session } } = await sb.auth.getSession();
  if(!session) return 'login';
  return resolveAdmin(session.user);
}
async function resolveAdmin(user){
  const { data, error } = await sb.from('admins').select('name').eq('user_id', user.id).maybeSingle();
  if(error) return 'Tidak bisa memeriksa akses admin: ' + error.message;
  if(!data){ await sb.auth.signOut(); return 'Akun ini belum terdaftar sebagai admin.'; }
  admin = { name:data.name || user.email, email:user.email };
  return null;
}
export async function signIn(email, password){
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if(error) return error.message === 'Invalid login credentials' ? 'Email atau kata sandi salah.' : error.message;
  return resolveAdmin(data.user);
}
export async function signOut(){ if(sb) await sb.auth.signOut(); }

/* ---------- katalog ---------- */
// versi = updated_at baris katalog saat dimuat; dipakai untuk mencegah
// dua admin saling menimpa perubahan tanpa sadar.
let version = null;

export async function loadCatalog(){
  if(mode === 'local'){
    const c = readLocal(LOCAL_CATALOG);
    return isCatalog(c) ? c : defaultCatalog();
  }
  const { data, error } = await sb.from('app_config').select('value, updated_at').eq('key', CATALOG_KEY).maybeSingle();
  if(error) throw new Error(error.message);
  version = data ? data.updated_at : null;
  return data && isCatalog(data.value) ? data.value : defaultCatalog();
}

/* { ok:true } | { ok:false, conflict:true } | { ok:false, error } */
export async function saveCatalog(catalog){
  if(!isCatalog(catalog)) return { ok:false, error:'Format menu tidak valid' };
  if(mode === 'local') return writeLocal(LOCAL_CATALOG, catalog) ? { ok:true } : { ok:false, error:'Penyimpanan browser penuh atau diblokir' };

  if(version === null){
    const { data, error } = await sb.from('app_config').insert({ key:CATALOG_KEY, value:catalog }).select('updated_at').single();
    if(error) return error.code === '23505' ? { ok:false, conflict:true } : { ok:false, error:error.message };
    version = data.updated_at;
    return { ok:true };
  }
  const { data, error } = await sb.from('app_config').update({ value:catalog })
    .eq('key', CATALOG_KEY).eq('updated_at', version).select('updated_at');
  if(error) return { ok:false, error:error.message };
  if(!data.length) return { ok:false, conflict:true };
  version = data[0].updated_at;
  return { ok:true };
}

/* ---------- log aktivitas ---------- */
const fromRow = r => ({ id:r.id, at:r.at, actor:r.actor, action:r.action, entity:r.entity, target:r.target, detail:r.detail });

export async function loadActivity(){
  if(mode === 'local') return readLocal(LOCAL_ACTIVITY) || [];
  const { data, error } = await sb.from('admin_activity').select('*').order('at', { ascending:false }).limit(ACTIVITY_MAX);
  if(error) throw new Error(error.message);
  return data.map(fromRow);
}

/* mengembalikan entri yang tersimpan (atau null bila gagal) */
export async function logActivity(entry){
  const row = { actor:admin.name, ...entry, detail:entry.detail || null };
  if(mode === 'local'){
    const full = { id:Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at:new Date().toISOString(), ...row };
    const list = [full, ...(readLocal(LOCAL_ACTIVITY) || [])].slice(0, ACTIVITY_MAX);
    writeLocal(LOCAL_ACTIVITY, list);
    return full;
  }
  const { data, error } = await sb.from('admin_activity').insert(row).select('*').single();
  if(error){ console.warn('[Kalaatma] log gagal:', error.message); return null; }
  return fromRow(data);
}

/* log di Supabase bersifat append-only (jejak audit), jadi hanya mode lokal yang bisa dibersihkan */
export const canClearActivity = mode === 'local';
export function clearActivity(){ try{ localStorage.removeItem(LOCAL_ACTIVITY); }catch(_){} }

/* sinkron antar tab (mode lokal) */
export function onExternalChange(fn){
  if(mode === 'local') window.addEventListener('storage', e => { if(e.key === LOCAL_CATALOG || e.key === LOCAL_ACTIVITY) fn(); });
}
