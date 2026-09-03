// ─── RD MARKETING OAuth2: Step 1 — Redirect to RD for authorization ─────────
// v87.7: credenciais SÓ via env (RD_MKT_CLIENT_ID). O segredo NUNCA entra aqui:
// o passo de autorização do OAuth não usa client_secret, e o antigo hábito de
// carregá-lo dentro do `state` (base64 na URL, passando pelo navegador) foi
// removido — o rd-callback lê o secret direto da env dele.

// Formata string hex 32 chars como UUID (8-4-4-4-12)
function toUUID(s) {
  s = s.replace(/[^a-fA-F0-9]/g, '');
  if (s.length === 32) return s.slice(0, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16) + '-' + s.slice(16, 20) + '-' + s.slice(20);
  return s; // ja tem hifens ou formato diferente
}

module.exports = async (req, res) => {
  const rawId = process.env.RD_MKT_CLIENT_ID || '';
  if (!rawId) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(503).send(
      '<html><body style="font-family:system-ui;background:#1c1c1c;color:#fff;padding:40px">'
      + '<h1 style="color:#ef4444">RD Marketing não configurado</h1>'
      + '<p>Falta a variável de ambiente <code>RD_MKT_CLIENT_ID</code> no Vercel '
      + '(e <code>RD_MKT_CLIENT_SECRET</code> pro callback). Cadastre as duas e tente de novo.</p>'
      + '<a href="https://www.housepsm.com.br" style="color:#d4a843">Voltar ao House PSM</a>'
      + '</body></html>'
    );
  }
  const clientId = toUUID(rawId);
  const redirectUri = process.env.RD_MKT_REDIRECT || 'https://psm-os.vercel.app/api/rd-callback';

  const authUrl = 'https://api.rd.services/auth/dialog'
    + '?client_id=' + clientId
    + '&redirect_uri=' + encodeURIComponent(redirectUri);

  res.writeHead(302, { Location: authUrl });
  res.end();
};
