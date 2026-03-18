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

    const forwardParams = new URLSearchParams();
    Object.entries(req.query).forEach(([k, v]) => {
      if (k !== 'path' && k !== 'service' && v !== undefined) {
        forwardParams.set(k, v);
      }
    });

    let url, tokenSource;

    if (service === 'mkt') {
      const token = headerToken || process.env.RD_MKT_TOKEN || '';
      tokenSource = headerToken ? 'header' : (process.env.RD_MKT_TOKEN ? 'env' : 'none');
      if (!token) {
        return res.status(401).json({ error: 'Token RD Marketing nao configurado' });
      }
      forwardParams.set('auth_token', token);
      url = 'https://api.rdstation.com/2.0' + path + '?' + forwardParams.toString();
    } else {
      const token = headerToken || process.env.RD_CRM_TOKEN || '';
      tokenSource = headerToken ? 'header' : (process.env.RD_CRM_TOKEN ? 'env' : 'none');
      if (!token) {
        return res.status(401).json({ error: 'Token RD CRM nao configurado' });
      }
      forwardParams.set('token', token);
      url = 'https://crm.rdstation.com/api/v1' + path + '?' + forwardParams.toString();
    }

    console.log('[RD Proxy]', req.method, service, path, 'via', tokenSource);

    const fetchOpts = {
      method: req.method || 'GET',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    };
    if (req.body && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
      fetchOpts.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const resp = await httpsReq(url, fetchOpts);

    res.setHeader('X-Token-Source', tokenSource);
    res.setHeader('Content-Type', 'application/json');
    return res.status(resp.status).send(resp.body);

  } catch (err) {
    console.error('[RD Proxy] Error:', err.message);
    return res.status(500).json({ error: 'Erro no proxy RD: ' + err.message });
  }
};
