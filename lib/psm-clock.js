// ═════════════════════════════════════════════════════════════════════════════
// PSM OS · lib/psm-clock.js v70.0.0
// Relogio digital global (canto inferior direito) + Wake Lock API basico.
// Extraido inline do index.html (v70 modularization).
//
// Depende de #psm-clock-time e #psm-clock-date no DOM (renderizados no body).
// Use PSM.timers.clear('global-clock') para parar se precisar.
// ═════════════════════════════════════════════════════════════════════════════
(function(global){
  'use strict';
  var DOW = ['dom','seg','ter','qua','qui','sex','sab'];

  function tick(){
    var now = new Date();
    var hh = String(now.getHours()).padStart(2,'0');
    var mm = String(now.getMinutes()).padStart(2,'0');
    var ss = String(now.getSeconds()).padStart(2,'0');
    var dd = String(now.getDate()).padStart(2,'0');
    var mo = String(now.getMonth()+1).padStart(2,'0');
    var t = document.getElementById('psm-clock-time');
    var d = document.getElementById('psm-clock-date');
    if (t) t.textContent = hh+':'+mm+':'+ss;
    if (d) d.textContent = DOW[now.getDay()] + ' ' + dd + '/' + mo;
  }

  function start(){
    tick();
    if (global.PSM && global.PSM.timers) {
      global.PSM.timers.register('global-clock', tick, 1000, { group: 'system' });
    } else {
      setInterval(tick, 1000); // fallback caso psm-timers nao tenha carregado
    }
    _initWakeLock();
  }

  function _initWakeLock(){
    if (!('wakeLock' in global.navigator)) return;
    var _wl = null;
    async function reqWL(){
      try {
        _wl = await global.navigator.wakeLock.request('screen');
        _wl.addEventListener('release', function(){ _wl = null; });
      } catch(e){
        if (global.PSM && global.PSM.log) global.PSM.log.warn('clock', 'WakeLock request falhou', e);
      }
    }
    reqWL();
    global.document.addEventListener('visibilitychange', function(){
      if (global.document.visibilityState === 'visible' && !_wl) reqWL();
    });
  }

  // Inicializa quando DOM pronto
  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  global.PSM = global.PSM || {};
  global.PSM.clock = { tick: tick, VERSION: '70.0.0' };
})(typeof window !== 'undefined' ? window : this);
