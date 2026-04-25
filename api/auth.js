// api/auth.js — Sprint 0 stub (2026-04-25)
//
// CONTEXTO: index.html chama POST /api/auth para login server-side.
// Como nao temos auth server-side implementado ainda (Sprint 1+),
// retornamos 502 SEM JSON valido para forcar o catch do client-side
// e cair no fallback _localLogin (que valida contra localStorage psm_senhas).
//
// Antes desse stub: 404 da Vercel retornava HTML, .json() throwava,
// catch fazia fallback. Funcionava por acidente. Esse arquivo torna
// o comportamento intencional e documentado.
//
// Sprint 1 vai reimplementar este endpoint usando Supabase Auth real.

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Content-Type', 'text/plain');
    return res.status(405).end('Method Not Allowed');
  }

  // Forca o catch do client-side respondendo nao-JSON com 502.
  // O index.html ja tem fallback _localLogin nesse caminho.
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('X-PSM-Auth-Stub', 'sprint-0-fallback-local');
  return res.status(502).end('AUTH_NOT_IMPLEMENTED_USE_LOCAL_FALLBACK');
};
