// =====================================================================
// WA BRIDGE — penerima data dari program "Kalaatma WA" (whatsmeow) yang
// berjalan di laptop admin. Program menyambung ke WhatsApp sebagai perangkat
// tertaut (seperti WhatsApp Web); chat dari nomor baru menjadi Lead.
//
// Semua permintaan memakai header x-bridge-secret (tabel wa_bridge_secret,
// hanya bisa dibaca service role). Body:
//   {type:'heartbeat', status, phone?, push_name?, device?, version?}
//        → {command: 'pair' | 'logout' | null}   (perintah dari web admin)
//   {type:'qr', qr}                    QR (PNG data URL) untuk discan di web admin
//   {type:'message', jid, lid?, phone?, name?, text?, ts}
//        → {action: 'created' | 'updated' | 'skipped'}
// Saat laptop mati, WhatsApp menyimpan pesan untuk perangkat tertaut dan
// mengirimkannya ketika program tersambung lagi — ts memakai waktu asli chat.
// =====================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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
const patchBridge = (patch: Record<string, unknown>) =>
  db("wa_bridge?id=eq.1", { method: "PATCH", body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) });

let secretCache = "";
async function authorized(req: Request) {
  const got = req.headers.get("x-bridge-secret") || "";
  if (!got) return false;
  if (!secretCache) secretCache = (await db("wa_bridge_secret?id=eq.1&select=secret"))?.[0]?.secret || "";
  if (!secretCache || got.length !== secretCache.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ secretCache.charCodeAt(i);
  return diff === 0;
}

/* nomor → 62…, dan 9 digit terakhir untuk mencocokkan format 08… / +62… / 62… */
const normPhone = (v: unknown) => {
  let d = String(v || "").replace(/\D/g, "");
  if (d.startsWith("0")) d = "62" + d.slice(1);
  return d;
};
const tail = (p: string) => p.slice(-9);
const q = (v: string) => encodeURIComponent(`"${v.replace(/"/g, "")}"`);

const fmtWIB = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

async function onMessage(m: { jid?: string; lid?: string; phone?: string; name?: string; text?: string; ts?: string }) {
  const jid = String(m.jid || "").slice(0, 80), lid = String(m.lid || "").slice(0, 80);
  if (!jid) return { action: "skipped", reason: "no-jid" };
  const phone = normPhone(m.phone);
  const ts = m.ts && !isNaN(Date.parse(m.ts)) ? new Date(m.ts).toISOString() : new Date().toISOString();
  const bridge = (await db("wa_bridge?id=eq.1&select=phone,last_message_at"))?.[0] || {};
  const touchBridge = (extra: Record<string, unknown> = {}) =>
    patchBridge({ last_message_at: !bridge.last_message_at || bridge.last_message_at < ts ? ts : bridge.last_message_at, ...extra });

  if (phone && bridge.phone && tail(phone) === tail(normPhone(bridge.phone))) return { action: "skipped", reason: "self" };

  // sudah jadi lead → perbarui kontak terakhir saja
  const ors = [`wa_jid.eq.${q(jid)}`];
  if (lid && lid !== jid) ors.push(`wa_jid.eq.${q(lid)}`);
  if (phone.length >= 9) ors.push(`whatsapp.ilike.${q("*" + tail(phone))}`);
  const found = await db(`leads?or=(${ors.join(",")})&select=id,wa_jid,whatsapp,last_contact_at&order=created_at.asc&limit=1`);
  if (found?.length) {
    const l = found[0], patch: Record<string, unknown> = {};
    if (!l.last_contact_at || l.last_contact_at < ts) patch.last_contact_at = ts;
    // lead yang dulu tercatat dengan ID tersembunyi (LID) → lengkapi nomornya begitu diketahui
    if (!l.wa_jid || (l.wa_jid !== jid && l.wa_jid === lid)) patch.wa_jid = jid;
    if (!l.whatsapp && phone) patch.whatsapp = phone;
    if (Object.keys(patch).length) await db(`leads?id=eq.${l.id}`, { method: "PATCH", body: JSON.stringify(patch) }).catch(() => {});
    await touchBridge();
    return { action: "updated" };
  }

  // sudah jadi client (booking) atau freelancer → bukan lead baru
  if (phone.length >= 9) {
    const t = q("*" + tail(phone));
    const [bk, fl] = await Promise.all([
      db(`bookings?whatsapp=ilike.${t}&select=id&limit=1`),
      db(`freelancers?whatsapp=ilike.${t}&select=id&limit=1`),
    ]);
    if (bk?.length || fl?.length) { await touchBridge(); return { action: "skipped", reason: bk?.length ? "client" : "freelancer" }; }
  }

  const name = String(m.name || "").trim().slice(0, 80) || (phone ? "+" + phone : "Kontak WhatsApp");
  const text = String(m.text || "").replace(/\s+/g, " ").trim();
  const notes = [`Chat pertama ${fmtWIB(ts)}${text ? `: "${text.length > 300 ? text.slice(0, 300) + "…" : text}"` : ""}`,
    phone ? "" : "Nomor disembunyikan WhatsApp — balas lewat chat di HP."].filter(Boolean).join("\n");
  try {
    await db("leads", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({
      name, whatsapp: phone || null, source: "WhatsApp", status: "COLD", notes, wa_jid: jid, last_contact_at: ts, created_at: ts,
    }) });
  } catch (e) {
    // dua pesan bersamaan dari nomor yang sama → indeks unik wa_jid menolak salah satunya
    if (String(e).includes("leads_wa_jid_key")) { await touchBridge(); return { action: "updated" }; }
    throw e;
  }
  const cur = (await db("wa_bridge?id=eq.1&select=leads_created"))?.[0]?.leads_created || 0;
  await touchBridge({ leads_created: cur + 1 });
  return { action: "created" };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    if (!(await authorized(req))) return json({ error: "Unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    const now = new Date().toISOString();

    if (body.type === "heartbeat") {
      const row = (await db("wa_bridge?id=eq.1&select=command,command_at"))?.[0] || {};
      // perintah dari web admin berlaku 10 menit
      const fresh = row.command && row.command_at && Date.now() - Date.parse(row.command_at) < 600_000;
      const st = String(body.status || "offline").slice(0, 20);
      const patch: Record<string, unknown> = { status: st, last_seen: now, device: body.device ?? null, version: body.version ?? null };
      if (st === "connected") Object.assign(patch, { qr: null, qr_at: null, phone: body.phone || null, push_name: body.push_name || null });
      if (st === "logged_out" || st === "qr_expired") Object.assign(patch, { qr: null, qr_at: null });
      if (row.command) Object.assign(patch, { command: null, command_at: null });
      await patchBridge(patch);
      return json({ command: fresh ? row.command : null });
    }
    if (body.type === "qr") {
      const qr = String(body.qr || "");
      if (!qr.startsWith("data:image/png;base64,") || qr.length > 200_000) return json({ error: "QR tidak valid" }, 400);
      await patchBridge({ status: "qr", qr, qr_at: now, last_seen: now });
      return json({ ok: true });
    }
    if (body.type === "message") return json(await onMessage(body));
    return json({ error: "type tidak dikenal" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
