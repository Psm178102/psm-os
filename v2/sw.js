// PSM /v2 — Service Worker (offline-first cache de shell)
const VERSION = 'v95-2026-05-30-crm-dark';
const SHELL_CACHE = 'psm-v2-shell-' + VERSION;
// Runtime cache versionado: ao bumpar VERSION, o activate purga o runtime antigo
// (JS/CSS desatualizado) automaticamente, garantindo que mudanças propaguem.
const RUNTIME_CACHE = 'psm-v2-runtime-' + VERSION;

const SHELL_URLS = [
  '/v2/',
  '/v2/index.html',
  '/v2/manifest.json',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone/babel.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
];

self.addEventListener('install', evt => {
  evt.waitUntil(
    caches.open(SHELL_CACHE).then(cache =>
      Promise.allSettled(SHELL_URLS.map(u => cache.add(u).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', evt => {
  evt.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== SHELL_CACHE && k !== RUNTIME_CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', evt => {
  const url = new URL(evt.request.url);
  // Supabase API: sempre rede (real-time deve passar)
  if (url.hostname.includes('supabase') || url.pathname.startsWith('/api/')) return;
  // HTML: network-first
  if (evt.request.mode === 'navigate' || (evt.request.headers.get('accept') || '').includes('text/html')) {
    evt.respondWith(
      fetch(evt.request, { cache: 'no-store' })
        .then(r => { caches.open(RUNTIME_CACHE).then(c => c.put(evt.request, r.clone())); return r; })
        .catch(() => caches.match(evt.request).then(c => c || caches.match('/v2/index.html')))
    );
    return;
  }
  // JS/CSS do app (/v2/js, /v2/css): NETWORK-FIRST (no-store)
  // Antes era stale-while-revalidate → servia o JS VELHO na 1ª carga pós-deploy
  // (a mudança só aparecia no 2º load → "cadê as mudanças?"). Agora busca SEMPRE
  // a versão nova da rede; o cache fica só como fallback offline. Deploy propaga de 1ª.
  if (url.pathname.startsWith('/v2/js/') || url.pathname.startsWith('/v2/css/') || url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    evt.respondWith(
      fetch(evt.request, { cache: 'no-store' }).then(r => {
        if (r && r.ok) caches.open(RUNTIME_CACHE).then(c => c.put(evt.request, r.clone()));
        return r;
      }).catch(() => caches.match(evt.request))
    );
    return;
  }
  // Estatico (CDN, libs imutáveis): cache-first
  evt.respondWith(
    caches.match(evt.request).then(cached => cached || fetch(evt.request).then(r => {
      if (r && r.ok) caches.open(RUNTIME_CACHE).then(c => c.put(evt.request, r.clone()));
      return r;
    }).catch(() => cached))
  );
});

self.addEventListener('message', evt => {
  if (evt.data === 'skipWaiting') self.skipWaiting();
});

// ─── Web Push (notificações navegador + celular/PWA) ───────────────────
self.addEventListener('push', evt => {
  let d = {};
  try { d = evt.data ? evt.data.json() : {}; }
  catch (e) { d = { title: 'House PSM', body: evt.data ? evt.data.text() : '' }; }
  const title = d.title || 'House PSM';
  evt.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    tag: d.tag || 'psm',
    renotify: true,
    data: { link: d.link || '/v2/' },
  }));
});

self.addEventListener('notificationclick', evt => {
  evt.notification.close();
  let raw = (evt.notification.data && evt.notification.data.link) || '#/';
  // Link salvo como rota hash ("#/captacoes") → URL completa do app "/v2/#/captacoes"
  const url = raw.startsWith('#') ? ('/v2/' + raw) : (raw.startsWith('/') ? raw : '/v2/');
  evt.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      for (const c of cs) {
        if (c.url.includes('/v2') && 'focus' in c) {
          if ('navigate' in c) { try { c.navigate(url); } catch (e) {} }
          return c.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
