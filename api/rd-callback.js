// ─── RD MARKETING OAuth2: Step 2 — Exchange code for tokens ──────────────
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
  const code = req.query.code;
  if (!code) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(400).send('<h2>Erro: código de autorização não recebido</h2><a href="/">Voltar</a>');
  }

  const clientId = process.env.RD_MKT_CLIENT_ID || '1e0caaab-8e36-40b6-b0d7-4175403b513d';
  const clientSecret = process.env.RD_MKT_CLIENT_SECRET || 'd16a9e739cc1405da1bc7eb76d97c95c';
  const redirectUri = 'https://psm-os.vercel.app/api/rd-callback';

  try {
    console.log('[RD MKT] Exchanging code for tokens...');
    const resp = await httpsPost('https://api.rd.services/auth/token', {
      client_id: clientId,
      client_secret: clientSecret,
      code: code,
      redirect_uri: redirectUri,
    });

    console.log('[RD MKT] Token response:', resp.status, resp.body.slice(0, 200));
    const tokens = JSON.parse(resp.body);

    if (tokens.access_token) {
      // Redirect to housepsm.com.br with tokens in URL hash (safe — hash is not sent to server)
      const tokenData = encodeURIComponent(JSON.stringify({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
      }));
      // Redirect to main domain — index.html will pick up tokens from hash
      res.writeHead(302, { Location: 'https://www.housepsm.com.br/#rd_mkt_tokens=' + tokenData });
      return res.end();
    } else {
      const errMsg = tokens.errors ? JSON.stringify(tokens.errors) : JSON.stringify(tokens);
      res.setHeader('Content-Type', 'text/html');
      return res.status(200).send(
        '<html><body style="font-family:system-ui;background:#1c1c1c;color:#fff;padding:40px">'
        + '<h1 style="color:#ef4444">❌ Erro na autorização</h1>'
        + '<p>' + errMsg + '</p>'
        + '<a href="https://www.housepsm.com.br" style="color:#d4a843">Voltar ao PSM OS</a>'
        + '</body></html>'
      );
    }
  } catch (err) {
    console.error('[RD MKT] Callback error:', err.message);
    res.setHeader('Content-Type', 'text/html');
    return res.status(500).send(
      '<html><body style="font-family:system-ui;background:#1c1c1c;color:#fff;padding:40px">'
      + '<h1 style="color:#ef4444">❌ Erro</h1>'
      + '<p>' + err.message + '</p>'
      + '<a href="https://www.housepsm.com.br" style="color:#d4a843">Voltar ao PSM OS</a>'
      + '</body></html>'
    );
  }
};
// ─── RD MARKETING OAuth2: Step 2 — Exchange code for tokens ──────────────
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
  const code = req.query.code;
  if (!code) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(400).send('<h2>Erro: código de autorização não recebido</h2><a href="/">Voltar</a>');
  }

  const clientId     = process.env.RD_MKT_CLIENT_ID     || '1e0caaab-8e36-40b6-b0d7-4175403b513d';
  const clientSecret = process.env.RD_MKT_CLIENT_SECRET  || 'd16a9e739cc1405da1bc7eb76d97c95c';
  const redirectUri  = 'https://psm-os.vercel.app/api/rd-callback';

  try {
    console.log('[RD MKT] Exchanging code for tokens...');
    const resp = await httpsPost('https://api.rd.services/auth/token', {
      client_id: clientId,
      client_secret: clientSecret,
      code: code,
    });

    console.log('[RD MKT] Token response:', resp.status, resp.body.slice(0, 200));
    const tokens = JSON.parse(resp.body);

    if (tokens.access_token) {
      // Redirect to housepsm.com.br with tokens in URL hash (safe — hash is not sent to server)
      const tokenData = encodeURIComponent(JSON.stringify({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
      }));
      // Redirect to main domain — index.html will pick up tokens from hash
      res.writeHead(302, { Location: 'https://www.housepsm.com.br/#rd_mkt_tokens=' + tokenData });
      return res.end();
    } else {
      const errMsg = tokens.errors ? JSON.stringify(tokens.errors) : JSON.stringify(tokens);
      res.setHeader('Content-Type', 'text/html');
      return res.status(200).send(
        '<html><body style="font-family:system-ui;background:#1c1c1c;color:#fff;padding:40px">'
        + '<h1 style="color:#ef4444">❌ Erro na autorização</h1>'
        + '<p>' + errMsg + '</p>'
        + '<a href="https://www.housepsm.com.br" style="color:#d4a843">Voltar ao PSM OS</a>'
        + '</body></html>'
      );
    }
  } catch (err) {
    console.error('[RD MKT] Callback error:', err.message);
    res.setHeader('Content-Type', 'text/html');
    return res.status(500).send(
      '<html><body style="font-family:system-ui;background:#1c1c1c;color:#fff;padding:40px">'
      + '<h1 style="color:#ef4444">❌ Erro</h1>'
      + '<p>' + err.message + '</p>'
      + '<a href="https://www.housepsm.com.br" style="color:#d4a843">Voltar ao PSM OS</a>'
      + '</body></html>'
    );
  }
};
