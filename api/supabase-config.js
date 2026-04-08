// /api/supabase-config.js
// Serve credenciais publicas do Supabase como JavaScript.
// Le de Vercel Environment Variables:
//   SUPABASE_URL        (ex: https://xxxx.supabase.co)
//   SUPABASE_ANON_KEY   (ex: eyJhbGc...)
//   PSM_SYNC_MODE       (opcional: "parallel" | "supabase", default "parallel")
//
// A anon key eh publica e protegida por RLS no banco.
// NAO exponha SUPABASE_SERVICE_ROLE_KEY aqui — essa fica server-only.

export default function handler(req, res) {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_ANON_KEY || '';
  const mode = process.env.PSM_SYNC_MODE || 'parallel';

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  // Cache curto: 5 min no CDN, 1 min no browser
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');

  const js = [
    '/* PSM Supabase config — served from Vercel env vars */',
    'window.SUPABASE_URL = ' + JSON.stringify(url) + ';',
    'window.SUPABASE_ANON_KEY = ' + JSON.stringify(key) + ';',
    'window.PSM_SYNC_MODE = ' + JSON.stringify(mode) + ';',
    'window.PSM_SUPABASE_CONFIGURED = ' + (url && key ? 'true' : 'false') + ';'
  ].join('\n');

  res.status(200).send(js);
}
