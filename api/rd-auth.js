// ─── RD MARKETING OAuth2: Step 1 — Redirect to RD for authorization ─────────
module.exports = async (req, res) => {
  const clientId = process.env.RD_MKT_CLIENT_ID || '1e0caaab-8e36-40b6-b0d7-4175403b513d';
  const redirectUri = 'https://www.housepsm.com.br/api/rd-callback';

  const authUrl = 'https://api.rd.services/auth/dialog'
    + '?client_id=' + clientId
    + '&redirect_uri=' + encodeURIComponent(redirectUri);

  res.writeHead(302, { Location: authUrl });
  res.end();
};
