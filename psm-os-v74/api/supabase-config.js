// ═════════════════════════════════════════════════════════════════════════════
// PSM OS · /api/supabase-config — Endpoint Vercel (Serverless Function)
// Devolve URL + anon key do Supabase como JavaScript (consumido via <script src>).
//
// IMPORTANTE: este endpoint retorna JS, NAO JSON, porque o consumidor o carrega
// via <script src="/api/supabase-config"> e espera que defina globais.
//
// Diferente do /api/config (que retorna JSON parseado pelo psm-config.js),
// este eh consumido tanto pelo admin.html quanto pelo index.html.
//
// Variaveis de ambiente esperadas (Vercel > Project > Settings > Env):
//   SUPABASE_URL          - URL do projeto Supabase (https://xxx.supabase.co)
//   SUPABASE_ANON_KEY     - Chave anonima (publica — pode ficar no client)
//   PSM_ALLOWED_ORIGINS   - (opcional) csv de origens permitidas
//
// SEGURANCA: a anon key eh public-by-design (igual a apiKey do Firebase Web).
// A protecao real vem das Row Level Security (RLS) policies do Supabase.
// Veja SECURITY-DEPLOY.md §X para as policies obrigatorias.
// ═════════════════════════════════════════════════════════════════════════════

module.exports = function handler(req, res) {
  // CORS check (defense in depth — Vercel rewrite ja garante same-origin)
  var origin = req.headers.origin || '';
  var allowed = (process.env.PSM_ALLOWED_ORIGINS || '').split(',').map(function(s){return s.trim();}).filter(Boolean);
  if (allowed.length && origin && allowed.indexOf(origin) === -1) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.end('console.error("[supabase-config] origem nao autorizada");');
    return;
  }

  res.setHeader('Cache-Control', 'private, max-age=300, must-revalidate');
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.end('// method not allowed');
    return;
  }

  var url = process.env.SUPABASE_URL || '';
  var key = process.env.SUPABASE_ANON_KEY || '';

  // Serializa via JSON.stringify para escapar aspas, quebras de linha, etc.
  // Bloqueia tambem injecao caso URL contenha caracteres exoticos.
  var body =
    'window.SUPABASE_URL = ' + JSON.stringify(url) + ';\n' +
    'window.SUPABASE_ANON_KEY = ' + JSON.stringify(key) + ';\n' +
    'window.PSM_SUPABASE_READY = ' + JSON.stringify(!!(url && key)) + ';\n' +
    (url && key
      ? 'if (window.console) console.log("[supabase-config] config carregada para " + window.SUPABASE_URL);\n'
      : 'if (window.console) console.warn("[supabase-config] SUPABASE_URL ou SUPABASE_ANON_KEY ausentes nas env vars do Vercel");\n');

  res.statusCode = 200;
  res.end(body);
};
