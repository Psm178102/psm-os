// lib/psm-monitor.js — Stub Sprint 0 (2026-04-25)
// Monitor: console + opcional webhook simples. PagerDuty real fica para Sprint 2+.
(function(){
  'use strict';
  var w = (typeof window !== 'undefined') ? window : self;
  if (w.psmMonitor) return;

  var WEBHOOK_URL = null;
  var heartbeatTimer = null;

  function postWebhook(payload){
    if (!WEBHOOK_URL) return Promise.resolve(false);
    try {
      return fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).then(function(){ return true; }).catch(function(){ return false; });
    } catch(_) { return Promise.resolve(false); }
  }

  w.psmMonitor = {
    setWebhook: function(url){
      WEBHOOK_URL = (typeof url === 'string' && url.indexOf('http') === 0) ? url : null;
      console.debug('[psm-monitor stub] webhook ' + (WEBHOOK_URL ? 'configurado' : 'limpo'));
    },
    alert: function(level, message, ctx){
      var entry = { ts: Date.now(), level: level || 'info', message: String(message || ''), ctx: ctx || {} };
      try {
        if (level === 'crit' || level === 'error') console.error('[psm-monitor]', entry);
        else if (level === 'warn') console.warn('[psm-monitor]', entry);
        else console.log('[psm-monitor]', entry);
      } catch(_){}
      return postWebhook(entry);
    },
    heartbeatStart: function(intervalMs){
      if (heartbeatTimer) return;
      var ms = Math.max(60000, Number(intervalMs) || 300000);
      heartbeatTimer = setInterval(function(){
        try {
          postWebhook({ ts: Date.now(), level: 'heartbeat', user: (w.S && w.S.user && w.S.user.id) || null });
        } catch(_){}
      }, ms);
      console.debug('[psm-monitor stub] heartbeat iniciado a cada ' + ms + 'ms');
    },
    heartbeatStop: function(){
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    }
  };

  try {
    w.addEventListener('error', function(ev){
      w.psmMonitor.alert('error', 'window.onerror: ' + (ev.message || ''), { src: ev.filename, line: ev.lineno });
    });
    w.addEventListener('unhandledrejection', function(ev){
      w.psmMonitor.alert('error', 'unhandledrejection: ' + (ev.reason && ev.reason.message || ev.reason || ''));
    });
  } catch(_){}

  console.log('[psm-monitor] stub v0.1 carregado');
})();
