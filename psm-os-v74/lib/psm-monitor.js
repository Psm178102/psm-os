// ═════════════════════════════════════════════════════════════════════════════
// PSM OS · lib/psm-monitor.js v69.0.0 (STUB)
// Monitor 24/7 — heartbeat + alerta PagerDuty/Slack quando TV cair.
// Stub na v69. Heartbeat basico (ping a cada 5min em /api/heartbeat) recomendado
// para v70+ junto com modularizacao do dashboard-tv.
// ═════════════════════════════════════════════════════════════════════════════
(function(global){
  'use strict';
  if (global.PSM && global.PSM.monitor) return;
  global.PSM = global.PSM || {};

  var _heartbeatId = null;
  global.PSM.monitor = {
    VERSION: '69.0.0-stub',
    startHeartbeat: function(intervalMs){
      intervalMs = intervalMs || 300000; // 5min
      if (_heartbeatId) return false;
      if (global.PSM && global.PSM.timers) {
        _heartbeatId = global.PSM.timers.register('monitor-heartbeat', function(){
          try {
            fetch('/api/heartbeat', { method:'POST', cache:'no-store', credentials:'same-origin' })
              .catch(function(){});
          } catch(_){}
        }, intervalMs, { group: 'system' });
      }
      return !!_heartbeatId;
    },
    stopHeartbeat: function(){
      if (_heartbeatId && global.PSM && global.PSM.timers) global.PSM.timers.clear(_heartbeatId);
      _heartbeatId = null;
    }
  };
  if (global.PSM && global.PSM.log) global.PSM.log.debug('monitor', 'stub carregado');
})(typeof window !== 'undefined' ? window : this);
