// ═════════════════════════════════════════════════════════════════════════════
// PSM OS · /api/config — Endpoint Vercel (Serverless Function)
// Devolve config publica (Firebase Web SDK) a partir das env vars do projeto.
//
// Por que existir:
//   v67 hardcoded a apiKey Firebase no source publico. Chaves Firebase Web sao
//   "public by design" (Google), mas expor no HTML facilita scraping/abuse.
//   Movendo para env var:
//     1) source publico nao revela credenciais
//     2) trocar de projeto Firebase nao requer rebuild do bundle
//     3) podemos adicionar checagens de origem (Referer) antes de devolver
//
// Variaveis de ambiente esperadas (definir em Vercel > Project > Settings > Env):
//   FIREBASE_API_KEY
//   FIREBASE_AUTH_DOMAIN
//   FIREBASE_DATABASE_URL
//   FIREBASE_PROJECT_ID
//   FIREBASE_STORAGE_BUCKET
//   FIREBASE_MESSAGING_SENDER_ID
//   FIREBASE_APP_ID
//   PSM_ALLOWED_ORIGINS  (opcional, csv: "https://psm-os.vercel.app,https://app.psm.com")
//
// IMPORTANTE: ainda assim, a seguranca real do Firebase Realtime Database vem
// das *Database Rules* do projeto. Configure-as restritivas:
//   {
//     "rules": {
//       ".read":  "auth != null",
//       ".write": "auth != null",
//       "shared": { ".read": "auth != null", ".write": "auth != null" }
//     }
//   }
// ═════════════════════════════════════════════════════════════════════════════

module.exports = function handler(req, res) {
  // CORS — somente same-origin (Vercel rewrite ja garante, mas defesa em camadas)
  var origin = req.headers.origin || '';
  var allowed = (process.env.PSM_ALLOWED_ORIGINS || '').split(',').map(function(s){return s.trim();}).filter(Boolean);
  if (allowed.length && origin && allowed.indexOf(origin) === -1) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'origin_not_allowed' }));
    return;
  }

  // Headers de seguranca
  res.setHeader('Cache-Control', 'private, max-age=300, must-revalidate'); // 5min
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }

  // Le env vars — todas opcionais. Se faltar databaseURL, devolvemos sem firebase.
  var fb = null;
  if (process.env.FIREBASE_DATABASE_URL && process.env.FIREBASE_API_KEY) {
    fb = {
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
      databaseURL: process.env.FIREBASE_DATABASE_URL,
      projectId: process.env.FIREBASE_PROJECT_ID || '',
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
      appId: process.env.FIREBASE_APP_ID || ''
    };
  }

  // v73: tambem expoe config Supabase para clients que usam PSM.config (alem do /api/supabase-config legacy)
  var supabase = null;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    supabase = {
      url: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY
    };
  }

  var payload = {
    version: '73.0.0',
    serverTime: new Date().toISOString(),
    firebase: fb,
    supabase: supabase,                                // v73 NOVO
    googleApiKey: process.env.GOOGLE_API_KEY || null,  // Drive + Maps (configurar HTTP referrer restrictions no GCP)
    adminSha256: process.env.ADMIN_SHA256 || null,     // SHA-256 hex da senha do /admin.html (gerar: echo -n "senha" | shasum -a 256)
    integrations: {
      sentryDsnPublic: process.env.PSM_SENTRY_DSN_PUBLIC || null
    }
  };

  res.statusCode = 200;
  res.end(JSON.stringify(payload));
};
