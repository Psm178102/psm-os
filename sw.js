// ═════════════════════════════════════════════════════════════════════════════
// PSM OS — Service Worker v22 (2026-04-20 v22j)
// Estratégia: NETWORK-FIRST para HTML (resolve cache stale), CACHE-FIRST assets.
// Limpa caches antigos automaticamente no activate.
// ═════════════════════════════════════════════════════════════════════════════
'use strict';

const CACHE_VERSION = 'psm-os-v22j-2026-04-20';
const HTML_CACHE    = CACHE_VERSION + '-html';
const ASSET_CACHE   = CACHE_VERSION + '-assets';

// Assets a pré-cachear (fallback offline)
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/favicon-16.png',
  '/favicon-32.png',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/logo-psm-navy.png'
];

// ─── INSTALL ────────────────────────────────────────────────────────────────
self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(HTML_CACHE).then(function(cache){
      return cache.addAll(PRECACHE).catch(function(e){
        console.warn('[SW] precache parcial:', e);
      });
    }).then(function(){ return self.skipWaiting(); })
  );
});

// ─── ACTIVATE — limpa caches antigos ────────────────────────────────────────
self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        if(k !== HTML_CACHE && k !== ASSET_CACHE){
          console.log('[SW] removendo cache antigo:', k);
          return caches.delete(k);
        }
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

// ─── FETCH — network-first para HTML, cache-first para assets ───────────────
self.addEventListener('fetch', function(event){
  var req = event.request;
  if(req.method !== 'GET') return;

  var url = new URL(req.url);

  // Ignora cross-origin (Firebase, RD, fontes externas)
  if(url.origin !== self.location.origin) return;

  var isHTML = req.mode === 'navigate' ||
               (req.headers.get('accept')||'').indexOf('text/html') >= 0 ||
               url.pathname === '/' || url.pathname.endsWith('.html');

  if(isHTML){
    // NETWORK-FIRST: sempre tenta buscar do servidor primeiro
    event.respondWith(
      fetch(req).then(function(resp){
        if(resp && resp.ok){
          var clone = resp.clone();
          caches.open(HTML_CACHE).then(function(cache){ cache.put(req, clone); });
        }
        return resp;
      }).catch(function(){
        return caches.match(req).then(function(cached){
          return cached || caches.match('/index.html');
        });
      })
    );
    return;
  }

  // CACHE-FIRST para assets estáticos (imagens, css, js)
  event.respondWith(
    caches.match(req).then(function(cached){
      if(cached) return cached;
      return fetch(req).then(function(resp){
        if(resp && resp.ok){
          var clone = resp.clone();
          caches.open(ASSET_CACHE).then(function(cache){ cache.put(req, clone); });
        }
        return resp;
      }).catch(function(){ return cached; });
    })
  );
});

// ─── MESSAGE — permite forçar skipWaiting de dentro do app ──────────────────
self.addEventListener('message', function(event){
  if(event.data === 'skipWaiting' || (event.data && event.data.type === 'skipWaiting')){
    self.skipWaiting();
  }
});
