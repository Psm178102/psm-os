// ═════════════════════════════════════════════════════════════════════════════
// PSM OS · lib/psm-sentry-init.js v70.0.0
// Carrega Sentry SDK do CDN e inicializa com DSN do /api/config (ou localStorage).
// Extraido inline do index.html (v70 modularization).
//
// Configuracao:
//   - DSN preferencial: process.env.PSM_SENTRY_DSN_PUBLIC (via /api/config)
//   - Fallback: localStorage.psm_sentry_dsn
//   - Sem DSN: nao carrega o SDK (zero overhead)
// ═════════════════════════════════════════════════════════════════════════════
(function(global){
  'use strict';

  function _getDSN(){
    // 1) /api/config (carregado por psm-config.js)
    try {
      if (global.PSM && global.PSM.config && global.PSM.config.isReady()) {
        var cfg = global.__PSM_SENTRY_DSN__;
        if (cfg && cfg.indexOf('https://') === 0) return cfg;
      }
    } catch(_){}
    // 2) localStorage override
    try {
      var ls = global.localStorage && localStorage.getItem('psm_sentry_dsn');
      if (ls && ls.indexOf('https://') === 0) return ls;
    } catch(_){}
    return null;
  }

  function _init(dsn){
    if (!dsn) return;
    if (global.Sentry && global.Sentry.init) {
      _doInit(dsn); // SDK ja carregado
      return;
    }
    var s = global.document.createElement('script');
    s.src = 'https://browser.sentry-cdn.com/7.119.0/bundle.min.js';
    s.crossOrigin = 'anonymous';
    s.onload = function(){ _doInit(dsn); };
    s.onerror = function(){
      if (global.PSM && global.PSM.log) global.PSM.log.warn('sentry', 'CDN load fail');
    };
    global.document.head.appendChild(s);
  }

  function _doInit(dsn){
    try {
      var meta = global.document.querySelector('meta[name="version"]');
      var release = 'psm-os-' + ((meta && meta.content) || 'unknown');
      global.Sentry.init({
        dsn: dsn,
        environment: (global.location.hostname === 'localhost') ? 'development' : 'production',
        release: release,
        tracesSampleRate: 0.1,
        beforeSend: function(event){
          if (event.level === 'log') return null;
          if (event.breadcrumbs) event.breadcrumbs.forEach(function(b){
            if (b.data && b.data.senha) delete b.data.senha;
            if (b.data && b.data.password) delete b.data.password;
            if (b.data && b.data.apiKey) delete b.data.apiKey;
          });
          return event;
        }
      });
      var userId = (global.S && global.S.user && global.S.user.id) || 'anonymous';
      global.Sentry.setUser({ id: userId });
      if (global.PSM && global.PSM.log) global.PSM.log.info('sentry', 'ativo (release: ' + release + ')');
    } catch(err){
      if (global.PSM && global.PSM.log) global.PSM.log.warn('sentry', 'init fail', err);
    }
  }

  // Helper publico para captura manual
  global.psmSentryCapture = function(err, ctx){
    try { if (global.Sentry) global.Sentry.captureException(err, { extra: ctx || {} }); } catch(_){}
  };

  // Boot: aguarda /api/config para pegar DSN preferencial; senao usa fallback imediato
  function _boot(){
    if (global.PSM && global.PSM.config && typeof global.PSM.config.onReady === 'function') {
      global.PSM.config.onReady(function(){ _init(_getDSN()); });
    } else {
      _init(_getDSN());
    }
  }
  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }

  global.PSM = global.PSM || {};
  global.PSM.sentryInit = { VERSION: '70.0.0' };
})(typeof window !== 'undefined' ? window : this);
