// ═════════════════════════════════════════════════════════════════════════════
// PSM OS · lib/psm-ia.js v69.0.0 (STUB)
// Agente IA (Gemini/Claude) — wrapper de chamadas /api/agent.
// Stub na v69 para eliminar 404. Logica real ja vive inline no index.html
// (psmIARodar). Esta lib sera o lar futuro quando index.html for modularizado.
// ═════════════════════════════════════════════════════════════════════════════
(function(global){
  'use strict';
  if (global.PSM && global.PSM.ia) return;
  global.PSM = global.PSM || {};
  global.PSM.ia = {
    VERSION: '69.0.0-stub',
    ask: function(prompt){
      // Bridge para psmIARodar global se existir
      if (typeof global.psmIARodar === 'function') return global.psmIARodar(prompt);
      return Promise.reject(new Error('PSM.ia: psmIARodar nao carregado'));
    }
  };
  if (global.PSM && global.PSM.log) global.PSM.log.debug('ia', 'stub carregado');
})(typeof window !== 'undefined' ? window : this);
