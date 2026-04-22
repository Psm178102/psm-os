/**
 * PSM-OS Backend Proxy — Cloudflare Worker
 * Proxy para esconder API keys do cliente (Gemini, Supabase service role, etc)
 *
 * DEPLOY:
 * 1. npm create cloudflare@latest psm-proxy
 * 2. Copiar este arquivo para src/worker.js
 * 3. wrangler secret put GEMINI_API_KEY
 * 4. wrangler secret put SUPABASE_SERVICE_ROLE_KEY
 * 5. wrangler secret put FIREBASE_DB_SECRET
 * 6. wrangler secret put SENTRY_DSN
 * 7. wrangler secret put PAGERDUTY_ROUTING_KEY
 * 8. wrangler deploy
 *
 * Configurar em index.html:
 * window.PSM_PROXY_URL = 'https://psm-proxy.seudominio.workers.dev';
 */

const ALLOWED_ORIGINS = [
  'https://psm-os.netlify.app',
  'https://psm-os.web.app',
  'http://localhost:8080',
  'http://localhost:3000'
];

const CORS_HEADERS = (origin) => ({
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-PSM-Token, X-PSM-User',
  'Access-Control-Max-Age': '86400',
  'Vary': 'Origin'
});

// Rate limit: 100 req/min por IP
const RATE_LIMIT = { window: 60000, max: 100 };

async function rateLimitCheck(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const key = `rl:${ip}`;
  const now = Date.now();

  // KV-based rate limiting
  if (env.PSM_KV) {
    const raw = await env.PSM_KV.get(key);
    const data = raw ? JSON.parse(raw) : { count: 0, reset: now + RATE_LIMIT.window };

    if (now > data.reset) {
      data.count = 1;
      data.reset = now + RATE_LIMIT.window;
    } else {
      data.count++;
    }

    await env.PSM_KV.put(key, JSON.stringify(data), { expirationTtl: 120 });

    if (data.count > RATE_LIMIT.max) {
      return { ok: false, retryAfter: Math.ceil((data.reset - now) / 1000) };
    }
  }
  return { ok: true };
}

async function verifyAuth(request, env) {
  const token = request.headers.get('X-PSM-Token');
  if (!token) return { ok: false, err: 'missing token' };

  // Valida contra Firebase Auth ou Supabase JWT
  // Exemplo simples: token = SHA256(user_email + secret) - substitua por JWT real
  try {
    const response = await fetch(`https://${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': env.SUPABASE_ANON_KEY
      }
    });
    if (!response.ok) return { ok: false, err: 'invalid token' };
    const user = await response.json();
    return { ok: true, user };
  } catch (e) {
    return { ok: false, err: e.message };
  }
}

async function handleGemini(request, env) {
  const body = await request.json();

  // Valida tamanho do prompt (anti-abuse)
  const prompt = JSON.stringify(body).slice(0, 10000);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: prompt
    }
  );

  return new Response(await response.text(), {
    status: response.status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleSupabaseAdmin(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/supabase-admin', '');

  const response = await fetch(`${env.SUPABASE_URL}${path}${url.search}`, {
    method: request.method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
    },
    body: request.method !== 'GET' ? await request.text() : undefined
  });

  return new Response(await response.text(), {
    status: response.status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleSentry(request, env) {
  // Forward event para Sentry via DSN real
  const body = await request.text();
  const response = await fetch(env.SENTRY_INGEST_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${env.SENTRY_KEY}`
    },
    body
  });
  return new Response(await response.text(), { status: response.status });
}

async function handlePagerDuty(request, env) {
  const payload = await request.json();
  payload.routing_key = env.PAGERDUTY_ROUTING_KEY;

  const response = await fetch('https://events.pagerduty.com/v2/enqueue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return new Response(await response.text(), { status: response.status });
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const cors = CORS_HEADERS(origin);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    // Rate limit
    const rl = await rateLimitCheck(request, env);
    if (!rl.ok) {
      return new Response(JSON.stringify({ err: 'rate limit' }), {
        status: 429,
        headers: { ...cors, 'Retry-After': rl.retryAfter, 'Content-Type': 'application/json' }
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Roteamento
    let response;
    try {
      if (path === '/health') {
        response = new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } else if (path === '/gemini') {
        // Gemini nao requer auth (uso publico AI)
        response = await handleGemini(request, env);
      } else if (path.startsWith('/supabase-admin')) {
        const auth = await verifyAuth(request, env);
        if (!auth.ok) {
          response = new Response(JSON.stringify({ err: auth.err }), { status: 401 });
        } else {
          response = await handleSupabaseAdmin(request, env);
        }
      } else if (path === '/sentry') {
        response = await handleSentry(request, env);
      } else if (path === '/pagerduty') {
        const auth = await verifyAuth(request, env);
        if (!auth.ok) {
          response = new Response(JSON.stringify({ err: auth.err }), { status: 401 });
        } else {
          response = await handlePagerDuty(request, env);
        }
      } else {
        response = new Response(JSON.stringify({ err: 'not found' }), { status: 404 });
      }
    } catch (e) {
      response = new Response(JSON.stringify({ err: e.message }), { status: 500 });
    }

    // Adiciona CORS headers
    const newHeaders = new Headers(response.headers);
    Object.entries(cors).forEach(([k, v]) => newHeaders.set(k, v));

    return new Response(response.body, {
      status: response.status,
      headers: newHeaders
    });
  }
};
