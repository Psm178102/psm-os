// ─── RD MARKETING OAuth2: Refresh Token ──────────────────────────────────────
const https = require('https');

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let result = '';
      res.on('data', chunk => result += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: result }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const refreshToken = body.refresh_token;

    if (!refreshToken) return res.status(400).json({ error: 'refresh_token required' });

    const clientId = process.env.RD_MKT_CLIENT_ID || '1e0caaab-8e36-40b6-b0d7-4175403b513d';
    const clientSecret = process.env.RD_MKT_CLIENT_SECRET || 'd16a9e739cc1405da1bc7eb76d97c95c';

    const resp = await httpsPost('https://api.rd.services/auth/token', {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    });

    const tokens = JSON.parse(resp.body);
    console.log('[RD MKT] Refresh response:', resp.status);

    return res.status(resp.status >= 400 ? 400 : 200).json(tokens);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
