// ─── RD MARKETING OAuth2: Step 1 — Redirect to RD for authorization ─────────

// Formata string hex 32 chars como UUID (8-4-4-4-12)
function toUUID(s) {
  s = s.replace(/[^a-fA-F0-9]/g, '');
  if (s.length === 32) return s.slice(0,8)+'-'+s.slice(8,12)+'-'+s.slice(12,16)+'-'+s.slice(16,20)+'-'+s.slice(20);
  return s; // ja tem hifens ou formato diferente
}

module.exports = async (req, res) => {
  const rawId = req.query.client_id || process.env.RD_MKT_CLIENT_ID || '1e0caaab-8e36-40b6-b0d7-4175403b513d';
  const clientId = toUUID(rawId);
  const clientSecret = req.query.client_secret || process.env.RD_MKT_CLIENT_SECRET || 'd16a9e739cc1405da1bc7eb76d97c95c';
  const redirectUri = 'https://psm-os.vercel.app/api/rd-callback';

  const stateData = Buffer.from(JSON.stringify({ client_id: clientId, client_secret: clientSecret })).toString('base64');

  const authUrl = 'https://api.rd.services/auth/dialog'
    + '?client_id=' + clientId
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&state=' + encodeURIComponent(stateData);

  res.writeHead(302, { Location: authUrl });
  res.end();
};
