// PSM OS — Service Worker (network-first, offline fallback)
// v1 — 2026-04-15
const CACHE = 'psm-os-v1';
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for HTML/JSON (dados sempre frescos), cache-first para estáticos (imagens/ícones)
self.addEventListener('fetch', (evt) => {
  const req = evt.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Ignora APIs externas que têm seu próprio cache (Firebase, RD, Meta Ads, Sheets)
  const externalHosts = ['firebaseio.com','googleapis.com','rd.services','graph.facebook.com','docs.google.com'];
  if (externalHosts.some(h => url.hostname.includes(h))) return;

  const isStatic = /\.(png|jpg|jpeg|svg|ico|woff2?|ttf|css)$/i.test(url.pathname);

  if (isStatic) {
    // Cache-first
    evt.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return resp;
      }).catch(() => cached))
    );
  } else {
    // Network-first para index.html e JSON — dados sempre frescos, cache só como fallback offline
    evt.respondWith(
      fetch(req).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return resp;
      }).catch(() => caches.match(req).then(r => r || caches.match('/index.html')))
    );
  }
});
