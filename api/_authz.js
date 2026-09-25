// api/_authz.js — Helper interno (prefixo _ não vira endpoint Vercel)
// v88.45 — trava única dos endpoints legados em api/*.js.
// Achado da vistoria de 24/09: ai-analysis e agent aceitavam qualquer pessoa na
// internet (CORS *, sem login) e gastavam os créditos de IA.
//
//   isInternal(req)      → Authorization: Bearer <CRON_SECRET> (chamadas servidor→servidor)
//   userFromJwt(req)     → claims do JWT do House (HS256/JWT_SECRET/JWT_ISSUER, mesmo do v3) ou null
//   authorize(req, lvl)  → true se interno OU usuário logado com lvl >= lvl
const crypto = require('crypto');

function bearer(req) {
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  return String(h).replace(/^Bearer\s+/i, '').trim();
}

function safeEq(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch (_) { return false; }
}

function isInternal(req) {
  return safeEq(bearer(req), (process.env.CRON_SECRET || '').trim());
}

function b64urlJson(s) {
  return JSON.parse(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

function userFromJwt(req) {
  const secret = process.env.JWT_SECRET || '';
  if (secret.length < 32) return null;
  const parts = bearer(req).split('.');
  if (parts.length !== 3) return null;
  try {
    const head = b64urlJson(parts[0]);
    if (head.alg !== 'HS256') return null;
    const sig = crypto.createHmac('sha256', secret).update(parts[0] + '.' + parts[1]).digest('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (!safeEq(sig, parts[2])) return null;
    const c = b64urlJson(parts[1]);
    const now = Math.floor(Date.now() / 1000);
    if (!c.sub || !c.exp || c.exp < now) return null;
    if (c.iss !== (process.env.JWT_ISSUER || 'psm-os')) return null;
    return c;
  } catch (_) { return null; }
}

function authorize(req, minLvl) {
  if (isInternal(req)) return true;
  const u = userFromJwt(req);
  return !!u && (Number(u.lvl) || 0) >= (minLvl || 0);
}

module.exports = { isInternal, userFromJwt, authorize };
