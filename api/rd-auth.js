// ─── RD MARKETING OAuth2: Step 1 — Redirect to RD for authorization ─────────
module.exports = async (req, res) => {
  // Aceita client_id e client_secret via query params (enviados pelo frontend)
  const clientId = req.query.client_id || process.env.RD_MKT_CLIENT_ID || '1e0caaab-8e36-40b6-b0d7-4175403b513d';
  const clientSecret = req.query.client_secret || process.env.RD_MKT_CLIENT_SECRET || 'd16a9e739cc1405da1bc7eb76d97c95c';
  const redirectUri = 'https://psm-os.vercel.app/api/rd-callback';

  // Passa client_id e client_secret no state param (base64) para o callback poder usar
  const stateData = Buffer.from(JSON.stringify({ client_id: clientId, client_secret: clientSecret })).toString('base64');

  const authUrl = 'https://api.rd.services/auth/dialog'
    + '?client_id=' + clientId
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&state=' + encodeURIComponent(stateData);

  res.writeHead(302, { Location: authUrl });
  res.end();
};
// ─── RD MARKETING OAuth2: Step 1 — Redirect to RD for authorization ─────────
module.exports = async (req, res) => {
  const clientId = process.env.RD_MKT_CLIENT_ID || '1e0caaab-8e36-40b6-b0d7-4175403b513d';
  const redirectUri = 'https://psm-os.vercel.app/api/rd-callback';

  const authUrl = 'https://api.rd.services/auth/dialog'
    + '?client_id=' + clientId
    + '&redirect_uri=' + encodeURIComponent(redirectUri);

  res.writeHead(302, { Location: authUrl });
  res.end();
};
