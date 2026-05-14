// ═════════════════════════════════════════════════════════════════════════════
// PSM OS · lib/psm-config.js v68.0.0
// Loader assincrono de configuracao remota (Firebase, integracoes).
//
// Antes (v67): config Firebase hardcoded no index.html — apiKey exposta no source.
// Agora (v68): /api/config devolve a config a partir de process.env do Vercel.
//              Fallback: localStorage 'psm_firebase_config' (configuravel pelo
//              modal in-app). Se ambos falharem, Firebase nao inicializa e o
//              app cai em modo offline-only (localStorage).
//
// API publica (window.PSM.config):
//   load()                  → Promise<object> com toda a config
//   getFirebase()           → config Firebase ja carregada (sync, pode retornar null)
//   isReady()               → true se load() ja resolveu
//   onReady(fn)             → callback quando config carregar
// ═════════════════════════════════════════════════════════════════════════════
(function(global){
  'use strict';

  var _state = {
    loaded: false,
    loading: null,    // Promise em voo
    config: null,
    error: null
  };
  var _readyCbs = [];

  function _resolveReady(){
    _state.loaded = true;
    var cbs = _readyCbs.slice();
    _readyCbs.length = 0;
    cbs.forEach(function(cb){ try { cb(_state.config); } catch(_){} });
  }

  function _localFirebaseFallback(){
    try {
      var raw = global.localStorage && localStorage.getItem('psm_firebase_config');
      if (raw) return JSON.parse(raw);
    } catch(_){}
    return null;
  }

  function load(){
    if (_state.loaded) return Promise.resolve(_state.config);
    if (_state.loading) return _state.loading;

    _state.loading = fetch('/api/config', { cache: 'no-store', credentials: 'same-origin' })
      .then(function(r){
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(json){
        _state.config = json || {};
        // se /api/config nao mandou firebase, tenta localStorage
        if (!_state.config.firebase) {
          var local = _localFirebaseFallback();
          if (local) _state.config.firebase = local;
        }
        // Popula globals usados pelo bundle monolitico (v68 transition)
        if (_state.config.googleApiKey) {
          global.__PSM_GOOGLE_API_KEY__ = _state.config.googleApiKey;
        }
        if (_state.config.integrations && _state.config.integrations.sentryDsnPublic) {
          global.__PSM_SENTRY_DSN__ = _state.config.integrations.sentryDsnPublic;
        }
        if (global.console) console.log('[PSM-Config] config remota carregada');
        _resolveReady();
        return _state.config;
      })
      .catch(function(err){
        _state.error = err;
        if (global.console) console.warn('[PSM-Config] /api/config falhou (' + err.message + '), usando fallback local');
        // fallback: somente localStorage
        var local = _localFirebaseFallback();
        _state.config = { firebase: local || null, _fallback: true };
        _resolveReady();
        return _state.config;
      });

    return _state.loading;
  }

  function getFirebase(){
    return _state.config && _state.config.firebase ? _state.config.firebase : null;
  }

  function isReady(){ return _state.loaded; }

  function onReady(cb){
    if (typeof cb !== 'function') return;
    if (_state.loaded) { try { cb(_state.config); } catch(_){} return; }
    _readyCbs.push(cb);
  }

  var api = {
    load: load,
    getFirebase: getFirebase,
    isReady: isReady,
    onReady: onReady,
    VERSION: '68.0.0'
  };

  global.PSM = global.PSM || {};
  global.PSM.config = api;

  // dispara load imediatamente (nao aguarda DOMContentLoaded)
  try { load(); } catch(_){}

  if (global.console) console.log('[PSM-Config] psm-config.js v' + api.VERSION + ' carregado');
})(typeof window !== 'undefined' ? window : this);
