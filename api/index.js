import crypto from 'node:crypto';
const env = k => (process.env[k] || '').trim();
const U = env('SUPABASE_URL').replace(/\/+$/, '').replace(/\/(rest|storage)\/v1$/, '');
const K = env('SUPABASE_SERVICE_KEY'), S = env('JWT_SECRET'), AP = env('ADMIN_PASSWORD');
const BUCKET = 'store';
const PUB = `${U}/storage/v1/object/public/${BUCKET}/`;
const H = { apikey: K, Authorization: 'Bearer ' + K };
const q = encodeURIComponent;
const SKEYS = { site_name: 60, hero_title: 120, hero_subtitle: 240, hero_cta: 30, footer_text: 200, whatsapp: 15, hero_image: 'img', logo_url: 'img' };

async function sb(path, { method = 'GET', body, prefer = 'return=representation' } = {}) {
  const r = await fetch(U + '/rest/v1/' + path, {
    method, headers: { ...H, 'Content-Type': 'application/json', Prefer: prefer },
    body: body ? JSON.stringify(body) : undefined
  });
  const t = await r.text(); if (!r.ok) throw new Error(t);
  return t ? JSON.parse(t) : [];
}
const mac = d => crypto.createHmac('sha256', S).update(d).digest('base64url');
const sign = p => { const d = Buffer.from(JSON.stringify(p)).toString('base64url'); return d + '.' + mac(d); };
function verify(t) {
  if (!t || !t.includes('.')) return null;
  const [d, s] = t.split('.'); const e = mac(d);
  if (e.length !== s.length || !crypto.timingSafeEqual(Buffer.from(e), Buffer.from(s))) return null;
  try { const p = JSON.parse(Buffer.from(d, 'base64url')); return p.exp > Date.now() ? p : null; } catch { return null; }
}
const okImgUrl = v => v === '' || (typeof v === 'string' && v.startsWith(PUB) && v.length < 500);

export default async function handler(req, res) {
  const out = (c, o) => res.status(c).json(o);
  let isAdmin = false;
  res.setHeader('Cache-Control', 'no-store');
  try {
    const a = req.query.a, b = req.body || {};

    // SETUP SELF-CHECK (/check.html)
    if (a === 'health') {
      const checks = [], add = (name, ok, msg) => checks.push({ name, ok, msg });
      const urlOk = /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(U);
      add('SUPABASE_URL', urlOk, U ? (urlOk ? 'Sahi hai' : 'Format galat. https://xxxx.supabase.co jaisa hona chahiye') : 'Vercel me add nahi hua');
      let keyOk = !!K, keyMsg = K ? 'Mil gayi' : 'Vercel me add nahi hui';
      if (K.startsWith('sb_publishable')) { keyOk = false; keyMsg = 'Ye publishable key hai. Secret key (sb_secret_...) lagao'; }
      else if (K.startsWith('eyJ')) { try { const role = JSON.parse(Buffer.from(K.split('.')[1], 'base64url')).role; if (role !== 'service_role') { keyOk = false; keyMsg = 'Ye ' + role + ' key hai. service_role / Secret key lagao'; } } catch {} }
      add('SUPABASE_SERVICE_KEY', keyOk, keyMsg);
      add('JWT_SECRET', !!S, S ? 'Sahi hai' : 'Vercel me add nahi hua');
      add('ADMIN_PASSWORD', !!AP, AP ? 'Sahi hai' : 'Vercel me add nahi hua');
      if (U && K) {
        try { await sb('products?select=id&limit=1'); add('Table: products', true, 'Bani hui hai'); }
        catch (e) { add('Table: products', false, 'Nahi mili / key galat: ' + String(e.message).slice(0, 140) + ' -> schema.sql run karo'); }
        try { await sb('settings?select=key&limit=1'); add('Table: settings', true, 'Bani hui hai'); }
        catch (e) { add('Table: settings', false, 'Nahi mili -> schema.sql run karo'); }
        try { const r = await fetch(`${U}/storage/v1/bucket/${BUCKET}`, { headers: H }); const j = r.ok ? await r.json() : {}; add('Bucket: store (public)', r.ok && j.public === true, r.ok ? (j.public ? 'Bana hua hai' : 'Bucket private hai -> schema.sql dobara run karo') : 'Nahi mila -> schema.sql run karo'); }
        catch (e) { add('Bucket: store (public)', false, 'Check nahi ho paya'); }
      }
      return out(200, { ok: checks.every(c => c.ok), checks });
    }
    if (!U || !K || !S || !AP) return out(500, { error: 'Server env variables set nahi hain' });

    // PUBLIC: storefront data
    if (a === 'store') {
      const rows = await sb('settings?select=key,value');
      const settings = {}; rows.forEach(r => { settings[r.key] = r.value; });
      const products = await sb('products?select=*&order=created_at.desc');
      return out(200, { settings, products });
    }

    // ADMIN LOGIN
    if (a === 'login') {
      const x = Buffer.from(String(b.password || '').trim()), y = Buffer.from(AP);
      if (x.length !== y.length || !crypto.timingSafeEqual(x, y)) return out(401, { error: 'Galat password' });
      return out(200, { token: sign({ role: 'admin', exp: Date.now() + 7 * 864e5 }) });
    }
    const p = verify((req.headers.authorization || '').replace('Bearer ', ''));
    if (!p || p.role !== 'admin') return out(401, { error: 'Admin login karo' });
    isAdmin = true;

    if (a === 'upload') {
      if (!['logo', 'hero', 'product'].includes(b.kind)) return out(400, { error: 'bad kind' });
      const buf = Buffer.from(String(b.data || ''), 'base64');
      if (buf.length < 500 || buf.length > 3.5e6) return out(400, { error: 'Image sahi nahi hai ya bahut badi hai' });
      const jpg = buf[0] === 0xff && buf[1] === 0xd8, png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
      const webp = buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
      if (!jpg && !png && !webp) return out(400, { error: 'Sirf JPG / PNG / WEBP image chalegi' });
      const ext = jpg ? 'jpg' : png ? 'png' : 'webp', ct = jpg ? 'image/jpeg' : png ? 'image/png' : 'image/webp';
      const path = `${b.kind}/${Date.now()}-${crypto.randomBytes(5).toString('hex')}.${ext}`;
      const up = await fetch(`${U}/storage/v1/object/${BUCKET}/${path}`, { method: 'POST', headers: { ...H, 'Content-Type': ct, 'x-upsert': 'false' }, body: buf });
      if (!up.ok) return out(500, { error: 'Image save nahi hui (bucket "store" check karo)' });
      return out(200, { url: PUB + path });
    }

    if (a === 'savesettings') {
      const rows = [];
      for (const [k, v0] of Object.entries(b.settings || {})) {
        if (!(k in SKEYS)) continue;
        let v = String(v0 ?? '').trim();
        if (SKEYS[k] === 'img') { if (!okImgUrl(v)) return out(400, { error: k + ' galat hai' }); }
        else { if (k === 'whatsapp') v = v.replace(/\D/g, ''); if (v.length > SKEYS[k]) return out(400, { error: k + ' bahut lamba hai' }); }
        if (k === 'site_name' && !v) return out(400, { error: 'Website ka naam khali nahi ho sakta' });
        rows.push({ key: k, value: v });
      }
      if (rows.length) await sb('settings?on_conflict=key', { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=minimal' });
      return out(200, { ok: true });
    }

    if (a === 'saveproduct') {
      const name = String(b.name || '').trim(), price = Number(b.price);
      const mrp = b.mrp === '' || b.mrp == null ? null : Number(b.mrp);
      if (!name || name.length > 120) return out(400, { error: 'Product ka naam likho (max 120 letters)' });
      if (!Number.isFinite(price) || price < 0 || price > 1e8) return out(400, { error: 'Price sahi likho' });
      if (mrp !== null && (!Number.isFinite(mrp) || mrp < 0 || mrp > 1e8)) return out(400, { error: 'MRP sahi likho' });
      const image_url = String(b.image_url || '');
      if (!okImgUrl(image_url)) return out(400, { error: 'Image galat hai' });
      const row = { name, price, mrp, description: String(b.description || '').slice(0, 2000), category: String(b.category || '').trim().slice(0, 40), image_url, in_stock: b.in_stock !== false };
      if (b.id) await sb(`products?id=eq.${q(b.id)}`, { method: 'PATCH', body: row });
      else await sb('products', { method: 'POST', body: row });
      return out(200, { ok: true });
    }

    if (a === 'delproduct') {
      const r = (await sb(`products?id=eq.${q(b.id)}&select=image_url`))[0];
      if (r && r.image_url && r.image_url.startsWith(PUB)) { try { await fetch(`${U}/storage/v1/object/${BUCKET}/${r.image_url.slice(PUB.length)}`, { method: 'DELETE', headers: H }); } catch {} }
      await sb(`products?id=eq.${q(b.id)}`, { method: 'DELETE' });
      return out(200, { ok: true });
    }
    return out(404, { error: 'Unknown action' });
  } catch (e) { return out(500, { error: isAdmin ? 'Server error: ' + String(e.message).slice(0, 220) : 'Server error' }); }
}
