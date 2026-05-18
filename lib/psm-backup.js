// ═════════════════════════════════════════════════════════════════════════════
// PSM OS · lib/psm-backup.js v69.0.0 (STUB)
// Backup diario automatico (GitHub Releases ou Vercel Blob).
// Stub na v69. Funcao _fbScheduleAutoBackup ja existe inline no index.html.
// ═════════════════════════════════════════════════════════════════════════════
(function(global){
  'use strict';
  if (global.PSM && global.PSM.backup) return;
  global.PSM = global.PSM || {};
  global.PSM.backup = {
    VERSION: '69.0.0-stub',
    schedule: function(){
      // Bridge para _fbScheduleAutoBackup global se existir
      if (typeof global._fbScheduleAutoBackup === 'function') {
        try { global._fbScheduleAutoBackup(); return true; } catch(_){ return false; }
      }
      return false;
    },
    download: function(){ return Promise.resolve(null); }
  };
  if (global.PSM && global.PSM.log) global.PSM.log.debug('backup', 'stub carregado');
})(typeof window !== 'undefined' ? window : this);
