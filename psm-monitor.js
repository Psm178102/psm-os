/* ═══════════════════════════════════════════════════════════════════════════
 * PSM MONITOR v27 (2026-04-21)
 * Heartbeat + health dashboard + alertas (PagerDuty / webhook) 24/7.
 * Coleta erros globais, status offline, backup age, API failures.
 * API: window.psmMonitor.ping() / health() / alert(level, msg) / onAlert(cb)
 * ═══════════════════════════════════════════════════════════════════════════ */
(function(global){
'use strict';

var CFG = {
  heartbeatMs: 5 * 60 * 1000,           // 5min
  alertWebhookKey: 'PSM_ALERT_WEBHOOK', // PagerDuty Events API v2 routing key
  healthUrl: null,                      // opcional: POST /healthcheck
  thresholds: {
    offlineQueuedCritico: 100,
    backupAgeMaxMs: 48 * 60 * 60 * 1000,  // 48h sem backup = alerta
    apiErrRate5m: 0.3                     // >30% falhas em 5min
  }
};

function _log(){ try{ console.log.apply(console, ['[psm-monitor]'].concat([].slice.call(arguments))); }catch(_){} }
function _err(msg, e){ try{ console.warn('[psm-monitor]', msg, e); }catch(_){} }

var _stats = {
  boot: Date.now(),
  heartbeats: 0,
  errors: [],          // ultimos 50
  apiCalls: { ok:0, err:0, window:[] },
  alerts: [],          // ultimos 20
  lastHealth: null
};
var _listeners = [];
function _emit(alert){ _listeners.forEach(function(cb){ try{ cb(alert); }catch(_){} }); }

function _webhook(){ try { return localStorage.getItem(CFG.alertWebhookKey) || ''; } catch(_){ return ''; } }
function setWebhook(url){ try { localStorage.setItem(CFG.alertWebhookKey, url); } catch(_){} }

// ─── ERROR CAPTURE ─────────────────────────────────────────────────────────
function _captureErr(src, msg, e){
  var rec = { ts: Date.now(), src: src, msg: String(msg).slice(0,500), stack: e && e.stack ? String(e.stack).slice(0,1000) : null };
  _stats.errors.push(rec);
  if(_stats.errors.length > 50) _stats.errors.shift();
  // alerta automatico em erros criticos
  if(/offline|supabase|firebase|auth|quota/i.test(msg)){
    alert('warn', src + ': ' + msg);
  }
}

function _installHooks(){
  global.addEventListener('error', function(e){ _captureErr('window', e.message || 'error', e.error); });
  global.addEventListener('unhandledrejection', function(e){ _captureErr('promise', (e.reason && e.reason.message) || e.reason || 'reject', e.reason); });

  // intercepta fetch pra contar sucesso/erro
  if(!global._psmFetchWrapped){
    var orig = global.fetch;
    global.fetch = function(url, opts){
      return orig.apply(this, arguments).then(function(r){
        _stats.apiCalls[r.ok ? 'ok' : 'err']++;
        _stats.apiCalls.window.push({ ts: Date.now(), ok: r.ok, url: String(url).slice(0,120) });
        if(_stats.apiCalls.window.length > 200) _stats.apiCalls.window.shift();
        return r;
      }).catch(function(e){
        _stats.apiCalls.err++;
        _stats.apiCalls.window.push({ ts: Date.now(), ok: false, url: String(url).slice(0,120), err: e.message });
        if(_stats.apiCalls.window.length > 200) _stats.apiCalls.window.shift();
        throw e;
      });
    };
    global._psmFetchWrapped = true;
  }
}

// ─── HEALTH REPORT ─────────────────────────────────────────────────────────
function health(){
  var now = Date.now();
  var recent = _stats.apiCalls.window.filter(function(c){ return (now - c.ts) < 5*60*1000; });
  var errRate = recent.length ? (recent.filter(function(c){ return !c.ok; }).length / recent.length) : 0;

  var offStatus = (global.psmOffline && global.psmOffline.status()) || { queued:0, online:navigator.onLine };
  var backupStatus = (global.psmBackup && global.psmBackup.status()) || { last:null };
  var backupAge = backupStatus.last ? (now - new Date(backupStatus.last.ts).getTime()) : Infinity;

  var issues = [];
  if(offStatus.queued > CFG.thresholds.offlineQueuedCritico) issues.push('fila offline >' + CFG.thresholds.offlineQueuedCritico);
  if(backupAge > CFG.thresholds.backupAgeMaxMs) issues.push('sem backup ha ' + Math.round(backupAge/3600000) + 'h');
  if(errRate > CFG.thresholds.apiErrRate5m && recent.length > 10) issues.push('taxa erro API ' + Math.round(errRate*100) + '%');
  if(!offStatus.online) issues.push('offline');

  var level = issues.length === 0 ? 'ok' : (issues.length >= 2 ? 'critical' : 'warn');

  var h = {
    ts: new Date().toISOString(),
    level: level,
    uptime: now - _stats.boot,
    heartbeats: _stats.heartbeats,
    errorsTotal: _stats.errors.length,
    apiCalls: { ok: _stats.apiCalls.ok, err: _stats.apiCalls.err, errRate5m: errRate.toFixed(3) },
    offline: offStatus,
    backupAgeH: backupAge === Infinity ? null : Math.round(backupAge/3600000),
    issues: issues,
    recentErrors: _stats.errors.slice(-5)
  };
  _stats.lastHealth = h;
  return h;
}

// ─── ALERT DISPATCH ────────────────────────────────────────────────────────
async function alertFn(level, msg, extra){
  var a = { ts: Date.now(), level: level, msg: msg, extra: extra || null };
  _stats.alerts.push(a);
  if(_stats.alerts.length > 20) _stats.alerts.shift();
  _log('ALERT[' + level + ']', msg);
  _emit(a);

  // Sentry (se presente)
  try { if(global.PSMSentry && global.PSMSentry.capture) global.PSMSentry.capture('[' + level + '] ' + msg, extra); } catch(_){}

  // PagerDuty Events API v2
  var hook = _webhook();
  if(hook && level !== 'info'){
    try {
      await fetch('https://events.pagerduty.com/v2/enqueue', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({
          routing_key: hook,
          event_action: 'trigger',
          payload: {
            summary: 'PSM OS: ' + msg,
            severity: level === 'critical' ? 'critical' : 'warning',
            source: 'psm-os',
            custom_details: Object.assign({ health: _stats.lastHealth }, extra||{})
          }
        })
      });
    } catch(e){ _err('pagerduty', e); }
  }
  return a;
}

// ─── HEARTBEAT ─────────────────────────────────────────────────────────────
async function ping(){
  _stats.heartbeats++;
  var h = health();
  // dispara alerta automatico se critico
  if(h.level === 'critical' && (!_stats.alerts.length || Date.now() - _stats.alerts[_stats.alerts.length-1].ts > 15*60*1000)){
    alertFn('critical', 'Health critico: ' + h.issues.join(', '), h);
  }
  // POST opcional pra healthcheck url
  if(CFG.healthUrl){
    try { await fetch(CFG.healthUrl, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(h) }); }
    catch(_){}
  }
  return h;
}

function _startHeartbeat(){
  if(global._psmHbTimer) return;
  global._psmHbTimer = setInterval(function(){ ping().catch(function(){}); }, CFG.heartbeatMs);
  setTimeout(function(){ ping().catch(function(){}); }, 10000); // primeiro ping 10s apos boot
}

// ─── BOOT ──────────────────────────────────────────────────────────────────
_installHooks();
_startHeartbeat();

global.psmMonitor = {
  ping: ping,
  health: health,
  alert: alertFn,
  onAlert: function(cb){ if(typeof cb === 'function') _listeners.push(cb); },
  setWebhook: setWebhook,
  stats: function(){ return JSON.parse(JSON.stringify(_stats)); },
  _version: '27.0'
};

_log('pronto');

})(typeof window !== 'undefined' ? window : globalThis);
