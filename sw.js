// ═════════════════════════════════════════════════════════════════════════════
// PSM OS — Service Worker v31 (2026-04-26 — Sprint 3: fim da versao antiga stale)
// - NETWORK-ONLY para HTML (sem cache) + libs JS do app
// - CACHE-FIRST apenas assets imutaveis (imagens, icones, manifest)
// - skipWaiting + clients.claim imediato
// - Purge total de caches antigos no activate
// - postMessage NEW_VERSION aos clients quando SW novo ativa
// ═════════════════════════════════════════════════════════════════════════════
'use strict';

const SW_VERSION = 'v81.4.0-2026-06-20-DOCSDOWNLOAD';
const CACHE_VERSION = 'psm-os-' + SW_VERSION;
const ASSET_CACHE   = CACHE_VERSION + '-assets';

// Apenas assets imutaveis (imagens, icones, manifest) entram no cache.
// HTML, JS do app (lib/*), CSS → SEMPRE rede, nunca cache.
const IMMUTABLE_ASSETS = [
  '/manifest.json',
  '/favicon.ico',
  '/favicon-16.png',
  '/favicon-32.png',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/logo-psm-navy.png'
];

// Rotas que NUNCA devem ser cacheadas (sempre rede + no-store)
function isNeverCache(url, req){
  var p = url.pathname;
  // HTML
  if (req.mode === 'navigate') return true;
  if ((req.headers.get('accept')||'').indexOf('text/html') >= 0) return true;
  if (p === '/' || p.endsWith('.html')) return true;
  // JS do app (lib/*, sw.js) — sempre fresh
  if (p.startsWith('/lib/')) return true;
  if (p === '/sw.js') return true;
  // Version manifest
  if (p === '/version.json') return true;
  // v75.40 Sprint 7: /v2/* sempre fresh (frontend modular em construção)
  if (p.startsWith('/v2/')) return true;
  return false;
}

function isImmutableAsset(url){
  var p = url.pathname;
  if (IMMUTABLE_ASSETS.indexOf(p) >= 0) return true;
  // imagens/fontes
  if (/\.(png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|eot)$/i.test(p)) return true;
  return false;
}

// ─── INSTALL ────────────────────────────────────────────────────────────────
self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(ASSET_CACHE).then(function(cache){
      return cache.addAll(IMMUTABLE_ASSETS).catch(function(e){
        console.warn('[SW] precache parcial:', e);
      });
    }).then(function(){
      // Ativa imediatamente sem esperar tabs fecharem
      return self.skipWaiting();
    })
  );
});

// ─── ACTIVATE — purga TODOS caches antigos ─────────────────────────────────
self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        // Remove QUALQUER cache que nao seja do SW atual
        if (k !== ASSET_CACHE) {
          console.log('[SW] purgando cache antigo:', k);
          return caches.delete(k);
        }
      }));
    }).then(function(){
      return self.clients.claim();
    }).then(function(){
      // Notifica TODAS tabs abertas que ha nova versao
      return self.clients.matchAll({ includeUncontrolled: true }).then(function(clients){
        clients.forEach(function(client){
          try {
            client.postMessage({ type: 'NEW_VERSION', version: SW_VERSION });
          } catch(_){}
        });
      });
    })
  );
});

// ─── FETCH ─────────────────────────────────────────────────────────────────
self.addEventListener('fetch', function(event){
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch(_){ return; }

  // Ignora cross-origin (Firebase, RD, CDNs, etc)
  if (url.origin !== self.location.origin) return;

  // NEVER CACHE: HTML, /lib/*, sw.js, version.json → sempre rede
  if (isNeverCache(url, req)) {
    event.respondWith(
      fetch(req, { cache: 'no-store' }).catch(function(e){
        // Offline fallback: tenta cache apenas se offline total
        return caches.match(req).then(function(c){
          if (c) return c;
          // Se for navegacao e offline, mostra mensagem
          if (req.mode === 'navigate') {
            return new Response(
              '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Offline</title><style>body{font-family:system-ui;background:#0f172a;color:#fff;padding:40px;text-align:center}</style></head><body><h1>Sem conexao</h1><p>Verifique sua internet e tente novamente.</p><button onclick="location.reload()">Recarregar</button></body></html>',
              { headers: { 'Content-Type': 'text/html; charset=UTF-8' }, status: 503 }
            );
          }
          throw e;
        });
      })
    );
    return;
  }

  // IMMUTABLE ASSETS: cache-first (imagens, icones)
  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(req).then(function(cached){
        if (cached) return cached;
        return fetch(req).then(function(resp){
          if (resp && resp.ok) {
            var clone = resp.clone();
            caches.open(ASSET_CACHE).then(function(cache){ cache.put(req, clone); });
          }
          return resp;
        });
      })
    );
    return;
  }

  // DEFAULT: network-first, cache como fallback offline
  event.respondWith(
    fetch(req, { cache: 'no-store' }).then(function(resp){
      if (resp && resp.ok) {
        var clone = resp.clone();
        caches.open(ASSET_CACHE).then(function(cache){ cache.put(req, clone); });
      }
      return resp;
    }).catch(function(){
      return caches.match(req);
    })
  );
});

// ─── MESSAGE ────────────────────────────────────────────────────────────────
self.addEventListener('message', function(event){
  var data = event.data;
  if (data === 'skipWaiting' || (data && data.type === 'skipWaiting')) {
    self.skipWaiting();
  }
  // Comando PURGE_ALL: limpa todos caches do SW
  if (data && data.type === 'PURGE_ALL') {
    event.waitUntil(
      caches.keys().then(function(keys){
        return Promise.all(keys.map(function(k){ return caches.delete(k); }));
      }).then(function(){
        // Responde ao client com resultado
        if (event.source) {
          try { event.source.postMessage({ type: 'PURGE_ALL_DONE' }); } catch(_){}
        }
      })
    );
  }
  // Comando GET_VERSION
  if (data && data.type === 'GET_VERSION') {
    if (event.source) {
      try { event.source.postMessage({ type: 'SW_VERSION', version: SW_VERSION }); } catch(_){}
    }
  }
});
