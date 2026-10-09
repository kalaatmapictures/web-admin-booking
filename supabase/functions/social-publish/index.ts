// =====================================================================
// SOCIAL PUBLISH — memposting konten terjadwal ke Instagram (Graph API).
// TikTok (tahap 1): saat jadwal tiba, posting berstatus "manual" — admin
// mengunduh video + menyalin caption, posting di aplikasi TikTok, lalu
// menandai "Sudah diposting" di web admin.
//
// Dipanggil oleh:
//   • pg_cron tiap 2 menit  → header x-cron-secret (disimpan di social_credentials
//                              baris '_cron', dibuat & dibaca langsung oleh database), {action:'tick'}
//   • web admin (admin)     → Authorization: Bearer <JWT admin>
//       {action:'status'}               cek koneksi Instagram + kuota
//       {action:'publish_now', id}      posting sekarang
//       {action:'tick'}                 proses semua yang sudah jatuh tempo
//       {action:'insights', days, refresh}  analisa akun & konten (cache 30 menit)
//
// Token Instagram disimpan di tabel social_credentials (tidak bisa dibaca
// dari browser); fungsi ini membacanya dengan service role.
// =====================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const GRAPH = (Deno.env.get("IG_GRAPH_HOST") || "https://graph.facebook.com") + "/" +
  (Deno.env.get("IG_GRAPH_VERSION") || "v26.0");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

/* ---------- database (service role) ---------- */
async function db(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json",
      Prefer: "return=representation", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`db ${res.status}: ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}
const patchPost = (id: string, patch: Record<string, unknown>) =>
  db(`social_posts?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) });

/* Kunci posting ±3 menit supaya cron & "Posting sekarang" tidak memproses
   posting yang sama bersamaan (mencegah posting ganda di Instagram). */
async function claim(id: string): Promise<boolean> {
  const now = new Date(), until = new Date(now.getTime() + 180_000).toISOString();
  const rows = await db(`social_posts?id=eq.${id}&or=(locked_until.is.null,locked_until.lt.${now.toISOString()})`,
    { method: "PATCH", body: JSON.stringify({ locked_until: until }) });
  return Array.isArray(rows) && rows.length > 0;
}

async function cronSecret(): Promise<string> {
  const rows = await db("social_credentials?platform=eq._cron&select=access_token");
  return rows?.[0]?.access_token || "";
}

async function isAdmin(jwt: string) {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/is_admin`, {
    method: "POST", body: "{}",
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
  });
  return res.ok && (await res.json()) === true;
}

/* ---------- Instagram Graph API ---------- */
type Cred = { account_id: string; access_token: string };
async function igCred(): Promise<Cred | null> {
  const rows = await db("social_credentials?platform=eq.instagram&select=account_id,access_token");
  return rows?.[0] || null;
}
async function ig(cred: Cred, path: string, params: Record<string, string> = {}, method = "POST") {
  const q = new URLSearchParams({ ...params, access_token: cred.access_token });
  const url = method === "GET" ? `${GRAPH}/${path}?${q}` : `${GRAPH}/${path}`;
  const res = await fetch(url, method === "GET" ? {} : { method, body: q });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const e = data.error || {};
    throw new Error(e.error_user_msg || e.message || `Instagram error ${res.status}`);
  }
  return data;
}
const containerStatus = async (cred: Cred, id: string) =>
  (await ig(cred, id, { fields: "status_code,status" }, "GET")) as { status_code: string; status?: string };

type Media = { url: string; type: "image" | "video" };
type Post = {
  id: string; kind: "photo" | "carousel" | "reel"; platforms: string[]; caption: string;
  media: Media[]; status: string; scheduled_at: string | null;
  ig: Record<string, any>; tiktok: Record<string, any>;
};

/* Buat container (sekali), cek status, lalu publish bila semua siap.
   Video butuh waktu diproses Instagram → bisa berlanjut di panggilan berikutnya. */
async function stepInstagram(post: Post, cred: Cred) {
  const st = { ...post.ig };
  st.attempts = (st.attempts || 0) + 1;
  if (st.attempts > 30) throw new Error("Instagram terlalu lama memproses media (lebih dari ±1 jam). Coba unggah ulang.");
  if (!st.creation_id) {
    const acc = cred.account_id;
    if (post.kind === "photo") {
      const m = post.media[0];
      const r = await ig(cred, `${acc}/media`, { image_url: m.url, caption: post.caption });
      st.creation_id = r.id; st.children = [];
    } else if (post.kind === "reel") {
      const m = post.media[0];
      const r = await ig(cred, `${acc}/media`, { media_type: "REELS", video_url: m.url, caption: post.caption, share_to_feed: "true" });
      st.creation_id = r.id; st.children = [];
    } else {
      const children: string[] = [];
      for (const m of post.media.slice(0, 10)) {
        const p: Record<string, string> = { is_carousel_item: "true" };
        if (m.type === "video") { p.media_type = "VIDEO"; p.video_url = m.url; } else p.image_url = m.url;
        children.push((await ig(cred, `${acc}/media`, p)).id);
      }
      st.children = children;
      // container induk carousel dibuat setelah semua anak selesai diproses
    }
  }
  // tunggu semua video selesai diproses
  const waitIds = [...(st.children || []), ...(st.creation_id ? [st.creation_id] : [])];
  for (const id of waitIds) {
    const s = await containerStatus(cred, id);
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED")
      throw new Error(`Media ditolak Instagram (${s.status_code}${s.status ? ": " + s.status : ""})`);
    if (s.status_code === "IN_PROGRESS") { st.state = "processing"; return st; }
  }
  if (post.kind === "carousel" && !st.creation_id) {
    const r = await ig(cred, `${cred.account_id}/media`, { media_type: "CAROUSEL", children: st.children.join(","), caption: post.caption });
    st.creation_id = r.id;
    st.state = "processing";
    return st;                                   // dicek & dipublish di langkah berikutnya
  }
  const pub = await ig(cred, `${cred.account_id}/media_publish`, { creation_id: st.creation_id });
  st.media_id = pub.id;
  try { st.permalink = (await ig(cred, pub.id, { fields: "permalink" }, "GET")).permalink; } catch { /* opsional */ }
  st.state = "published"; st.published_at = new Date().toISOString(); st.error = null;
  return st;
}

async function processPost(post: Post, cred: Cred | null) {
  const wantsIg = post.platforms.includes("instagram");
  const wantsTt = post.platforms.includes("tiktok");
  const patch: Record<string, unknown> = {};
  let ig = { ...post.ig };

  if (wantsIg && ig.state !== "published" && ig.state !== "failed") {
    try {
      if (!cred) throw new Error("Instagram belum terhubung (Sosmed → Hubungkan Instagram).");
      ig = await stepInstagram(post, cred);
    } catch (e) {
      ig = { ...ig, state: "failed", error: String((e as Error).message || e) };
    }
    patch.ig = ig;
  }
  if (wantsTt && !post.tiktok?.state) patch.tiktok = { ...post.tiktok, state: "ready", ready_at: new Date().toISOString() };

  const igDone = !wantsIg || ig.state === "published";
  const ttDone = !wantsTt || post.tiktok?.state === "posted";
  // manual = Instagram selesai, tinggal TikTok yang diposting manual dari web admin
  patch.status = wantsIg && ig.state === "failed" ? "failed" : !igDone ? "publishing" : ttDone ? "published" : "manual";
  patch.locked_until = null;
  await patchPost(post.id, patch);
  return { id: post.id, status: patch.status, ig: patch.ig ?? null };
}

/* ---------- ANALISA (Instagram Insights) ---------- */
const DAY = 86_400_000;
const safe = async <T>(f: () => Promise<T>): Promise<T | null> => { try { return await f(); } catch { return null; } };

/* metrik akun berupa total untuk rentang waktu (maks 30 hari per panggilan) */
async function accountTotals(cred: Cred, since: number, until: number) {
  const metrics = ["reach", "views", "accounts_engaged", "total_interactions", "likes", "comments", "saves", "shares", "profile_links_taps"];
  const out: Record<string, number> = {};
  for (const m of metrics) {
    let sum = 0, ok = false;
    for (let a = since; a < until; a += 30 * DAY) {
      const b = Math.min(until, a + 30 * DAY);
      const r = await safe(() => ig(cred, `${cred.account_id}/insights`, {
        metric: m, period: "day", metric_type: "total_value",
        since: String(Math.floor(a / 1000)), until: String(Math.floor(b / 1000)) }, "GET"));
      const v = r?.data?.[0]?.total_value?.value;
      if (typeof v === "number") { sum += v; ok = true; }
    }
    if (ok) out[m] = sum;
  }
  return out;
}
/* deret harian (reach & pertambahan follower) */
async function accountSeries(cred: Cred, metric: string, since: number, until: number) {
  const pts: { date: string; value: number }[] = [];
  for (let a = since; a < until; a += 30 * DAY) {
    const b = Math.min(until, a + 30 * DAY);
    const r = await safe(() => ig(cred, `${cred.account_id}/insights`, {
      metric, period: "day", since: String(Math.floor(a / 1000)), until: String(Math.floor(b / 1000)) }, "GET"));
    for (const v of r?.data?.[0]?.values || []) pts.push({ date: String(v.end_time).slice(0, 10), value: Number(v.value) || 0 });
  }
  return pts;
}
/* metrik per posting — jenis media berbeda mendukung metrik berbeda, jadi coba bertahap */
async function mediaInsights(cred: Cred, id: string) {
  const sets = ["reach,saved,shares,views,total_interactions", "reach,saved,shares,total_interactions", "reach,saved"];
  for (const metric of sets) {
    const r = await safe(() => ig(cred, `${id}/insights`, { metric }, "GET"));
    if (r?.data) {
      const o: Record<string, number> = {};
      for (const d of r.data) o[d.name] = Number(d.values?.[0]?.value ?? d.total_value?.value) || 0;
      return o;
    }
  }
  return {};
}

async function insights(days: number, refresh: boolean) {
  days = [7, 30, 90].includes(days) ? days : 30;
  const key = `ig:${days}`;
  if (!refresh) {
    const c = await db(`social_insights_cache?key=eq.${key}&select=data,fetched_at`);
    if (c?.[0] && Date.now() - new Date(c[0].fetched_at).getTime() < 30 * 60_000) return { ...c[0].data, cached: true, fetched_at: c[0].fetched_at };
  }
  const cred = await igCred();
  if (!cred) throw new Error("Instagram belum terhubung (Sosmed → Hubungkan Instagram).");
  const until = Date.now(), since = until - days * DAY;

  const profile = await ig(cred, cred.account_id, { fields: "username,name,followers_count,follows_count,media_count,profile_picture_url" }, "GET");
  const [totals, reachSeries, followerSeries] = await Promise.all([
    accountTotals(cred, since, until),
    accountSeries(cred, "reach", since, until),
    days <= 30 ? accountSeries(cred, "follower_count", since, until) : Promise.resolve([]),
  ]);

  // posting dalam periode (maks 60 terbaru)
  const posts: any[] = [];
  let next: string | null = null, page = 0;
  do {
    const r: any = next
      ? await (await fetch(next)).json()
      : await ig(cred, `${cred.account_id}/media`, { fields: "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count", limit: "30" }, "GET");
    for (const m of r.data || []) {
      if (new Date(m.timestamp).getTime() < since) { next = null; break; }
      posts.push(m);
    }
    next = posts.length < 60 ? (r.paging?.next || null) : null;
  } while (next && ++page < 4);

  const enriched = await Promise.all(posts.map(async (m) => {
    const ins = await mediaInsights(cred, m.id);
    const likes = m.like_count ?? 0, comments = m.comments_count ?? 0;
    const interactions = ins.total_interactions ?? likes + comments + (ins.saved || 0) + (ins.shares || 0);
    const type = m.media_product_type === "REELS" ? "reel" : m.media_type === "CAROUSEL_ALBUM" ? "carousel" : m.media_type === "VIDEO" ? "video" : "photo";
    return {
      id: m.id, type, caption: (m.caption || "").slice(0, 300), permalink: m.permalink, timestamp: m.timestamp,
      thumb: m.thumbnail_url || m.media_url || null,
      likes, comments, saves: ins.saved ?? null, shares: ins.shares ?? null, reach: ins.reach ?? null, views: ins.views ?? null,
      interactions, er: ins.reach ? interactions / ins.reach : null,
    };
  }));

  const data = {
    days, profile: { username: profile.username, name: profile.name, followers: profile.followers_count, follows: profile.follows_count, media: profile.media_count, picture: profile.profile_picture_url },
    totals, reachSeries, followerSeries, posts: enriched,
  };
  await db("social_insights_cache", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ key, data, fetched_at: new Date().toISOString() }) });
  return { ...data, cached: false, fetched_at: new Date().toISOString() };
}

async function tick() {
  const nowIso = new Date().toISOString();
  const due: Post[] = await db(
    `social_posts?select=*&or=(and(status.eq.scheduled,scheduled_at.lte.${nowIso}),status.eq.publishing)&order=scheduled_at.asc&limit=10`,
  );
  if (!due.length) return [];
  const cred = await igCred();
  const out = [];
  for (const p of due) if (await claim(p.id)) out.push(await processPost(p, cred));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const given = req.headers.get("x-cron-secret");
    const fromCron = !!given && given === (await cronSecret());
    if (!fromCron) {
      const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      if (!jwt || !(await isAdmin(jwt))) return json({ error: "Tidak diizinkan" }, 401);
    }

    if (body.action === "tick") return json({ ok: true, processed: await tick() });
    if (fromCron) return json({ error: "Aksi tidak dikenal" }, 400);

    if (body.action === "status") {
      const cred = await igCred();
      if (!cred) return json({ instagram: { connected: false } });
      try {
        const me = await ig(cred, cred.account_id, { fields: "username,profile_picture_url,followers_count" }, "GET");
        let quota = null;
        try {
          const q = await ig(cred, `${cred.account_id}/content_publishing_limit`, { fields: "quota_usage,config" }, "GET");
          quota = { used: q.data?.[0]?.quota_usage ?? null, total: q.data?.[0]?.config?.quota_total ?? null };
        } catch { /* kuota opsional */ }
        return json({ instagram: { connected: true, username: me.username, picture: me.profile_picture_url, followers: me.followers_count, quota } });
      } catch (e) {
        return json({ instagram: { connected: false, error: String((e as Error).message || e) } });
      }
    }

    if (body.action === "insights") return json(await insights(Number(body.days) || 30, !!body.refresh));

    if (body.action === "publish_now" && body.id) {
      const rows: Post[] = await db(`social_posts?id=eq.${encodeURIComponent(body.id)}&select=*`);
      const post = rows[0];
      if (!post) return json({ error: "Posting tidak ditemukan" }, 404);
      if (post.status === "published") return json({ error: "Sudah terbit" }, 400);
      if (!(await claim(post.id))) return json({ error: "Posting ini sedang diproses, tunggu sebentar" }, 409);
      // retry: mulai ulang Instagram dari awal
      const fresh: Post = { ...post, ig: post.ig?.state === "failed" ? {} : post.ig, status: "publishing" };
      await patchPost(post.id, { status: "publishing", ig: fresh.ig, scheduled_at: post.scheduled_at || new Date().toISOString() });
      return json({ ok: true, result: await processPost(fresh, await igCred()) });
    }

    return json({ error: "Aksi tidak dikenal" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
