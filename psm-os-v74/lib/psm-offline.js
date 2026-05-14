// ═════════════════════════════════════════════════════════════════════════════
// PSM OS · lib/psm-offline.js v69.0.0 (STUB)
// Engine offline CRDT (IndexedDB + vector clocks + resolucao de conflito).
// Stub na v69. localStorage atual ja serve como fallback offline simples.
// ═════════════════════════════════════════════════════════════════════════════
(function(global){
  'use strict';
  if (global.PSM && global.PSM.offline) return;
  global.PSM = global.PSM || {};
  global.PSM.offline = {
    VERSION: '69.0.0-stub',
    isOnline: function(){ return global.navigator ? navigator.onLine : true; },
    queue: function(){ /* noop — fallback eh localStorage */ },
    flush: function(){ return Promise.resolve(0); }
  };
  if (global.PSM && global.PSM.log) global.PSM.log.debug('offline', 'stub carregado (online: ' + global.PSM.offline.isOnline() + ')');
})(typeof window !== 'undefined' ? window : this);
