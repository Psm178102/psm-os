// ─── RD MARKETING · tokens no shared_kv (server-side) — v87.9 ────────────────
// O OAuth do RD Marketing guarda access/refresh token na shared_kv (Supabase,
// service key) em vez de despejar no fragment da URL do navegador (v<87.9
// mandava #rd_mkt_tokens=... pro front, que não tratava e dava 404 — e o token
// vazava pra barra de endereço/histórico). Helpers usados por rd-callback.js,
// rd-refresh.js e rd.js.

const https = require('https');

const KV_KEY = 'rd_mkt_tokens';

function httpsJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_KEY || '';
  return {
    'apikey': key,
    'Authorization': 'Bearer ' + key,
    'Content-Type': 'application/json',
  };
}

async function kvGetTokens() {
  const base = process.env.SUPABASE_URL;
  if (!base || !process.env.SUPABASE_SERVICE_KEY) return null;
  try {
    const r = await httpsJson(base + '/rest/v1/shared_kv?key=eq.' + KV_KEY + '&select=value', { headers: sbHeaders() });
    const rows = JSON.parse(r.body || '[]');
    const v = rows[0] && rows[0].value;
    return (v && typeof v === 'object') ? v : null;
  } catch (e) {
    console.error('[RD KV] get fail:', e.message);
    return null;
  }
}

async function kvSetTokens(tokens) {
  const base = process.env.SUPABASE_URL;
  if (!base || !process.env.SUPABASE_SERVICE_KEY) return false;
  const value = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: tokens.expires_in || 86400,
    obtained_at: new Date().toISOString(),
  };
  try {
    const r = await httpsJson(base + '/rest/v1/shared_kv?on_conflict=key', {
      method: 'POST',
      headers: { ...sbHeaders(), 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify([{ key: KV_KEY, value }]),
    });
    return r.status < 300;
  } catch (e) {
    console.error('[RD KV] set fail:', e.message);
    return false;
  }
}

function isExpired(tokens, marginS = 120) {
  try {
    const t0 = new Date(tokens.obtained_at).getTime();
    return Date.now() > t0 + ((tokens.expires_in || 86400) - marginS) * 1000;
  } catch (_) {
    return true;
  }
}

// Refresh na API do RD e persiste de volta. Retorna tokens novos ou null.
async function refreshAndSave(refreshToken) {
  const clientId = process.env.RD_MKT_CLIENT_ID || '';
  const clientSecret = process.env.RD_MKT_CLIENT_SECRET || '';
  if (!clientId || !clientSecret || !refreshToken) return null;
  try {
    const r = await httpsJson('https://api.rd.services/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }),
    });
    const tokens = JSON.parse(r.body || '{}');
    if (!tokens.access_token) return null;
    await kvSetTokens(tokens);
    return tokens;
  } catch (e) {
    console.error('[RD KV] refresh fail:', e.message);
    return null;
  }
}

// Access token válido pro RD Marketing: lê da kv, auto-refresh se venceu.
async function getValidAccessToken() {
  let tokens = await kvGetTokens();
  if (!tokens || !tokens.access_token) return null;
  if (isExpired(tokens)) {
    const renewed = await refreshAndSave(tokens.refresh_token);
    if (!renewed) return null;
    tokens = renewed;
  }
  return tokens.access_token;
}

module.exports = { kvGetTokens, kvSetTokens, isExpired, refreshAndSave, getValidAccessToken };
