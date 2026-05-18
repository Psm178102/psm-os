// ═════════════════════════════════════════════════════════════════════════════
// PSM OS · lib/psm-timers.js v68.0.0
// Registry centralizado de setInterval/setTimeout para prevenir memory leaks
// no Dashboard TV (rodando 24/7 sem reload).
//
// Problema corrigido:
//   - 125+ setInterval/setTimeout espalhados no index.html, alguns nunca limpos
//   - Trocas de cena no Modo TV criam novos timers sem destruir os anteriores
//   - Apos ~24-48h a TV trava por memory leak e listeners orfaos
//
// API publica (window.PSM.timers):
//   register(id, fn, ms, opts) → setInterval rastreavel, com chave nomeada
//   once(id, fn, ms)           → setTimeout rastreavel
//   clear(id)                  → cancela timer pela chave
//   clearGroup(group)          → cancela todos timers de um grupo (ex: 'tv-scene')
//   clearAll()                 → cancela TUDO (use ao destruir Modo TV)
//   list()                     → debug: lista timers ativos
//   stats()                    → contadores agregados
//
// Convencoes de grupo:
//   'tv-scene' → timers que vivem somente dentro da cena ativa do Modo TV
//   'tv-global' → timers do Modo TV que persistem em todas cenas (relogio, ticker)
//   'sync'     → timers de Firebase/Supabase
//   'ui'       → animacoes, toasts, feedback visual
//   'system'   → version check, heartbeat
// ═════════════════════════════════════════════════════════════════════════════
(function(global){
  'use strict';

  var _intervals = {}; // id -> { handle, fn, ms, group, createdAt, fires }
  var _timeouts  = {}; // id -> { handle, fn, ms, group, createdAt }
  var _seq = 0;
  function _autoId(prefix){ return (prefix||'t')+'-'+(++_seq)+'-'+Date.now(); }

  function register(id, fn, ms, opts){
    if (typeof id === 'function') { // assinatura register(fn, ms, opts)
      opts = ms; ms = fn; fn = id; id = _autoId('int');
    }
    opts = opts || {};
    var group = opts.group || 'default';
    // se ja existe com mesmo id, limpa primeiro (idempotente)
    if (_intervals[id]) {
      try { clearInterval(_intervals[id].handle); } catch(_){}
      delete _intervals[id];
    }
    var rec = { id: id, fn: fn, ms: ms, group: group, createdAt: Date.now(), fires: 0 };
    rec.handle = setInterval(function(){
      rec.fires++;
      try { fn(); }
      catch(e){
        if (global.console && console.warn) console.warn('[PSM-Timers] erro em ' + id, e);
        if (opts.stopOnError) { clear(id); }
      }
    }, ms);
    _intervals[id] = rec;
    return id;
  }

  function once(id, fn, ms, opts){
    if (typeof id === 'function') { opts = ms; ms = fn; fn = id; id = _autoId('to'); }
    opts = opts || {};
    var group = opts.group || 'default';
    if (_timeouts[id]) { try { clearTimeout(_timeouts[id].handle); } catch(_){} }
    var rec = { id: id, fn: fn, ms: ms, group: group, createdAt: Date.now() };
    rec.handle = setTimeout(function(){
      delete _timeouts[id];
      try { fn(); } catch(e){ if (global.console) console.warn('[PSM-Timers] erro em ' + id, e); }
    }, ms);
    _timeouts[id] = rec;
    return id;
  }

  function clear(id){
    if (_intervals[id]) {
      try { clearInterval(_intervals[id].handle); } catch(_){}
      delete _intervals[id];
      return true;
    }
    if (_timeouts[id]) {
      try { clearTimeout(_timeouts[id].handle); } catch(_){}
      delete _timeouts[id];
      return true;
    }
    return false;
  }

  function clearGroup(group){
    var n = 0;
    Object.keys(_intervals).forEach(function(id){
      if (_intervals[id].group === group) { clear(id); n++; }
    });
    Object.keys(_timeouts).forEach(function(id){
      if (_timeouts[id].group === group) { clear(id); n++; }
    });
    return n;
  }

  function clearAll(){
    var n = 0;
    Object.keys(_intervals).forEach(function(id){ clear(id); n++; });
    Object.keys(_timeouts).forEach(function(id){ clear(id); n++; });
    return n;
  }

  function list(){
    var out = { intervals: [], timeouts: [] };
    Object.keys(_intervals).forEach(function(id){
      var r = _intervals[id];
      out.intervals.push({ id: id, group: r.group, ms: r.ms, fires: r.fires, ageMs: Date.now()-r.createdAt });
    });
    Object.keys(_timeouts).forEach(function(id){
      var r = _timeouts[id];
      out.timeouts.push({ id: id, group: r.group, ms: r.ms, ageMs: Date.now()-r.createdAt });
    });
    return out;
  }

  function stats(){
    var byGroup = {};
    Object.keys(_intervals).forEach(function(id){
      var g = _intervals[id].group;
      byGroup[g] = byGroup[g] || { intervals:0, timeouts:0 };
      byGroup[g].intervals++;
    });
    Object.keys(_timeouts).forEach(function(id){
      var g = _timeouts[id].group;
      byGroup[g] = byGroup[g] || { intervals:0, timeouts:0 };
      byGroup[g].timeouts++;
    });
    return {
      totalIntervals: Object.keys(_intervals).length,
      totalTimeouts: Object.keys(_timeouts).length,
      byGroup: byGroup
    };
  }

  // Limpa automaticamente no beforeunload (best-effort)
  if (global.addEventListener) {
    global.addEventListener('beforeunload', function(){ try { clearAll(); } catch(_){} });
  }

  var api = {
    register: register,
    once: once,
    clear: clear,
    clearGroup: clearGroup,
    clearAll: clearAll,
    list: list,
    stats: stats,
    VERSION: '68.0.0'
  };

  global.PSM = global.PSM || {};
  global.PSM.timers = api;

  if (global.console && console.log) {
    console.log('[PSM-Timers] psm-timers.js v' + api.VERSION + ' carregado. Use PSM.timers.stats() para debug.');
  }
})(typeof window !== 'undefined' ? window : this);
