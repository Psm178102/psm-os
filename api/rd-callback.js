// ─── RD MARKETING OAuth2: Step 2 — Exchange code for tokens ──────────────────
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
    });

    console.log('[RD MKT] Token response:', resp.status, resp.body.slice(0, 200));
    const tokens = JSON.parse(resp.body);

    if (tokens.access_token) {
      // Success! Redirect back to PSM OS with tokens in hash (safe, not in URL params)
      const tokenData = encodeURIComponent(JSON.stringify({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
        created_at: Date.now(),
      }));

      res.setHeader('Content-Type', 'text/html');
      return res.status(200).send(
        '<!DOCTYPE html><html><head><title>RD Marketing — Autorizado!</title></head><body style="font-family:system-ui;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">'
        + '<div style="text-align:center;max-width:500px">'
        + '<div style="font-size:48px;margin-bottom:16px">✅</div>'
        + '<h1 style="color:#d4a843;margin-bottom:12px">RD Marketing Conectado!</h1>'
        + '<p style="color:#94a3b8;margin-bottom:24px">Tokens recebidos com sucesso. O sistema vai salvar automaticamente.</p>'
        + '<p style="color:#64748b;font-size:12px">Fechando em 3 segundos...</p>'
        + '</div>'
        + '<scr' + 'ipt>'
        + 'try{'
        + 'var t=' + JSON.stringify(tokens) + ';'
        + 'if(window.opener&&window.opener.S){'
        + 'window.opener.S.connectors=window.opener.S.connectors||{};'
        + 'window.opener.S.connectors.rd_mkt_access_token=t.access_token;'
        + 'window.opener.S.connectors.rd_mkt_refresh_token=t.refresh_token;'
        + 'window.opener.S.connectors.rd_mkt_token_expires=Date.now()+(t.expires_in||86400)*1000;'
        + 'window.opener.saveState();'
        + 'window.opener.toast("✅ RD Marketing conectado com sucesso!","ok");'
        + 'window.opener.render();'
        + '}'
        + '}catch(e){console.error(e);}'
        + 'setTimeout(function(){window.close()},3000);'
        + '</scr' + 'ipt>'
        + '</body></html>'
      );
    } else {
      // Error from RD
      const errMsg = tokens.errors ? JSON.stringify(tokens.errors) : JSON.stringify(tokens);
      res.setHeader('Content-Type', 'text/html');
      return res.status(200).send(
        '<html><body style="font-family:system-ui;background:#1c1c1c;color:#fff;padding:40px">'
        + '<h1 style="color:#ef4444">❌ Erro na autorização</h1>'
        + '<p>' + errMsg + '</p>'
        + '<a href="/" style="color:#d4a843">Voltar ao PSM OS</a>'
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
      + '<a href="/" style="color:#d4a843">Voltar ao PSM OS</a>'
      + '</body></html>'
    );
  }
};
