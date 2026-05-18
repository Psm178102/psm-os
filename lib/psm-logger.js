// ═════════════════════════════════════════════════════════════════════════════
// PSM OS · lib/psm-logger.js v69.0.0
// Logger centralizado — substitui os 141 console.error("[PSM vXX.X]",e)
// espalhados pelo bundle. Padroniza formato, integra com Sentry, e permite
// silenciar/filtrar em produção sem mexer no código.
//
// API publica (window.PSM.log):
//   debug(scope, msg, data?)
//   info (scope, msg, data?)
//   warn (scope, msg, err?)
//   error(scope, msg, err?)       → tambem reporta ao Sentry se disponivel
//   group(scope)                  → factory que retorna logger pre-bindado
//
// Tambem expõe atalho global: window.psmLog(scope, level, ...args)
//
// Niveis ativos via:
//   localStorage.psm_log_level = 'debug' | 'info' | 'warn' | 'error' | 'silent'
//   default em prod: 'warn'
//   default em dev (localhost): 'debug'
// ═════════════════════════════════════════════════════════════════════════════
(function(global){
  'use strict';

  var LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
  var DEFAULT = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'debug' : 'warn';

  function _level(){
    try {
      var s = localStorage.getItem('psm_log_level');
      if (s && LEVELS[s] != null) return LEVELS[s];
    } catch(_){}
    return LEVELS[DEFAULT];
  }

  function _fmt(scope, level, msg){
    var tag = '[PSM' + (scope ? '·'+scope : '') + ']';
    return [tag, msg];
  }

  function _emit(scope, level, msg, extra){
    if (LEVELS[level] < _level()) return;
    var args = _fmt(scope, level, msg);
    if (extra !== undefined) args.push(extra);
    try {
      if (level === 'error' && console.error) console.error.apply(console, args);
      else if (level === 'warn' && console.warn) console.warn.apply(console, args);
      else if (level === 'info' && console.info) console.info.apply(console, args);
      else if (console.log) console.log.apply(console, args);
    } catch(_){}
    // Bridge Sentry para errors
    if (level === 'error' && global.Sentry && global.Sentry.captureException) {
      try {
        var err = (extra instanceof Error) ? extra : new Error(msg);
        global.Sentry.withScope(function(s){
          s.setTag('psm_scope', scope || 'root');
          s.setExtra('msg', msg);
          if (extra && !(extra instanceof Error)) s.setExtra('data', extra);
          global.Sentry.captureException(err);
        });
      } catch(_){}
    }
  }

  var api = {
    debug: function(scope, msg, data){ _emit(scope, 'debug', msg, data); },
    info:  function(scope, msg, data){ _emit(scope, 'info',  msg, data); },
    warn:  function(scope, msg, err){  _emit(scope, 'warn',  msg, err); },
    error: function(scope, msg, err){  _emit(scope, 'error', msg, err); },
    setLevel: function(lvl){
      if (LEVELS[lvl] == null) return false;
      try { localStorage.setItem('psm_log_level', lvl); } catch(_){}
      return true;
    },
    getLevel: function(){
      var lv = _level();
      for (var k in LEVELS) if (LEVELS[k] === lv) return k;
      return DEFAULT;
    },
    group: function(scope){
      return {
        debug: function(m,d){ _emit(scope,'debug',m,d); },
        info:  function(m,d){ _emit(scope,'info', m,d); },
        warn:  function(m,e){ _emit(scope,'warn', m,e); },
        error: function(m,e){ _emit(scope,'error',m,e); }
      };
    },
    VERSION: '69.0.0'
  };

  global.PSM = global.PSM || {};
  global.PSM.log = api;
  global.psmLog = function(scope, level){
    var args = Array.prototype.slice.call(arguments, 2);
    return api[level || 'info'].apply(api, [scope].concat(args));
  };

  // Captura erros globais nao-tratados
  if (global.addEventListener) {
    global.addEventListener('error', function(e){
      api.error('window.onerror', e.message || 'unknown error', e.error || e);
    });
    global.addEventListener('unhandledrejection', function(e){
      api.error('unhandledrejection', e.reason && e.reason.message || 'promise rejected', e.reason);
    });
  }

  if (global.console && console.log) console.log('[PSM] psm-logger.js v' + api.VERSION + ' carregado (nivel: ' + api.getLevel() + ')');
})(typeof window !== 'undefined' ? window : this);
