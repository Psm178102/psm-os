// ─── RD STATION PROXY (Vercel Serverless Function) ──────────────────────────
// Rota: /api/rd?path=/deals&service=crm
// Token: env var RD_CRM_TOKEN / RD_MKT_TOKEN (permanente, nunca expira)
// Backup: header X-RD-Token do frontend

const https = require('https');

function httpsReq(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: opts.method || 'GET',
      headers: opts.headers || {},
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-RD-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    const path = req.query.path || '/deals';
    const service = req.query.service || 'crm';
    const headerToken = req.headers['x-rd-token'] || '';

    // Build forward params (exclude internal ones)
    const forwardParams = new URLSearchParams();
    Object.entries(req.query).forEach(([k, v]) => {
      if (k !== 'path' && k !== 'service' && v !== undefined) {
        forwardParams.set(k, v);
      }
    });

    let url, tokenSource;

    if (service === 'mkt') {
      // MKT: header token (OAuth) tem prioridade, env var como fallback
      const token = headerToken || process.env.RD_MKT_TOKEN || '';
      tokenSource = headerToken ? 'header' : (process.env.RD_MKT_TOKEN ? 'env' : 'none');
      if (!token) {
        return res.status(401).json({
          error: 'Token RD Marketing nao configurado',
          hint: 'Conecte via OAuth em Configuracoes > Conectores, ou configure RD_MKT_TOKEN no Vercel.',
        });
      }
      const qs = forwardParams.toString();
      url = 'https://api.rd.services' + path + (qs ? '?' + qs : '');
      req._mktBearerToken = token;
    } else {
      // CRM: env var tem PRIORIDADE (token permanente), header como fallback
      const token = process.env.RD_CRM_TOKEN || headerToken || '';
      tokenSource = process.env.RD_CRM_TOKEN ? 'env' : (headerToken ? 'header' : 'none');
      if (!token) {
        return res.status(401).json({
          error: 'Token RD CRM nao configurado',
          hint: 'Configure RD_CRM_TOKEN nas Environment Variables do Vercel.',
        });
      }
      forwardParams.set('token', token);
      url = 'https://crm.rdstation.com/api/v1' + path + '?' + forwardParams.toString();
    }

    const safeUrl = url.replace(/token=[^&]+/g, 'token=***');
    console.log('[RD Proxy] ' + req.method + ' ' + service + path + ' (via ' + tokenSource + ') -> ' + safeUrl);

    const fetchHeaders = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (service === 'mkt' && req._mktBearerToken) {
      fetchHeaders['Authorization'] = 'Bearer ' + req._mktBearerToken;
    }
    const fetchOpts = {
      method: req.method || 'GET',
      headers: fetchHeaders,
    };
    if (req.body && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
      fetchOpts.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const resp = await httpsReq(url, fetchOpts);

    console.log('[RD Proxy] Response: ' + resp.status + ' (' + resp.body.length + ' bytes) via ' + tokenSource);

    res.setHeader('X-Token-Source', tokenSource);
    res.setHeader('Content-Type', 'application/json');
    return res.status(resp.status).send(resp.body);

  } catch (err) {
    console.error('[RD Proxy] Exception:', err.message);
    return res.status(500).json({
      error: 'Erro no proxy RD: ' + err.message,
      hint: 'Verifique se o token esta correto e o RD Station esta acessivel.',
    });
  }
};
