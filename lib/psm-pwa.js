// ═════════════════════════════════════════════════════════════════════════════
// PSM OS · lib/psm-pwa.js v70.0.0
// PWA Service Worker bootstrap + auto-update banner + version checker.
// Extraido inline do index.html (v70 modularization).
//
// Estrategia:
//   - Registra /sw.js com updateViaCache:'none' (sempre fresh)
//   - Check de update a cada 5min + ao voltar foco da aba
//   - Banner amarelo quando SW novo instalado (sem countdown agressivo)
//   - Defense-in-depth: poll /version.json a cada 5min, compara com PSM_VERSION
//   - Helper global window.psmForceUpdate() pode ser chamado de console
//
// Configuracao via localStorage (override em dev):
//   psm_pwa_check_interval_ms — default 300000 (5min)
//   psm_pwa_hidden_reload_ms — default 30000 (30s)
// ═════════════════════════════════════════════════════════════════════════════
(function(global){
  'use strict';
  if (!('serviceWorker' in global.navigator)) {
    if (global.PSM && global.PSM.log) global.PSM.log.warn('pwa', 'SW nao suportado neste navegador');
    return;
  }

  function _log(level, msg, data){
    if (global.PSM && global.PSM.log) return global.PSM.log[level]('pwa', msg, data);
    try { (console[level]||console.log)('[PSM·pwa]', msg, data || ''); } catch(_){}
  }

  function _readInt(key, def){
    try { var v = parseInt(global.localStorage.getItem(key)||'',10); if (!isNaN(v) && v>0) return v; } catch(_){}
    return def;
  }
  var CHECK_INTERVAL_MS = _readInt('psm_pwa_check_interval_ms', 300000);
  var HIDDEN_RELOAD_MS  = _readInt('psm_pwa_hidden_reload_ms', 30000);

  var _reloading = false;
  var _updateBannerShown = false;

  function _doReload(){
    if (_reloading) return;
    _reloading = true;
    try {
      if (global.caches && caches.keys) {
        caches.keys().then(function(keys){
          return Promise.all(keys.map(function(k){ return caches.delete(k); }));
        }).finally(function(){ global.location.reload(true); });
      } else {
        global.location.reload(true);
      }
    } catch(_){ global.location.reload(); }
  }

  function _showUpdateBanner(){
    if (_updateBannerShown) return;
    _updateBannerShown = true;
    try {
      var b = global.document.createElement('div');
      b.id = 'psm-update-banner';
      b.setAttribute('role', 'alert');
      b.setAttribute('aria-live', 'assertive');
      b.style.cssText = 'position:fixed;top:0;left:0;right:0;background:linear-gradient(90deg,#d4af37,#f4c430);color:#0f172a;padding:10px 16px;font-weight:700;font-size:13px;text-align:center;z-index:999999;box-shadow:0 2px 10px rgba(0,0,0,0.3);font-family:system-ui';
      // Constroi com DOM API (sem innerHTML — v68 anti-XSS)
      var sec = (global.PSM && global.PSM.security && global.PSM.security.buildEl) ? global.PSM.security.buildEl : null;
      if (sec) {
        b.appendChild(sec('span', {}, 'Nova versao disponivel.'));
        b.appendChild(sec('button', {
          id:'_psm_update_now', 'aria-label':'Atualizar agora',
          style:{margin:'0 0 0 12px',background:'#0f172a',color:'#d4af37',border:'none',padding:'4px 12px',borderRadius:'4px',fontWeight:'700',cursor:'pointer'}
        }, 'Atualizar agora'));
        b.appendChild(sec('button', {
          id:'_psm_update_later', 'aria-label':'Atualizar depois',
          style:{margin:'0 0 0 6px',background:'transparent',color:'#0f172a',border:'1px solid #0f172a',padding:'4px 10px',borderRadius:'4px',cursor:'pointer',fontSize:'11px'}
        }, 'Depois'));
      } else {
        // fallback se psm-security nao carregou (nao deve acontecer)
        b.textContent = 'Nova versao disponivel — recarregue a pagina.';
      }
      global.document.body.appendChild(b);

      var hideTimer = null;
      var visHandler = function(){
        if (global.document.visibilityState === 'hidden') {
          hideTimer = setTimeout(function(){
            try { if (b.parentNode) _doReload(); } catch(_){}
          }, HIDDEN_RELOAD_MS);
        } else {
          if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        }
      };
      global.document.addEventListener('visibilitychange', visHandler);

      var btnNow = global.document.getElementById('_psm_update_now');
      var btnLater = global.document.getElementById('_psm_update_later');
      if (btnNow) btnNow.onclick = function(){ global.document.removeEventListener('visibilitychange', visHandler); _doReload(); };
      if (btnLater) btnLater.onclick = function(){ global.document.removeEventListener('visibilitychange', visHandler); b.remove(); _updateBannerShown = false; };
    } catch(_){ _doReload(); }
  }

  global.psmForceUpdate = function(){
    _log('info', 'forcando update manual');
    if (global.navigator.serviceWorker.controller) {
      try { global.navigator.serviceWorker.controller.postMessage({ type: 'PURGE_ALL' }); } catch(_){}
    }
    setTimeout(_doReload, 500);
  };

  function _registerSW(){
    global.navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(function(reg){
      _log('info', 'SW registrado', reg.scope);

      // Check de update periodico
      if (global.PSM && global.PSM.timers) {
        global.PSM.timers.register('pwa-update-check', function(){ try{ reg.update(); }catch(_){} }, CHECK_INTERVAL_MS, { group:'system' });
      } else {
        setInterval(function(){ try{ reg.update(); }catch(_){} }, CHECK_INTERVAL_MS);
      }

      // Check no foco — debounced (so se passou >5min)
      var _lastVisCheck = Date.now();
      global.document.addEventListener('visibilitychange', function(){
        if (global.document.visibilityState === 'visible' && (Date.now() - _lastVisCheck) > CHECK_INTERVAL_MS) {
          _lastVisCheck = Date.now();
          try { reg.update(); } catch(_){}
        }
      });

      reg.addEventListener('updatefound', function(){
        var nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', function(){
          if (nw.state === 'installed' && global.navigator.serviceWorker.controller) {
            try { nw.postMessage({ type:'skipWaiting' }); } catch(_){}
            _showUpdateBanner();
          }
        });
      });

      global.navigator.serviceWorker.addEventListener('controllerchange', function(){
        _log('info', 'novo SW assumiu — banner mostrado, sem auto-reload');
      });

      global.navigator.serviceWorker.addEventListener('message', function(ev){
        var d = ev.data || {};
        if (d.type === 'NEW_VERSION') {
          _log('info', 'SW anunciou NEW_VERSION', d.version);
          _showUpdateBanner();
        }
        if (d.type === 'PURGE_ALL_DONE') {
          _log('info', 'caches purgados pelo SW');
        }
      });
    }).catch(function(err){
      _log('warn', 'SW registro falhou', err);
    });
  }

  // ─── VERSION CHECKER (defense-in-depth) ─────────────────────────────────
  function _checkVersion(){
    var clientVer = global.PSM_VERSION || '0';
    fetch('/version.json?_=' + Date.now(), { cache: 'no-store' }).then(function(r){
      return r.ok ? r.json() : null;
    }).then(function(j){
      if (!j || !j.version) return;
      if (j.version !== clientVer) {
        _log('info', 'version mismatch', { client: clientVer, server: j.version });
        _showUpdateBanner();
      }
    }).catch(function(){ /* offline — silencia */ });
  }

  function _startVersionChecker(){
    setTimeout(_checkVersion, 30000);
    if (global.PSM && global.PSM.timers) {
      global.PSM.timers.register('pwa-version-poll', _checkVersion, CHECK_INTERVAL_MS, { group:'system' });
    } else {
      setInterval(_checkVersion, CHECK_INTERVAL_MS);
    }
    global.document.addEventListener('visibilitychange', function(){
      if (global.document.visibilityState === 'visible') setTimeout(_checkVersion, 1000);
    });
  }

  global.addEventListener('load', _registerSW);
  if (global.document.readyState === 'complete') _startVersionChecker();
  else global.addEventListener('load', _startVersionChecker);

  global.PSM = global.PSM || {};
  global.PSM.pwa = {
    VERSION: '70.0.0',
    forceUpdate: global.psmForceUpdate,
    showBanner: _showUpdateBanner
  };
})(typeof window !== 'undefined' ? window : this);
