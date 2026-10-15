// =====================================================================
// KALAATMA — Edge Function: meta-ads-sync
// Menarik performa iklan dari Meta Marketing API (Insights) lalu
// menyimpannya ke tabel meta_ads_insights, meta_ads, dan meta_sync_runs.
//
// Dipanggil oleh:
//   • pg_cron setiap pagi  → header  x-cron-secret: <CRON_SECRET>
//   • tombol "Sync sekarang" di BMS → Authorization: Bearer <token admin>
//
// Secret (Supabase → Edge Functions → Secrets):
//   META_ACCESS_TOKEN   token System User (permission ads_read)
//   META_AD_ACCOUNT_ID  contoh act_1234567890 (boleh tanpa "act_")
//   CRON_SECRET         string acak bebas, sama dengan yang dipakai pg_cron
//   META_API_VERSION    opsional, default v23.0
// SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY tersedia otomatis.
// =====================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const env = (k: string) => Deno.env.get(k) ?? '';
const API = `https://graph.facebook.com/${env('META_API_VERSION') || 'v23.0'}`;
const MAX_DAYS = 90;

// mata uang tanpa sen di Meta (budget dikirim apa adanya, bukan ×100)
const NO_CENTS = new Set(['IDR', 'JPY', 'KRW', 'VND', 'CLP', 'COP', 'CRC', 'HUF', 'ISK', 'PYG', 'TWD']);

/* ---------- tanggal (WIB) ---------- */
const wibToday = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => {
  const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10);
};
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/* ---------- Meta Graph API ---------- */
async function graph(url: string) {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok || body.error) {
    const e = body.error || {};
    throw new Error(`Meta API: ${e.message || res.status}${e.code ? ` (code ${e.code})` : ''}`);
  }
  return body;
}
async function graphAll(path: string, params: Record<string, string>) {
  const qs = new URLSearchParams({ ...params, access_token: env('META_ACCESS_TOKEN'), limit: '500' });
  let url: string | undefined = `${API}/${path}?${qs}`;
  const out: any[] = [];
  while (url) {
    const page = await graph(url);
    out.push(...(page.data || []));
    url = page.paging?.next;
  }
  return out;
}

/* ---------- hasil utama sesuai tujuan campaign ---------- */
const num = (v: unknown) => Number(v) || 0;
const action = (actions: any[] | undefined, ...types: string[]) => {
  for (const t of types) {
    const a = actions?.find((x) => x.action_type === t);
    if (a) return num(a.value);
  }
  return 0;
};
function pickResult(objective: string, r: { messages: number; leads: number; link_clicks: number; reach: number }) {
  const o = (objective || '').toUpperCase();
  if (['OUTCOME_AWARENESS', 'REACH', 'BRAND_AWARENESS'].includes(o)) return { type: 'reach', value: r.reach };
  if (['OUTCOME_TRAFFIC', 'LINK_CLICKS'].includes(o)) return { type: 'link_clicks', value: r.link_clicks };
  if (['MESSAGES'].includes(o)) return { type: 'messages', value: r.messages };
  if (['OUTCOME_LEADS', 'LEAD_GENERATION'].includes(o) && (r.leads || !r.messages)) return { type: 'leads', value: r.leads };
  // engagement / leads via WhatsApp / lainnya: pakai yang benar-benar terjadi
  if (r.messages) return { type: 'messages', value: r.messages };
  if (r.leads) return { type: 'leads', value: r.leads };
  return { type: 'link_clicks', value: r.link_clicks };
}

/* ---------- auth: cron secret atau admin yang login ---------- */
async function authorize(req: Request): Promise<'cron' | 'manual' | null> {
  const secret = env('CRON_SECRET');
  if (secret && req.headers.get('x-cron-secret') === secret) return 'cron';
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: auth } },
  });
  const { data } = await userClient.rpc('is_admin');
  return data === true ? 'manual' : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Gunakan POST' }, 405);

  const trigger = await authorize(req);
  if (!trigger) return json({ error: 'Tidak diizinkan' }, 401);

  const token = env('META_ACCESS_TOKEN');
  const rawAcct = env('META_AD_ACCOUNT_ID').trim();
  if (!token || !rawAcct) return json({ error: 'META_ACCESS_TOKEN / META_AD_ACCOUNT_ID belum diisi di Secrets' }, 400);
  const acct = rawAcct.startsWith('act_') ? rawAcct : `act_${rawAcct}`;

  // periode: default 3 hari terakhir (data Meta bisa berubah 1–2 hari setelahnya)
  const body = await req.json().catch(() => ({}));
  const to = isDate(body.to) ? body.to : wibToday();
  let from = isDate(body.from) ? body.from : addDays(to, -(Math.min(Number(body.days) || 3, MAX_DAYS) - 1));
  if (from < addDays(to, -(MAX_DAYS - 1))) from = addDays(to, -(MAX_DAYS - 1));

  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const { data: run } = await db.from('meta_sync_runs')
    .insert({ trigger, date_from: from, date_to: to }).select('id').single();
  const finish = (patch: Record<string, unknown>) =>
    run ? db.from('meta_sync_runs').update({ finished_at: new Date().toISOString(), ...patch }).eq('id', run.id) : null;

  try {
    const account = await graph(`${API}/${acct}?fields=currency&access_token=${encodeURIComponent(token)}`);
    const currency: string = account.currency || 'IDR';
    const budget = (v: unknown) => (v == null || v === '' ? null : num(v) / (NO_CENTS.has(currency) ? 1 : 100));

    /* 1. insights per iklan per hari, dipecah per 30 hari */
    const rows: any[] = [];
    for (let s = from; s <= to; s = addDays(s, 30)) {
      const e = addDays(s, 29) < to ? addDays(s, 29) : to;
      const data = await graphAll(`${acct}/insights`, {
        level: 'ad',
        time_increment: '1',
        time_range: JSON.stringify({ since: s, until: e }),
        fields: 'campaign_id,campaign_name,objective,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,clicks,inline_link_clicks,actions',
      });
      for (const d of data) {
        const m = {
          messages: action(d.actions, 'onsite_conversion.messaging_conversation_started_7d'),
          leads: action(d.actions, 'lead', 'onsite_conversion.lead_grouped', 'leadgen_grouped'),
          link_clicks: num(d.inline_link_clicks),
          reach: num(d.reach),
        };
        const r = pickResult(d.objective, m);
        rows.push({
          ad_id: d.ad_id, date: d.date_start, account_id: acct, currency,
          campaign_id: d.campaign_id, campaign_name: d.campaign_name, objective: d.objective,
          adset_id: d.adset_id, adset_name: d.adset_name, ad_name: d.ad_name,
          spend: num(d.spend), impressions: num(d.impressions), reach: m.reach, clicks: num(d.clicks),
          link_clicks: m.link_clicks, messages: m.messages, leads: m.leads,
          results: r.value, result_type: r.type, actions: d.actions ?? null,
          synced_at: new Date().toISOString(),
        });
      }
    }
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from('meta_ads_insights').upsert(rows.slice(i, i + 500), { onConflict: 'ad_id,date' });
      if (error) throw new Error('Simpan insights: ' + error.message);
    }

    /* 2. status & budget terkini semua iklan */
    const ads = await graphAll(`${acct}/ads`, {
      fields: 'id,name,effective_status,created_time,creative{thumbnail_url},' +
        'adset{id,name,effective_status,daily_budget},campaign{id,name,effective_status,daily_budget,objective}',
    });
    const meta = ads.map((a) => ({
      ad_id: a.id, ad_name: a.name, status: a.effective_status, created_time: a.created_time,
      thumbnail_url: a.creative?.thumbnail_url ?? null,
      adset_id: a.adset?.id, adset_name: a.adset?.name, adset_status: a.adset?.effective_status,
      adset_budget: budget(a.adset?.daily_budget),
      campaign_id: a.campaign?.id, campaign_name: a.campaign?.name, campaign_status: a.campaign?.effective_status,
      campaign_budget: budget(a.campaign?.daily_budget), objective: a.campaign?.objective,
      synced_at: new Date().toISOString(),
    }));
    for (let i = 0; i < meta.length; i += 500) {
      const { error } = await db.from('meta_ads').upsert(meta.slice(i, i + 500), { onConflict: 'ad_id' });
      if (error) throw new Error('Simpan status iklan: ' + error.message);
    }

    await finish({ ok: true, rows: rows.length, message: `${rows.length} baris · ${meta.length} iklan` });
    return json({ ok: true, from, to, rows: rows.length, ads: meta.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await finish({ ok: false, message });
    return json({ ok: false, error: message }, 502);
  }
});
